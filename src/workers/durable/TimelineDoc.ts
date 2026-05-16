/// <reference types="@cloudflare/workers-types" />
import { DurableObject } from 'cloudflare:workers'
import type { Env } from '../env'
import { DoSqlStore } from '../collab/doSqlStore'
import { decodeMessage, encodeLoadReply, encodeMessage, MSG } from '@/collab/syncProtocol'
import * as Y from 'yjs'
import { encodeStateVectorFromUpdate, diffUpdate } from 'yjs'
import { verifyToken } from '../jwt'
import { projectTimeline } from '@/collab/docSchema'
import type { Timeline } from '@/types/timeline'

/** 挂在每个 WebSocket 上的鉴权状态(扛 hibernation) */
interface SocketAttachment {
  authed: boolean
  userId?: string
  /** 该连接最近一帧 awareness payload(不透明字节,存为普通数组以可序列化) */
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
      await this.scheduleSquash() // Task A8
      return
    }
    if (type === MSG.AWARENESS) {
      const awarenessAtt = ws.deserializeAttachment() as SocketAttachment
      ws.serializeAttachment({ ...awarenessAtt, lastAwareness: Array.from(payload) })
      this.broadcast(ws, encodeMessage(MSG.AWARENESS, payload)) // 仅转发
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
    const row = await this.env.healerbook_timelines
      .prepare('SELECT 1 FROM timeline_editors WHERE timeline_id = ? AND user_id = ?')
      .bind(this.docId(), userId)
      .first()
    if (!row) {
      ws.close(1008, 'not an editor')
      return
    }
    ws.serializeAttachment({ authed: true, userId } satisfies SocketAttachment)
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

  private static readonly SQUASH_SOFT = 50
  private static readonly SQUASH_HARD = 200
  private static readonly SQUASH_DEBOUNCE_MS = 10_000

  /** 每次 push 后调用:按 updates 条数调度 squash */
  private async scheduleSquash(): Promise<void> {
    const count = this.store.countUpdates()
    if (count >= TimelineDoc.SQUASH_HARD) {
      await this.ctx.storage.setAlarm(Date.now())
    } else if (count >= TimelineDoc.SQUASH_SOFT) {
      await this.ctx.storage.setAlarm(Date.now() + TimelineDoc.SQUASH_DEBOUNCE_MS)
    }
  }

  /** 迁移脚本用:灌入初始全量 snapshot,幂等(已有数据则跳过) */
  async seed(bin: Uint8Array): Promise<void> {
    if (!this.store.isEmpty()) return
    this.store.seedSnapshot(bin)
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

  /** squash 后把投影 JSON 写入 KV 公开读缓存 */
  private async writeSnapshotCache(): Promise<void> {
    if (!this.cachedDocId) return
    const json = await this.getSnapshotJson()
    if (json) {
      await this.env.healerbook_snapshots.put(
        `tl-snapshot:${this.cachedDocId}`,
        JSON.stringify(json)
      )
    }
  }

  /** 该 DO 对应的 timelineId —— 由 Worker 在转发 /connect 时经 header 注入 */
  private docId(): string {
    return this.cachedDocId ?? ''
  }
}
