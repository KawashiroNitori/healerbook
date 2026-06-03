import { describe, it, expect } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import {
  MSG,
  encodeMessage,
  decodeMessage,
  encodeLoadReply,
  decodeLoadReply,
  encodeEditRequest,
  decodeEditRequest,
  encodeAwarenessState,
  decodeAwarenessState,
  encodeAwarenessBinary,
  applyAwarenessBinary,
  injectAwarenessUser,
} from './syncProtocol'
import { colorForUser } from './awarenessIdentity'
import type { AwarenessState } from './awarenessTypes'

describe('syncProtocol', () => {
  it('encodeMessage / decodeMessage round-trip', () => {
    const payload = new Uint8Array([9, 8, 7])
    const frame = encodeMessage(MSG.PUSH, payload)
    const decoded = decodeMessage(frame)
    expect(decoded.type).toBe(MSG.PUSH)
    expect([...decoded.payload]).toEqual([9, 8, 7])
  })

  it('空 payload 也能 round-trip', () => {
    const decoded = decodeMessage(encodeMessage(MSG.AUTH_OK, new Uint8Array()))
    expect(decoded.type).toBe(MSG.AUTH_OK)
    expect(decoded.payload.length).toBe(0)
  })

  it('encodeLoadReply / decodeLoadReply 拆分两段', () => {
    const missing = new Uint8Array([1, 2, 3, 4, 5])
    const sv = new Uint8Array([6, 7])
    const { missing: m, stateVector: s } = decodeLoadReply(encodeLoadReply(missing, sv))
    expect([...m]).toEqual([1, 2, 3, 4, 5])
    expect([...s]).toEqual([6, 7])
  })

  it('encodeEditRequest / decodeEditRequest round-trip', () => {
    for (const n of [0, 1, 7, 255, 4096]) {
      expect(decodeEditRequest(encodeEditRequest(n))).toBe(n)
    }
  })
})

describe('awareness 二进制 codec', () => {
  it('完整 state round-trip(含 user / selection / cursorTime / dragging)', () => {
    const state: AwarenessState = {
      user: { id: 'u-42', name: '阿岛', color: '#abcdef' },
      selection: { eventIds: ['aB3', 'aB4'], castEventIds: ['c1'], annotationIds: [] },
      cursorTime: 12.5,
      dragging: { id: 'cZ9', kind: 'cast', time: 30.25, playerId: 3 },
    }
    const back = decodeAwarenessState(encodeAwarenessState(state))
    expect(back.user?.id).toBe('u-42')
    expect(back.user?.name).toBe('阿岛')
    expect(back.user?.color).toBe(colorForUser('u-42')) // color 由 id 重算,不上线
    expect(back.selection).toEqual({
      eventIds: ['aB3', 'aB4'],
      castEventIds: ['c1'],
      annotationIds: [],
    })
    expect(back.cursorTime).toBe(12.5)
    expect(back.dragging).toEqual({ id: 'cZ9', kind: 'cast', time: 30.25, playerId: 3 })
  })

  it('上行 state(无 user)round-trip:user 不置位', () => {
    const state: Partial<AwarenessState> = {
      selection: { eventIds: [], castEventIds: [], annotationIds: [] },
      cursorTime: 8,
      dragging: null,
    }
    const back = decodeAwarenessState(encodeAwarenessState(state))
    expect(back.user).toBeUndefined()
    expect(back.cursorTime).toBe(8)
    expect(back.dragging).toBeNull()
  })

  it('dragging.playerId 为 null(damage/annotation)round-trip', () => {
    const state: Partial<AwarenessState> = {
      selection: { eventIds: [], castEventIds: [], annotationIds: [] },
      cursorTime: null,
      dragging: { id: 'd1', kind: 'damage', time: 5, playerId: null },
    }
    const back = decodeAwarenessState(encodeAwarenessState(state))
    expect(back.dragging?.playerId).toBeNull()
    expect(back.dragging?.kind).toBe('damage')
  })

  it('selection arrays round-trip(含 annotationIds)', () => {
    const state: Partial<AwarenessState> = {
      selection: { eventIds: ['e1', 'e2'], castEventIds: [], annotationIds: ['ann1'] },
      cursorTime: null,
      dragging: null,
    }
    const back = decodeAwarenessState(encodeAwarenessState(state))
    expect(back.selection.eventIds).toEqual(['e1', 'e2'])
    expect(back.selection.castEventIds).toEqual([])
    expect(back.selection.annotationIds).toEqual(['ann1'])
  })

  it('encodeAwarenessBinary / applyAwarenessBinary 把 peer state 投进对端 Awareness', () => {
    const docA = new Y.Doc()
    const awA = new Awareness(docA)
    awA.setLocalStateField('user', { id: 'uA', name: 'A', color: '#000' })
    awA.setLocalStateField('cursorTime', 3.5)
    const frame = encodeAwarenessBinary(awA, [awA.clientID])

    const docB = new Y.Doc()
    const awB = new Awareness(docB)
    applyAwarenessBinary(awB, frame, 'remote')
    const peer = awB.getStates().get(awA.clientID) as AwarenessState | undefined
    expect(peer?.user?.id).toBe('uA')
    expect(peer?.cursorTime).toBe(3.5)
  })

  it('null state(空字节段)round-trip:apply 移除该 client', () => {
    const docA = new Y.Doc()
    const awA = new Awareness(docA)
    awA.setLocalStateField('cursorTime', 1)
    const id = awA.clientID
    // 先让对端有该 client
    const docB = new Y.Doc()
    const awB = new Awareness(docB)
    applyAwarenessBinary(awB, encodeAwarenessBinary(awA, [id]), 'remote')
    expect(awB.getStates().has(id)).toBe(true)
    // A 置 null(模拟移除)并增 clock
    awA.setLocalState(null)
    applyAwarenessBinary(awB, encodeAwarenessBinary(awA, [id]), 'remote')
    expect(awB.getStates().has(id)).toBe(false)
  })

  it('injectAwarenessUser 用可信身份覆盖 user,color 由 id 重算', () => {
    const docA = new Y.Doc()
    const awA = new Awareness(docA)
    awA.setLocalStateField('cursorTime', 9) // 上行不带 user
    const upload = encodeAwarenessBinary(awA, [awA.clientID])

    const injected = injectAwarenessUser(upload, { id: 'real-id', name: '真名' })

    const docB = new Y.Doc()
    const awB = new Awareness(docB)
    applyAwarenessBinary(awB, injected, 'remote')
    const peer = awB.getStates().get(awA.clientID) as AwarenessState | undefined
    expect(peer?.user).toEqual({ id: 'real-id', name: '真名', color: colorForUser('real-id') })
    expect(peer?.cursorTime).toBe(9)
  })

  it('injectAwarenessUser 对 null state 透传(不注入、不破坏帧结构)', () => {
    const docA = new Y.Doc()
    const awA = new Awareness(docA)
    awA.setLocalStateField('cursorTime', 1)
    awA.setLocalState(null) // null state(移除)
    const removal = encodeAwarenessBinary(awA, [awA.clientID])
    const injected = injectAwarenessUser(removal, { id: 'x', name: 'y' })

    const docB = new Y.Doc()
    const awB = new Awareness(docB)
    expect(() => applyAwarenessBinary(awB, injected, 'remote')).not.toThrow()
    // null 帧不应凭空创建 peer
    expect(awB.getStates().has(awA.clientID)).toBe(false)
  })
})
