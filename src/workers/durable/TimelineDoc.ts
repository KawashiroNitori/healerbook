/// <reference types="@cloudflare/workers-types" />
import { DurableObject } from 'cloudflare:workers'
import type { Env } from '../env'
import { DoSqlStore } from '../collab/doSqlStore'
import { decodeMessage } from '../collab/syncProtocol'

/** 挂在每个 WebSocket 上的鉴权状态(扛 hibernation) */
interface SocketAttachment {
  authed: boolean
  userId?: string
}

export class TimelineDoc extends DurableObject<Env> {
  private readonly store: DoSqlStore

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.store = new DoSqlStore(ctx.storage.sql)
    this.store.init()
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

  /** 消息分发 —— 鉴权/同步处理在 Task A6–A7 填充 */
  private async dispatch(
    ws: WebSocket,
    att: SocketAttachment,
    type: number,
    payload: Uint8Array
  ): Promise<void> {
    void att
    void type
    void payload
    ws.close(1011, 'not implemented')
  }
}
