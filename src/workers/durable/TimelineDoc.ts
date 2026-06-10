/// <reference types="@cloudflare/workers-types" />
import { DurableObject } from 'cloudflare:workers'
import type { Env } from '../env'
import { DoSqlStore } from '../collab/doSqlStore'
import {
  decodeMessage,
  encodeEditRequest,
  encodeLoadReply,
  encodeMessage,
  injectAwarenessUser,
  MSG,
} from '@/collab/syncProtocol'
import { displayName } from '@/collab/awarenessIdentity'
import { toBase64 } from 'lib0/buffer'
import * as Y from 'yjs'
import { encodeStateVectorFromUpdate, diffUpdate } from 'yjs'
import { verifyToken } from '../jwt'
import { projectTimeline } from '@/collab/docSchema'
import { Y_MAP } from '@/collab/constants'
import type { Timeline } from '@/types/timeline'

/** 挂在每个 WebSocket 上的鉴权状态(扛 hibernation) */
interface SocketAttachment {
  authed: boolean
  userId?: string
  /** JWT 里的 username(原始,注入 awareness 时再过 displayName 兜底) */
  name?: string
  /** 该连接最近一帧 awareness payload(已注入 user 的广播字节,存为普通数组以可序列化) */
  lastAwareness?: number[]
}

