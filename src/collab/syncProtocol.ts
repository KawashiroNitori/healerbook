import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import * as time from 'lib0/time'
import * as f from 'lib0/function'
import type { Awareness } from 'y-protocols/awareness'
import { colorForUser } from './awarenessIdentity'
import type { AwarenessState, UserIdentity } from './awarenessTypes'

/**
 * WebSocket 同步协议线格式。
 * 每帧:[1 字节 type][payload]。payload 语义随 type 而定。
 */
export const MSG = {
  AUTH: 0, // client→DO   payload = UTF-8 JWT
  AUTH_OK: 1, // DO→client   payload = 空
  LOAD: 2, // client→DO   payload = 客户端 state vector
  LOAD_REPLY: 3, // DO→client   payload = encodeLoadReply(missing, serverStateVector)
  PUSH: 4, // client→DO   payload = Yjs update
  BROADCAST: 5, // DO→client   payload = Yjs update
  AWARENESS: 6, // 双向        payload = awareness update
  EDIT_REQUEST: 7, // DO→client   payload = encodeEditRequest(待处理申请数)
} as const

export type MsgType = (typeof MSG)[keyof typeof MSG]

export interface DecodedMessage {
  type: number
  payload: Uint8Array
}

export function encodeMessage(type: MsgType, payload: Uint8Array): Uint8Array {
  const frame = new Uint8Array(1 + payload.length)
  frame[0] = type
  frame.set(payload, 1)
  return frame
}

export function decodeMessage(frame: Uint8Array): DecodedMessage {
  if (frame.length === 0) throw new Error('empty frame')
  return { type: frame[0], payload: frame.subarray(1) }
}

/** LOAD_REPLY payload:[4 字节 BE missing 长度][missing][serverStateVector] */
export function encodeLoadReply(missing: Uint8Array, stateVector: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + missing.length + stateVector.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, missing.length, false)
  out.set(missing, 4)
  out.set(stateVector, 4 + missing.length)
  return out
}

export function decodeLoadReply(payload: Uint8Array): {
  missing: Uint8Array
  stateVector: Uint8Array
} {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  const missingLen = view.getUint32(0, false)
  return {
    missing: payload.subarray(4, 4 + missingLen),
    stateVector: payload.subarray(4 + missingLen),
  }
}

/** EDIT_REQUEST payload:4 字节 BE,值为当前待处理的编辑权限申请数 */
export function encodeEditRequest(count: number): Uint8Array {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, count, false)
  return out
}

export function decodeEditRequest(payload: Uint8Array): number {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  return view.getUint32(0, false)
}

// ─── Awareness 二进制编解码 ────────────────────────────────────────────────────
//
// 替代 y-protocols 的 `encodeAwarenessUpdate`(其 state 走 JSON.stringify)。
// envelope / clock / 事件语义忠实移植自 y-protocols@1.0.7,仅把单个 state 的
// JSON 串换成 bitmask 二进制布局,大幅缩小高频 awareness 帧。详见聊天设计。
//
// state 布局:[bitmask uint8] + 按位顺序的字段
//   bit0 user              : varString id, varString name      (color 解码端 colorForUser(id) 重算)
//   bit1 sel.eventIds      : varUint count + count × varString
//   bit2 sel.castEventIds  : varUint count + count × varString
//   bit3 cursorTime        : float32
//   bit4 dragging          : uint8 kind, float32 time, varUint(playerId+1|0=null), varString id
//   bit5 sel.annotationIds : varUint count + count × varString
//
// envelope:[varUint numClients] + 每 client [varUint clientID][varUint clock][varUint8Array state]
//   state 段为空(长度 0)表示该 client 被移除(null state)。

const B_USER = 1 << 0
const B_SEL_EVENT = 1 << 1
const B_SEL_CAST = 1 << 2
const B_CURSOR = 1 << 3
const B_DRAG = 1 << 4
const B_SEL_ANNOTATION = 1 << 5

const DRAG_KINDS = ['damage', 'cast', 'annotation'] as const

