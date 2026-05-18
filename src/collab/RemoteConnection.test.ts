import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as Y from 'yjs'
import { Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness'
import { RemoteConnection } from './RemoteConnection'
import {
  MSG,
  encodeMessage,
  decodeMessage,
  encodeLoadReply,
  encodeEditRequest,
} from './syncProtocol'

/** 内存 fake WebSocket:记录 client 发出的帧,可手动注入 server 帧 */
class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static OPEN = 1
  static CLOSED = 3
  readyState = 0
  binaryType = ''
  sent: Uint8Array[] = []
  onopen: (() => void | Promise<void>) | null = null
  onmessage: ((ev: { data: ArrayBuffer }) => void) | null = null
  onclose: ((ev: { code: number }) => void) | null = null
  onerror: (() => void) | null = null
  constructor(public url: string) {
    FakeWebSocket.instances.push(this)
  }
  send(data: Uint8Array) {
    this.sent.push(new Uint8Array(data))
  }
  close() {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.({ code: 1000 })
  }
  async fireOpen() {
    this.readyState = FakeWebSocket.OPEN
    await this.onopen?.()
  }
  fireMessage(frame: Uint8Array) {
    this.onmessage?.({
      data: frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength),
    })
  }
  fireClose(code: number) {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.({ code })
  }
}

beforeEach(() => {
  FakeWebSocket.instances = []
  vi.stubGlobal('WebSocket', FakeWebSocket)
})

afterEach(() => {
  vi.useRealTimers()
})

function lastSocket() {
  return FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
}

describe('RemoteConnection', () => {
  it('sends AUTH on open', async () => {
    const doc = new Y.Doc()
    const conn = new RemoteConnection(
      'ws://x/connect',
      doc,
      new Awareness(doc),
      () => Promise.resolve('jwt-abc'),
      () => {}
    )
    conn.connect()
    await lastSocket().fireOpen()
    const frame = decodeMessage(lastSocket().sent[0])
    expect(frame.type).toBe(MSG.AUTH)
    expect(new TextDecoder().decode(frame.payload)).toBe('jwt-abc')
    conn.destroy()
  })

  it('sends LOAD after AUTH_OK and reports connected', async () => {
    const doc = new Y.Doc()
    const statuses: string[] = []
    const conn = new RemoteConnection(
      'ws://x/connect',
      doc,
      new Awareness(doc),
      () => Promise.resolve('j'),
      s => statuses.push(s)
    )
    conn.connect()
    await lastSocket().fireOpen()
    lastSocket().fireMessage(encodeMessage(MSG.AUTH_OK, new Uint8Array()))
    expect(decodeMessage(lastSocket().sent[1]).type).toBe(MSG.LOAD)
    expect(statuses).toContain('connected')
    conn.destroy()
  })

  it('applies LOAD_REPLY missing and pushes server-missing state', async () => {
    const serverDoc = new Y.Doc()
    serverDoc.getMap('meta').set('name', 'hello')
    const missing = Y.encodeStateAsUpdate(serverDoc)
    const serverSV = Y.encodeStateVector(serverDoc)

    const doc = new Y.Doc()
    const conn = new RemoteConnection(
      'ws://x/connect',
      doc,
      new Awareness(doc),
      () => Promise.resolve('j'),
      () => {}
    )
    conn.connect()
    await lastSocket().fireOpen()
    lastSocket().fireMessage(encodeMessage(MSG.AUTH_OK, new Uint8Array()))
    lastSocket().fireMessage(encodeMessage(MSG.LOAD_REPLY, encodeLoadReply(missing, serverSV)))

    expect(doc.getMap('meta').get('name')).toBe('hello')
    const pushFrame = lastSocket().sent.find(f => decodeMessage(f).type === MSG.PUSH)
    expect(pushFrame).toBeDefined()
    conn.destroy()
  })

  it('forwards local updates as PUSH once connected', async () => {
    const doc = new Y.Doc()
    const conn = new RemoteConnection(
      'ws://x/connect',
      doc,
      new Awareness(doc),
      () => Promise.resolve('j'),
      () => {}
    )
    conn.connect()
    await lastSocket().fireOpen()
    lastSocket().fireMessage(encodeMessage(MSG.AUTH_OK, new Uint8Array()))
    lastSocket().fireMessage(
      encodeMessage(MSG.LOAD_REPLY, encodeLoadReply(new Uint8Array(), Y.encodeStateVector(doc)))
    )
    const before = lastSocket().sent.length
    doc.getMap('meta').set('k', 'v')
    const pushed = lastSocket().sent.slice(before).map(decodeMessage)
    expect(pushed.some(m => m.type === MSG.PUSH)).toBe(true)
    conn.destroy()
  })

  it('applies BROADCAST without echoing it back as PUSH', async () => {
    const doc = new Y.Doc()
    const conn = new RemoteConnection(
      'ws://x/connect',
      doc,
      new Awareness(doc),
      () => Promise.resolve('j'),
      () => {}
    )
    conn.connect()
    await lastSocket().fireOpen()
    lastSocket().fireMessage(encodeMessage(MSG.AUTH_OK, new Uint8Array()))
    lastSocket().fireMessage(
      encodeMessage(MSG.LOAD_REPLY, encodeLoadReply(new Uint8Array(), Y.encodeStateVector(doc)))
    )
    const before = lastSocket().sent.length

    const remoteDoc = new Y.Doc()
    remoteDoc.getMap('meta').set('fromPeer', 1)
    lastSocket().fireMessage(encodeMessage(MSG.BROADCAST, Y.encodeStateAsUpdate(remoteDoc)))

    expect(doc.getMap('meta').get('fromPeer')).toBe(1)
    const after = lastSocket().sent.slice(before).map(decodeMessage)
    expect(after.some(m => m.type === MSG.PUSH)).toBe(false)
    conn.destroy()
  })
})

