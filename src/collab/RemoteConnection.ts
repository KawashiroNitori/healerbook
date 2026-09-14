import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import {
  MSG,
  encodeMessage,
  decodeMessage,
  decodeLoadReply,
  decodeEditRequest,
  encodeAwarenessBinary,
  applyAwarenessBinary,
} from './syncProtocol'
import { REMOTE_ORIGIN } from './constants'

/**
 * - disconnected:未连接或因业务原因(鉴权失败 / 权限撤销 / 主动销毁)终态关闭,不再重连
 * - connecting:正在建立连接 / 握手中
 * - connected:已鉴权,双向同步中
 * - failed:连接因网络等原因断开,正在等待退避计时器自动重连
 */
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'failed'

/** 状态回调;nextRetryAt 仅 failed 时为下次自动重连的时间戳(ms),其余为 null */
export type ConnectionStatusListener = (
  status: ConnectionStatus,
  nextRetryAt: number | null
) => void

const MAX_BACKOFF_MS = 30_000

/**
 * 单条时间轴的远端同步连接。
 * 持有一条到对应 Durable Object 的 WebSocket,负责 auth / load 握手、
 * 本地 update 上推、远端 broadcast 应用、断线指数退避重连。
 */
export class RemoteConnection {
  private readonly url: string
  private readonly doc: Y.Doc
  private readonly awareness: Awareness
  private readonly getAuthToken: () => Promise<string | null>
  private readonly onStatus: ConnectionStatusListener
  /** 收到 DO 推送的待处理申请数(仅作者连接会收到) */
  private readonly onEditRequest: ((count: number) => void) | undefined
  /** 编辑权限被撤销（WS 4001）时触发一次 */
  private readonly onRevoked: (() => void) | undefined
  /** 远端 doc 应用完成(LOAD_REPLY 处理末尾)触发;每次 LOAD_REPLY 都会触发,幂等性由上层处理 */
  private readonly onLoaded: (() => void) | undefined

  private ws: WebSocket | null = null
  private status: ConnectionStatus = 'disconnected'
  private retry = 0
  private closed = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private updateListenerActive = false