/** varString[] を書く: [varUint count] + count × varString */
function writeVarStringArray(enc: encoding.Encoder, arr: string[]): void {
  encoding.writeVarUint(enc, arr.length)
  for (const s of arr) encoding.writeVarString(enc, s)
}

/** varString[] を読む: [varUint count] + count × varString */
function readVarStringArray(dec: decoding.Decoder): string[] {
  const count = decoding.readVarUint(dec)
  const arr: string[] = []
  for (let i = 0; i < count; i++) arr.push(decoding.readVarString(dec))
  return arr
}

/** 単個 AwarenessState → 二進制(user 缺省时 bit0 不置位,用于上行不带 user) */
export function encodeAwarenessState(state: Partial<AwarenessState>): Uint8Array {
  const enc = encoding.createEncoder()
  const { user, selection, cursorTime, dragging } = state
  let mask = 0
  if (user) mask |= B_USER
  if (selection?.eventIds && selection.eventIds.length > 0) mask |= B_SEL_EVENT
  if (selection?.castEventIds && selection.castEventIds.length > 0) mask |= B_SEL_CAST
  if (cursorTime != null) mask |= B_CURSOR
  if (dragging) mask |= B_DRAG
  if (selection?.annotationIds && selection.annotationIds.length > 0) mask |= B_SEL_ANNOTATION
  encoding.writeUint8(enc, mask)
  if (mask & B_USER) {
    encoding.writeVarString(enc, user!.id)
    encoding.writeVarString(enc, user!.name)
  }
  if (mask & B_SEL_EVENT) writeVarStringArray(enc, selection!.eventIds)
  if (mask & B_SEL_CAST) writeVarStringArray(enc, selection!.castEventIds)
  if (mask & B_CURSOR) encoding.writeFloat32(enc, cursorTime!)
  if (mask & B_DRAG) {
    encoding.writeUint8(enc, DRAG_KINDS.indexOf(dragging!.kind))
    encoding.writeFloat32(enc, dragging!.time)
    encoding.writeVarUint(enc, dragging!.playerId == null ? 0 : dragging!.playerId + 1)
    encoding.writeVarString(enc, dragging!.id)
  }
  if (mask & B_SEL_ANNOTATION) writeVarStringArray(enc, selection!.annotationIds)
  return encoding.toUint8Array(enc)
}

/** 二进制 → AwarenessState(user 存在时 color 用 colorForUser(id) 重算) */
export function decodeAwarenessState(bytes: Uint8Array): AwarenessState {
  const dec = decoding.createDecoder(bytes)
  const mask = decoding.readUint8(dec)
  const state: AwarenessState = {
    selection: { eventIds: [], castEventIds: [], annotationIds: [] },
    cursorTime: null,
    dragging: null,
  }
  if (mask & B_USER) {
    const id = decoding.readVarString(dec)
    const name = decoding.readVarString(dec)
    state.user = { id, name, color: colorForUser(id) }
  }
  if (mask & B_SEL_EVENT) state.selection.eventIds = readVarStringArray(dec)
  if (mask & B_SEL_CAST) state.selection.castEventIds = readVarStringArray(dec)
  if (mask & B_CURSOR) state.cursorTime = decoding.readFloat32(dec)
  if (mask & B_DRAG) {
    const kind = DRAG_KINDS[decoding.readUint8(dec)]
    const dragTime = decoding.readFloat32(dec)
    const rawPlayer = decoding.readVarUint(dec)
    const id = decoding.readVarString(dec)
    state.dragging = { id, kind, time: dragTime, playerId: rawPlayer === 0 ? null : rawPlayer - 1 }
  }
  if (mask & B_SEL_ANNOTATION) state.selection.annotationIds = readVarStringArray(dec)
  return state
}

/** 取 awareness.meta 里的 clock(缺省 0) */
function clockOf(awareness: Awareness, clientID: number): number {
  return awareness.meta.get(clientID)?.clock ?? 0
}