describe('RemoteConnection awareness', () => {
  it('broadcasts local awareness after AUTH_OK', async () => {
    const doc = new Y.Doc()
    const awareness = new Awareness(doc)
    awareness.setLocalStateField('user', { id: 'u1', name: 'A', color: '#a855f7' })
    const conn = new RemoteConnection(
      'ws://x/connect',
      doc,
      awareness,
      () => Promise.resolve('j'),
      () => {}
    )
    conn.connect()
    await lastSocket().fireOpen()
    lastSocket().fireMessage(encodeMessage(MSG.AUTH_OK, new Uint8Array()))
    const awarenessFrame = lastSocket().sent.find(f => decodeMessage(f).type === MSG.AWARENESS)
    expect(awarenessFrame).toBeDefined()
    conn.destroy()
  })

  it('sends MSG.AWARENESS when local awareness changes', async () => {
    const doc = new Y.Doc()
    const awareness = new Awareness(doc)
    const conn = new RemoteConnection(
      'ws://x/connect',
      doc,
      awareness,
      () => Promise.resolve('j'),
      () => {}
    )
    conn.connect()
    await lastSocket().fireOpen()
    lastSocket().fireMessage(encodeMessage(MSG.AUTH_OK, new Uint8Array()))
    const before = lastSocket().sent.length
    awareness.setLocalStateField('cursorTime', 42)
    const after = lastSocket().sent.slice(before).map(decodeMessage)
    expect(after.some(m => m.type === MSG.AWARENESS)).toBe(true)
    conn.destroy()
  })

  it('applies a remote MSG.AWARENESS frame into the local Awareness', async () => {
    const doc = new Y.Doc()
    const awareness = new Awareness(doc)
    const conn = new RemoteConnection(
      'ws://x/connect',
      doc,
      awareness,
      () => Promise.resolve('j'),
      () => {}
    )
    conn.connect()
    await lastSocket().fireOpen()
    lastSocket().fireMessage(encodeMessage(MSG.AUTH_OK, new Uint8Array()))
    const peerDoc = new Y.Doc()
    const peerAwareness = new Awareness(peerDoc)
    peerAwareness.setLocalStateField('user', { id: 'u2', name: 'B', color: '#06b6d4' })
    const peerFrame = encodeAwarenessUpdate(peerAwareness, [peerAwareness.clientID])
    lastSocket().fireMessage(encodeMessage(MSG.AWARENESS, peerFrame))
    expect(awareness.getStates().get(peerAwareness.clientID)?.user?.name).toBe('B')
    conn.destroy()
  })

  it('does not echo a remote awareness update back out', async () => {
    const doc = new Y.Doc()
    const awareness = new Awareness(doc)
    const conn = new RemoteConnection(
      'ws://x/connect',
      doc,
      awareness,
      () => Promise.resolve('j'),
      () => {}
    )
    conn.connect()
    await lastSocket().fireOpen()
    lastSocket().fireMessage(encodeMessage(MSG.AUTH_OK, new Uint8Array()))
    const before = lastSocket().sent.length
    const peerDoc = new Y.Doc()
    const peerAwareness = new Awareness(peerDoc)
    peerAwareness.setLocalStateField('user', { id: 'u3', name: 'C', color: '#f97316' })
    lastSocket().fireMessage(
      encodeMessage(MSG.AWARENESS, encodeAwarenessUpdate(peerAwareness, [peerAwareness.clientID]))
    )
    const after = lastSocket().sent.slice(before).map(decodeMessage)
    expect(after.some(m => m.type === MSG.AWARENESS)).toBe(false)
    conn.destroy()
  })
})

