import * as Y from 'yjs'
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate } from 'y-protocols/awareness'
import { MSG, encodeMessage, decodeMessage, decodeLoadReply } from './syncProtocol'
import { REMOTE_ORIGIN } from './constants'

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected'

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
  private readonly getJwt: () => string | null
  private readonly onStatus: (status: ConnectionStatus) => void

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
    this.ws.send(encodeMessage(MSG.AWARENESS, encodeAwarenessUpdate(this.awareness, changed)))
  }

  constructor(
    url: string,
    doc: Y.Doc,
    awareness: Awareness,
    getJwt: () => string | null,
    onStatus: (status: ConnectionStatus) => void
  ) {
    this.url = url
    this.doc = doc
    this.awareness = awareness
    this.getJwt = getJwt
    this.onStatus = onStatus
  }

  /** 开始连接(幂等:已在连接中则忽略) */
  connect(): void {
    if (this.ws) return
    this.closed = false
    this.open()
  }

  /** 永久关闭:停止重连、断开监听 */
  destroy(): void {
    this.closed = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.detachUpdateListener()
    this.awareness.off('update', this.onAwarenessUpdate)
    const ws = this.ws
    this.ws = null
    ws?.close()
    this.setStatus('disconnected')
  }

  private setStatus(next: ConnectionStatus): void {
    if (this.status === next) return
    this.status = next
    this.onStatus(next)
  }

  private open(): void {
    this.setStatus('connecting')
    const ws = new WebSocket(this.url)
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    ws.onopen = () => {
      const jwt = this.getJwt()
      if (!jwt) {
        ws.close()
        return
      }
      ws.send(encodeMessage(MSG.AUTH, new TextEncoder().encode(jwt)))
    }
    ws.onmessage = ev => this.onMessage(new Uint8Array(ev.data as ArrayBuffer))
    ws.onclose = () => this.onClose()
    ws.onerror = () => {
      /* onclose 紧随其后,统一在那里处理 */
    }
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
          encodeAwarenessUpdate(this.awareness, [this.awareness.clientID])
        )
      )
      return
    }
    if (msg.type === MSG.LOAD_REPLY) {
      const { missing, stateVector } = decodeLoadReply(msg.payload)
      if (missing.length > 0) Y.applyUpdate(this.doc, missing, REMOTE_ORIGIN)
      const ours = Y.encodeStateAsUpdate(this.doc, stateVector)
      this.ws?.send(encodeMessage(MSG.PUSH, ours))
      return
    }
    if (msg.type === MSG.BROADCAST) {
      Y.applyUpdate(this.doc, msg.payload, REMOTE_ORIGIN)
      return
    }
    if (msg.type === MSG.AWARENESS) {
      applyAwarenessUpdate(this.awareness, msg.payload, REMOTE_ORIGIN)
      return
    }
  }

  private onClose(): void {
    this.detachUpdateListener()
    this.awareness.off('update', this.onAwarenessUpdate)
    this.ws = null
    if (this.closed) {
      this.setStatus('disconnected')
      return
    }
    this.setStatus('connecting')
    const delay = Math.min(1000 * 2 ** this.retry, MAX_BACKOFF_MS)
    this.retry++
    this.reconnectTimer = setTimeout(() => {
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