/** 等价 y-protocols encodeAwarenessUpdate,但 state 走二进制。clients 为需要编码的 clientID 列表。 */
export function encodeAwarenessBinary(awareness: Awareness, clients: number[]): Uint8Array {
  const enc = encoding.createEncoder()
  encoding.writeVarUint(enc, clients.length)
  for (const clientID of clients) {
    const state = (awareness.states.get(clientID) ?? null) as AwarenessState | null
    encoding.writeVarUint(enc, clientID)
    encoding.writeVarUint(enc, clockOf(awareness, clientID))
    // 空字节段 = null state(client 移除)
    encoding.writeVarUint8Array(
      enc,
      state === null ? new Uint8Array(0) : encodeAwarenessState(state)
    )
  }
  return encoding.toUint8Array(enc)
}

/** 等价 y-protocols applyAwarenessUpdate,但 state 走二进制。逐位移植其 clock/事件逻辑。 */
export function applyAwarenessBinary(
  awareness: Awareness,
  update: Uint8Array,
  origin: unknown
): void {
  const dec = decoding.createDecoder(update)
  const timestamp = time.getUnixTime()
  const added: number[] = []
  const updated: number[] = []
  const filteredUpdated: number[] = []
  const removed: number[] = []
  const len = decoding.readVarUint(dec)
  for (let i = 0; i < len; i++) {
    const clientID = decoding.readVarUint(dec)
    let clock = decoding.readVarUint(dec)
    const stateBytes = decoding.readVarUint8Array(dec)
    const state = stateBytes.length === 0 ? null : decodeAwarenessState(stateBytes)
    const clientMeta = awareness.meta.get(clientID)
    const prevState = awareness.states.get(clientID)
    const currClock = clientMeta === undefined ? 0 : clientMeta.clock
    if (
      currClock < clock ||
      (currClock === clock && state === null && awareness.states.has(clientID))
    ) {
      if (state === null) {
        // 不允许远端移除本地 state:增 clock 表明本端仍在线
        if (clientID === awareness.clientID && awareness.getLocalState() != null) {
          clock++
        } else {
          awareness.states.delete(clientID)
        }
      } else {
        awareness.states.set(clientID, state)
      }
      awareness.meta.set(clientID, { clock, lastUpdated: timestamp })
      if (clientMeta === undefined && state !== null) {
        added.push(clientID)
      } else if (clientMeta !== undefined && state === null) {
        removed.push(clientID)
      } else if (state !== null) {
        if (!f.equalityDeep(state, prevState)) filteredUpdated.push(clientID)
        updated.push(clientID)
      }
    }
  }
  if (added.length > 0 || filteredUpdated.length > 0 || removed.length > 0) {
    awareness.emit('change', [{ added, updated: filteredUpdated, removed }, origin])
  }
  if (added.length > 0 || updated.length > 0 || removed.length > 0) {
    awareness.emit('update', [{ added, updated, removed }, origin])
  }
}

/**
 * 服务端用:对一帧 awareness update 里每个非空 state 注入可信 user(来自 JWT 身份),
 * 再重编码。客户端上行不带 user(防伪 + 省字节),广播帧由此带上完整身份。
 */
export function injectAwarenessUser(
  update: Uint8Array,
  user: Pick<UserIdentity, 'id' | 'name'>
): Uint8Array {
  const dec = decoding.createDecoder(update)
  const enc = encoding.createEncoder()
  const len = decoding.readVarUint(dec)
  encoding.writeVarUint(enc, len)
  for (let i = 0; i < len; i++) {
    const clientID = decoding.readVarUint(dec)
    const clock = decoding.readVarUint(dec)
    const stateBytes = decoding.readVarUint8Array(dec)
    encoding.writeVarUint(enc, clientID)
    encoding.writeVarUint(enc, clock)
    if (stateBytes.length === 0) {
      encoding.writeVarUint8Array(enc, stateBytes) // null state 透传
    } else {
      const state = decodeAwarenessState(stateBytes)
      state.user = { ...user, color: colorForUser(user.id) }
      encoding.writeVarUint8Array(enc, encodeAwarenessState(state))
    }
  }
  return encoding.toUint8Array(enc)
}