describe('RemoteConnection auth hardening', () => {
  it('closes terminally and does not reconnect when getAuthToken returns null', async () => {
    const doc = new Y.Doc()
    const statuses: string[] = []
    const conn = new RemoteConnection(
      'ws://x/connect',
      doc,
      new Awareness(doc),
      () => Promise.resolve(null),
      s => statuses.push(s)
    )
    conn.connect()
    await lastSocket().fireOpen()
    // 拿不到 token:不发 AUTH 帧
    expect(lastSocket().sent.length).toBe(0)
    // 终态:状态回到 disconnected,且不再创建新连接
    expect(statuses[statuses.length - 1]).toBe('disconnected')
    expect(FakeWebSocket.instances.length).toBe(1)
    conn.destroy()
  })

  it('treats a server close with code 1008 as terminal and does not reconnect', async () => {
    const doc = new Y.Doc()
    const statuses: string[] = []
    const conn = new RemoteConnection(
      'ws://x/connect',
      doc,
      new Awareness(doc),
      () => Promise.resolve('j'),
      s => statuses.push(s)
    )
    conn.connect()
    await lastSocket().fireOpen()
    lastSocket().fireClose(1008)
    expect(statuses[statuses.length - 1]).toBe('disconnected')
    expect(FakeWebSocket.instances.length).toBe(1)
    conn.destroy()
  })

  it('reconnects after a non-1008 close and fetches a fresh token', async () => {
    vi.useFakeTimers()
    const doc = new Y.Doc()
    let calls = 0
    const conn = new RemoteConnection(
      'ws://x/connect',
      doc,
      new Awareness(doc),
      () => Promise.resolve(`tok${++calls}`),
      () => {}
    )
    conn.connect()
    await lastSocket().fireOpen()
    expect(new TextDecoder().decode(decodeMessage(lastSocket().sent[0]).payload)).toBe('tok1')
    // 非 1008 关闭 → 指数退避重连(首个退避 1000ms)
    lastSocket().fireClose(1006)
    await vi.advanceTimersByTimeAsync(1000)
    expect(FakeWebSocket.instances.length).toBe(2)
    // 重连握手取到新鲜 token
    await lastSocket().fireOpen()
    expect(new TextDecoder().decode(decodeMessage(lastSocket().sent[0]).payload)).toBe('tok2')
    conn.destroy()
  })

  it('treats a server close with code 4001 as terminal and reports revoked', async () => {
    const doc = new Y.Doc()
    const statuses: string[] = []
    const conn = new RemoteConnection(
      'ws://x/connect',
      doc,
      new Awareness(doc),
      () => Promise.resolve('j'),
      s => statuses.push(s)
    )
    conn.connect()
    await lastSocket().fireOpen()
    lastSocket().fireClose(4001)
    expect(statuses[statuses.length - 1]).toBe('revoked')
    expect(FakeWebSocket.instances.length).toBe(1) // 不重连
    conn.destroy()
  })

  it('keeps revoked status sticky after destroy()', async () => {
    const doc = new Y.Doc()
    const statuses: string[] = []
    const conn = new RemoteConnection(
      'ws://x/connect',
      doc,
      new Awareness(doc),
      () => Promise.resolve('j'),
      s => statuses.push(s)
    )
    conn.connect()
    await lastSocket().fireOpen()
    lastSocket().fireClose(4001)
    conn.destroy()
    expect(statuses[statuses.length - 1]).toBe('revoked')
  })

  it('invokes onEditRequest with the pushed pending-request count', async () => {
    const doc = new Y.Doc()
    const counts: number[] = []
    const conn = new RemoteConnection(
      'ws://x/connect',
      doc,
      new Awareness(doc),
      () => Promise.resolve('j'),
      () => {},
      n => counts.push(n)
    )
    conn.connect()
    await lastSocket().fireOpen()
    lastSocket().fireMessage(encodeMessage(MSG.AUTH_OK, new Uint8Array()))
    lastSocket().fireMessage(encodeMessage(MSG.EDIT_REQUEST, encodeEditRequest(3)))
    expect(counts).toEqual([3])
    conn.destroy()
  })
})
