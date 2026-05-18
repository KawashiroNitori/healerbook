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