  private readonly onAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown
  ): void => {
    if (origin === REMOTE_ORIGIN) return // 远端来的,不回推
    if (this.status !== 'connected' || !this.ws) return
    const changed = [...added, ...updated, ...removed]
    if (changed.length === 0) return
    this.ws.send(encodeMessage(MSG.AWARENESS, encodeAwarenessBinary(this.awareness, changed)))
  }

  constructor(
    url: string,
    doc: Y.Doc,
    awareness: Awareness,
    getAuthToken: () => Promise<string | null>,
    onStatus: ConnectionStatusListener,
    onEditRequest?: (count: number) => void,
    onRevoked?: () => void,
    onLoaded?: () => void
  ) {
    this.url = url
    this.doc = doc
    this.awareness = awareness
    this.getAuthToken = getAuthToken
    this.onStatus = onStatus
    this.onEditRequest = onEditRequest
    this.onRevoked = onRevoked
    this.onLoaded = onLoaded
  }

  /** 开始连接(幂等:已在连接中或已终态关闭则忽略) */
  connect(): void {
    if (this.ws || this.closed) return
    this.open()
  }

  /** 跳过退避等待立即重连;仅 failed(等待自动重连)时生效 */
  reconnectNow(): void {
    if (this.status !== 'failed' || this.closed) return
    this.clearReconnectTimer()
    this.open()
  }

  /**
   * 仅供开发调试:模拟一次网络原因断线(非业务终态),随后按退避自动重连。
   * 先解绑旧 socket 回调再手动走 onClose,避免等待关闭握手、也避免迟到的 close 事件重复流转。
   */
  simulateNetworkDrop(): void {
    const ws = this.ws
    if (!ws) return
    ws.onopen = null
    ws.onmessage = null
    ws.onclose = null
    ws.onerror = null
    ws.close()
    this.onClose(1006)
  }

  /** 永久关闭:停止重连、断开监听 */
  destroy(): void {
    this.closed = true
    this.clearReconnectTimer()
    this.detachUpdateListener()
    this.awareness.off('update', this.onAwarenessUpdate)
    const ws = this.ws
    this.ws = null
    ws?.close()
    this.setStatus('disconnected')
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }

  private setStatus(next: ConnectionStatus, nextRetryAt: number | null = null): void {
    if (this.status === next) return
    this.status = next
    this.onStatus(next, nextRetryAt)
  }

  private open(): void {
    this.setStatus('connecting')
    const ws = new WebSocket(this.url)
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    // 故意把 authenticate 的 Promise 作为返回值交回:浏览器忽略 onopen 返回值,
    // 而单测的 FakeWebSocket.fireOpen 靠 await 它来等握手完成。勿改成 `() => { void ... }`。
    ws.onopen = () => this.authenticate(ws)
    ws.onmessage = ev => this.onMessage(new Uint8Array(ev.data as ArrayBuffer))
    ws.onclose = ev => this.onClose(ev.code)
    ws.onerror = () => {
      /* onclose 紧随其后,统一在那里处理 */
    }
  }

  /**
   * onopen 后异步取 token 并发 AUTH。
   * 取不到有效 token 视为终态鉴权失败:置 closed、关闭连接、不再重连。
   */
  private async authenticate(ws: WebSocket): Promise<void> {
    const jwt = await this.getAuthToken()
    // await 期间连接可能已被 destroy() 关闭或被重连流程替换
    if (this.ws !== ws || this.closed) return
    if (!jwt) {
      this.closed = true
      ws.close()
      return
    }
    ws.send(encodeMessage(MSG.AUTH, new TextEncoder().encode(jwt)))
  }

  private onMessage(frame: Uint8Array): void {
    let msg
    try {
      msg = decodeMessage(frame)
    } catch {
      return
    }
    if (msg.type === MSG.AUTH_OK) {
      this.retry = 0
      this.setStatus('connected')
      this.attachUpdateListener()
      this.ws?.send(encodeMessage(MSG.LOAD, Y.encodeStateVector(this.doc)))
      this.awareness.on('update', this.onAwarenessUpdate)
      // 首播本地 awareness,使已在线者立刻看到自己
      this.ws?.send(
        encodeMessage(
          MSG.AWARENESS,
          encodeAwarenessBinary(this.awareness, [this.awareness.clientID])
        )
      )
      return
    }
    if (msg.type === MSG.LOAD_REPLY) {
      const { missing, stateVector } = decodeLoadReply(msg.payload)
      if (missing.length > 0) Y.applyUpdate(this.doc, missing, REMOTE_ORIGIN)
      const ours = Y.encodeStateAsUpdate(this.doc, stateVector)
      this.ws?.send(encodeMessage(MSG.PUSH, ours))
      this.onLoaded?.()
      return
    }
    if (msg.type === MSG.BROADCAST) {
      Y.applyUpdate(this.doc, msg.payload, REMOTE_ORIGIN)
      return
    }
    if (msg.type === MSG.AWARENESS) {
      applyAwarenessBinary(this.awareness, msg.payload, REMOTE_ORIGIN)
      return
    }
    if (msg.type === MSG.EDIT_REQUEST) {
      this.onEditRequest?.(decodeEditRequest(msg.payload))
      return
    }
  }

  private onClose(code?: number): void {
    this.detachUpdateListener()
    this.awareness.off('update', this.onAwarenessUpdate)
    this.ws = null
    if (this.closed) {
      this.setStatus('disconnected')
      return
    }
    // 服务端以 1008 拒绝(invalid token / not an editor / auth required):
    // 重连无意义,转入终态
    if (code === 1008) {
      this.closed = true
      this.setStatus('disconnected')
      return
    }
    // 服务端以 4001 撤销编辑权限：终态、不重连，触发 onRevoked 让上层降级
    if (code === 4001) {
      this.closed = true
      this.setStatus('disconnected')
      this.onRevoked?.()
      return
    }
    const delay = Math.min(1000 * 2 ** this.retry, MAX_BACKOFF_MS)
    this.retry++
    this.setStatus('failed', Date.now() + delay)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.closed) this.open()
    }, delay)
  }

  private attachUpdateListener(): void {
    if (this.updateListenerActive) return
    this.doc.on('update', this.onLocalUpdate)
    this.updateListenerActive = true
  }

  private detachUpdateListener(): void {
    if (!this.updateListenerActive) return
    this.doc.off('update', this.onLocalUpdate)
    this.updateListenerActive = false
  }

  private onLocalUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === REMOTE_ORIGIN) return
    if (this.status !== 'connected' || !this.ws) return
    this.ws.send(encodeMessage(MSG.PUSH, update))
  }
}