export class TimelineDoc extends DurableObject<Env> {
  private readonly store: DoSqlStore
  private cachedDocId: string | undefined

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.store = new DoSqlStore(ctx.storage.sql)
    this.store.init()
    // Restore cachedDocId from durable storage so it survives hibernation eviction.
    // blockConcurrencyWhile defers all incoming handlers until the promise resolves.
    this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.get<string>('docId')
      if (stored) this.cachedDocId = stored
    })
  }

  /** 仅处理 /connect 的 WebSocket 升级 */
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname !== '/connect') {
      return new Response('not found', { status: 400 })
    }
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 400 })
    }
    const timelineId = request.headers.get('X-Timeline-Id')
    if (!timelineId) {
      return new Response('missing timeline id', { status: 400 })
    }
    this.cachedDocId = timelineId
    await this.ctx.storage.put('docId', timelineId)
    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    this.ctx.acceptWebSocket(server)
    server.serializeAttachment({ authed: false } satisfies SocketAttachment)
    return new Response(null, { status: 101, webSocket: client })
  }

  override async webSocketMessage(ws: WebSocket, raw: ArrayBuffer | string): Promise<void> {
    if (typeof raw === 'string') {
      ws.close(1003, 'binary only')
      return
    }
    const att = (ws.deserializeAttachment() ?? { authed: false }) as SocketAttachment
    let msg
    try {
      msg = decodeMessage(new Uint8Array(raw))
    } catch {
      ws.close(1002, 'bad frame')
      return
    }
    await this.dispatch(ws, att, msg.type, msg.payload)
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    void ws
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    void ws
  }

  private async dispatch(
    ws: WebSocket,
    att: SocketAttachment,
    type: number,
    payload: Uint8Array
  ): Promise<void> {
    if (!att.authed) {
      if (type !== MSG.AUTH) {
        ws.close(1008, 'auth required')
        return
      }
      await this.handleAuth(ws, payload)
      return
    }
    // 已鉴权
    if (type === MSG.LOAD) {
      const full = this.store.getMergedDoc()
      const missing = payload.length > 0 ? diffUpdate(full, payload) : full
      const sv = encodeStateVectorFromUpdate(full)
      ws.send(encodeMessage(MSG.LOAD_REPLY, encodeLoadReply(missing, sv)))
      return
    }
    if (type === MSG.PUSH) {
      this.store.appendUpdate(payload) // 先落库
      this.broadcast(ws, encodeMessage(MSG.BROADCAST, payload)) // 再广播
      await this.scheduleFlush()
      return
    }
    if (type === MSG.AWARENESS) {
      // 客户端上行不带 user;服务端按本连接 JWT 身份注入可信 user 后再广播(防伪 + 省上行)。
      // injectAwarenessUser 解码的是不可信客户端字节:格式不自洽的帧(如部署前长期未刷新的
      // 标签页按过期 wire 格式上行)会让解码器错位抛错。不容错就会冒泡成 webSocketMessage
      // 未捕获错误,污染日志、甚至打断该连接。这里 dump 原始帧供取证(离线还原其真实格式以
      // 确认来源),并丢弃坏帧、保住连接 —— 客户端刷新后即自愈。
      let injected: Uint8Array
      try {
        injected = injectAwarenessUser(payload, {
          id: att.userId ?? '',
          name: displayName(att.name, att.userId ?? ''),
        })
      } catch (err) {
        console.error('[awareness] decode failed, dropping frame', {
          userId: att.userId,
          payloadLen: payload.length,
          payloadB64: toBase64(payload),
          error: err instanceof Error ? err.message : String(err),
        })
        return
      }
      // 广播是关键路径,必须先发:大 selection(如全选)注入后可能 >2KB,
      // 会让下面的 serializeAttachment 抛错;若先持久化再广播,异常会吞掉本次广播。
      this.broadcast(ws, encodeMessage(MSG.AWARENESS, injected))
      // 再尽力把最近一帧存进 attachment 供后入连接补发(handleAuth 行)。
      // DO serializeAttachment 上限 2KB,超限则放弃持久化(后入者下一帧再同步),不影响已在线广播。
      try {
        ws.serializeAttachment({ ...att, lastAwareness: Array.from(injected) })
      } catch {
        ws.serializeAttachment({ ...att, lastAwareness: undefined })
      }
      return
    }
  }

  private async handleAuth(ws: WebSocket, payload: Uint8Array): Promise<void> {
    const secret = this.env.JWT_SECRET
    if (!secret) {
      ws.close(1011, 'server misconfigured')
      return
    }
    const jwt = new TextDecoder().decode(payload)
    const result = await verifyToken(jwt, secret)
    if (!result.ok || !result.payload.sub) {
      ws.close(1008, 'invalid token')
      return
    }
    const userId = result.payload.sub
    const name = typeof result.payload.name === 'string' ? result.payload.name : undefined
    const row = await this.env.healerbook_timelines
      .prepare('SELECT 1 FROM timeline_editors WHERE timeline_id = ? AND user_id = ?')
      .bind(this.docId(), userId)
      .first()
    if (!row) {
      ws.close(1008, 'not an editor')
      return
    }
    ws.serializeAttachment({ authed: true, userId, name } satisfies SocketAttachment)
    ws.send(encodeMessage(MSG.AUTH_OK, new Uint8Array()))
    // 把已在线连接的最近 awareness 补发给新连接,使其立刻看到全员
    for (const peer of this.ctx.getWebSockets()) {
      if (peer === ws) continue
      const peerAtt = peer.deserializeAttachment() as SocketAttachment | null
      if (peerAtt?.authed && peerAtt.lastAwareness && peerAtt.lastAwareness.length > 0) {
        ws.send(encodeMessage(MSG.AWARENESS, new Uint8Array(peerAtt.lastAwareness)))
      }
    }
  }

  /** 把 frame 发给除 sender 外的所有已鉴权连接 */
  private broadcast(sender: WebSocket, frame: Uint8Array): void {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === sender) continue
      const att = (ws.deserializeAttachment() ?? { authed: false }) as SocketAttachment
      if (!att.authed) continue
      try {
        ws.send(frame)
      } catch {
        // 发送失败的连接忽略，由运行时清理
      }
    }
  }

  private static readonly FLUSH_HARD = 200
  private static readonly FLUSH_DEBOUNCE_MS = 10_000

  /**
   * 每次 push 后调用:调度一次去抖 flush。
   * alarm 到点会 squash 并刷新 KV 快照 / D1 阵容,故任意改动都需安排 flush,
   * 使列表接口能及时拿到最新阵容;updates 堆积过多则立即触发。
   */
  private async scheduleFlush(): Promise<void> {
    const count = this.store.countUpdates()
    if (count === 0) return
    if (count >= TimelineDoc.FLUSH_HARD) {
      await this.ctx.storage.setAlarm(Date.now())
      return
    }
    // 已有 alarm 在排队则不重设(从首个改动起 ~10s 内必定 flush 一次)
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + TimelineDoc.FLUSH_DEBOUNCE_MS)
    }
  }

  /**
   * Worker 在移除编辑者后调用:断开该用户的所有连接。
   * 用应用自定义 close code 4001(区别于握手期的 1008),客户端据此切只读。
   */
  async kickUser(userId: string): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      const att = (ws.deserializeAttachment() ?? { authed: false }) as SocketAttachment
      if (att.authed && att.userId === userId) {
        try {
          ws.close(4001, 'editor revoked')
        } catch {
          // 已关闭的连接忽略
        }
      }
    }
  }

  /**
   * Worker 在收到新的编辑权限申请后调用:
   * 把当前待处理申请数推给在线的作者连接,使其共享按钮角标实时刷新。
   * 仅发给作者本人;无作者在线时静默 no-op。
   */
  async notifyEditRequest(timelineId: string): Promise<void> {
    const authorRow = await this.env.healerbook_timelines
      .prepare('SELECT author_id FROM timelines WHERE id = ?')
      .bind(timelineId)
      .first<{ author_id: string }>()
    if (!authorRow) return
    const countRow = await this.env.healerbook_timelines
      .prepare('SELECT COUNT(*) AS n FROM timeline_edit_requests WHERE timeline_id = ?')
      .bind(timelineId)
      .first<{ n: number }>()
    const frame = encodeMessage(MSG.EDIT_REQUEST, encodeEditRequest(countRow?.n ?? 0))
    for (const ws of this.ctx.getWebSockets()) {
      const att = (ws.deserializeAttachment() ?? { authed: false }) as SocketAttachment
      if (att.authed && att.userId === authorRow.author_id) {
        try {
          ws.send(frame)
        } catch {
          // 已关闭的连接忽略
        }
      }
    }
  }

  /**
   * 取消发布时调用:断开所有在线连接并清空文档存储。
   * DO 由 `idFromName` 取得会被复用 —— 不清空则同 id 重新发布会复活旧内容。
   */
  async purge(): Promise<void> {
    // 1008 让客户端 RemoteConnection 转入终态,不再重连
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(1008, 'unpublished')
      } catch {
        // 已关闭的连接忽略
      }
    }
    this.store.clear()
    this.cachedDocId = undefined
    await this.ctx.storage.delete('docId')
    await this.ctx.storage.deleteAlarm()
  }

  /** 迁移脚本用:灌入初始全量 snapshot,幂等(已有数据则跳过) */
  async seed(bin: Uint8Array): Promise<void> {
    if (!this.store.isEmpty()) return
    this.store.seedSnapshot(bin)
  }

  /**
   * 迁移修复用:若 doc 的 `meta.name` 为空,追加一个只设 `name` 的 Yjs 增量。
   *
   * 旧版迁移漏取 `timelines.name` 列,把 DO seed 成了缺名字的坏数据;而 `seed`
   * 幂等不会覆盖,故重跑迁移须经此方法回填。非破坏性(Yjs 合并,不碰其他字段),
   * 幂等(已有 name 则跳过)。返回是否实际打了补丁。
   */
  async ensureMetaName(name: string): Promise<boolean> {
    if (!name || this.store.isEmpty()) return false
    const doc = new Y.Doc()
    Y.applyUpdate(doc, this.store.getMergedDoc())
    const current = doc.getMap(Y_MAP.meta).get('name')
    if (typeof current === 'string' && current.length > 0) return false
    const before = Y.encodeStateVector(doc)
    doc.transact(() => {
      doc.getMap(Y_MAP.meta).set('name', name)
    })
    this.store.appendUpdate(Y.encodeStateAsUpdate(doc, before))
    return true
  }

  /**
   * 诊断反查用:返回该 DO 持久化的 timelineId(docId)。
   * DO id 由 `idFromName(timelineId)` 单向派生、不可反推,但 DO 自身在 /connect 时
   * 已把 timelineId 存进 storage('docId'),故可经 `idFromString(hex)` 直连后由它自报。
   * 从未 /connect 过(无数据)的 DO 返回 null。
   */
  async getDocId(): Promise<string | null> {
    return this.cachedDocId ?? null
  }

  /** 公开读用:把当前合并状态投影成 Timeline JSON;空文档返回 null */
  async getSnapshotJson(): Promise<Timeline | null> {
    if (this.store.isEmpty()) return null
    const doc = new Y.Doc()
    Y.applyUpdate(doc, this.store.getMergedDoc())
    return projectTimeline(doc)
  }

  /** alarm 到点:执行 squash */
  override async alarm(): Promise<void> {
    if (this.store.countUpdates() > 0) {
      this.store.squash()
    }
    await this.writeSnapshotCache()
  }

  /** squash 后刷新投影:写 KV 公开读缓存,并把阵容回写 D1 content 列 */
  private async writeSnapshotCache(): Promise<void> {
    if (!this.cachedDocId) return
    const json = await this.getSnapshotJson()
    if (!json) return
    await this.env.healerbook_snapshots.put(`tl-snapshot:${this.cachedDocId}`, JSON.stringify(json))
    // 把阵容回写 D1:GET /api/my/timelines 据此展示阵容,无需唤醒 DO
    await this.env.healerbook_timelines
      .prepare('UPDATE timelines SET content = ? WHERE id = ?')
      .bind(JSON.stringify({ composition: json.composition }), this.cachedDocId)
      .run()
  }

  /** 该 DO 对应的 timelineId —— 由 Worker 在转发 /connect 时经 header 注入 */
  private docId(): string {
    return this.cachedDocId ?? ''
  }
}
