import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as Y from 'yjs'
import { Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness'
import { RemoteConnection } from './RemoteConnection'
import { MSG, encodeMessage, decodeMessage, encodeLoadReply } from './syncProtocol'

/** 内存 fake WebSocket:记录 client 发出的帧,可手动注入 server 帧 */
class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static OPEN = 1
  static CLOSED = 3
  readyState = 0
  binaryType = ''
  sent: Uint8Array[] = []
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: ArrayBuffer }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(public url: string) {
    FakeWebSocket.instances.push(this)
  }
  send(data: Uint8Array) {
    this.sent.push(new Uint8Array(data))
  }
  close() {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.()
  }
  fireOpen() {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.()
  }
  fireMessage(frame: Uint8Array) {
    this.onmessage?.({
      data: frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength),
    })
  }
}

beforeEach(() => {
  FakeWebSocket.instances = []
  vi.stubGlobal('WebSocket', FakeWebSocket)
})

function lastSocket() {
  return FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
}

describe('RemoteConnection', () => {
  it('sends AUTH on open', () => {
    const doc = new Y.Doc()
    const conn = new RemoteConnection(
      'ws://x/connect',
      doc,
      new Awareness(doc),
      () => 'jwt-abc',
      () => {}
    )
    conn.connect()
    lastSocket().fireOpen()
    const frame = decodeMessage(lastSocket().sent[0])
    expect(frame.type).toBe(MSG.AUTH)
    expect(new TextDecoder().decode(frame.payload)).toBe('jwt-abc')
    conn.destroy()
  })

  it('sends LOAD after AUTH_OK and reports connected', () => {
    const doc = new Y.Doc()
    const statuses: string[] = []
    const conn = new RemoteConnection(
      'ws://x/connect',
      doc,
      new Awareness(doc),
      () => 'j',
      s => statuses.push(s)
    )
    conn.connect()
    lastSocket().fireOpen()
    lastSocket().fireMessage(encodeMessage(MSG.AUTH_OK, new Uint8Array()))
    expect(decodeMessage(lastSocket().sent[1]).type).toBe(MSG.LOAD)
    expect(statuses).toContain('connected')
    conn.destroy()
  })

  it('applies LOAD_REPLY missing and pushes server-missing state', () => {
    const serverDoc = new Y.Doc()
    serverDoc.getMap('meta').set('name', 'hello')
    const missing = Y.encodeStateAsUpdate(serverDoc)
    const serverSV = Y.encodeStateVector(serverDoc)

    const doc = new Y.Doc()
    const conn = new RemoteConnection(
      'ws://x/connect',
      doc,
      new Awareness(doc),
      () => 'j',
      () => {}
    )
    conn.connect()
    lastSocket().fireOpen()
    lastSocket().fireMessage(encodeMessage(MSG.AUTH_OK, new Uint8Array()))
    lastSocket().fireMessage(encodeMessage(MSG.LOAD_REPLY, encodeLoadReply(missing, serverSV)))

    expect(doc.getMap('meta').get('name')).toBe('hello')
    const pushFrame = lastSocket().sent.find(f => decodeMessage(f).type === MSG.PUSH)
    expect(pushFrame).toBeDefined()
    conn.destroy()
  })

  it('forwards local updates as PUSH once connected', () => {
    const doc = new Y.Doc()
    const conn = new RemoteConnection(
      'ws://x/connect',
      doc,
      new Awareness(doc),
      () => 'j',
      () => {}
    )
    conn.connect()
    lastSocket().fireOpen()
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

  it('applies BROADCAST without echoing it back as PUSH', () => {
    const doc = new Y.Doc()
    const conn = new RemoteConnection(
      'ws://x/connect',
      doc,
      new Awareness(doc),
      () => 'j',
      () => {}
    )
    conn.connect()
    lastSocket().fireOpen()
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
  it('broadcasts local awareness after AUTH_OK', () => {
    const doc = new Y.Doc()
    const awareness = new Awareness(doc)
    awareness.setLocalStateField('user', { id: 'u1', name: 'A', color: '#a855f7' })
    const conn = new RemoteConnection(
      'ws://x/connect',
      doc,
      awareness,
      () => 'j',
      () => {}
    )
    conn.connect()
    lastSocket().fireOpen()
    lastSocket().fireMessage(encodeMessage(MSG.AUTH_OK, new Uint8Array()))
    const awarenessFrame = lastSocket().sent.find(f => decodeMessage(f).type === MSG.AWARENESS)
    expect(awarenessFrame).toBeDefined()
    conn.destroy()
  })

  it('sends MSG.AWARENESS when local awareness changes', () => {
    const doc = new Y.Doc()
    const awareness = new Awareness(doc)
    const conn = new RemoteConnection(
      'ws://x/connect',
      doc,
      awareness,
      () => 'j',
      () => {}
    )
    conn.connect()
    lastSocket().fireOpen()
    lastSocket().fireMessage(encodeMessage(MSG.AUTH_OK, new Uint8Array()))
    const before = lastSocket().sent.length
    awareness.setLocalStateField('cursorTime', 42)
    const after = lastSocket().sent.slice(before).map(decodeMessage)
    expect(after.some(m => m.type === MSG.AWARENESS)).toBe(true)
    conn.destroy()
  })

  it('applies a remote MSG.AWARENESS frame into the local Awareness', () => {
    const doc = new Y.Doc()
    const awareness = new Awareness(doc)
    const conn = new RemoteConnection(
      'ws://x/connect',
      doc,
      awareness,
      () => 'j',
      () => {}
    )
    conn.connect()
    lastSocket().fireOpen()
    lastSocket().fireMessage(encodeMessage(MSG.AUTH_OK, new Uint8Array()))
    const peerDoc = new Y.Doc()
    const peerAwareness = new Awareness(peerDoc)
    peerAwareness.setLocalStateField('user', { id: 'u2', name: 'B', color: '#06b6d4' })
    const peerFrame = encodeAwarenessUpdate(peerAwareness, [peerAwareness.clientID])
    lastSocket().fireMessage(encodeMessage(MSG.AWARENESS, peerFrame))
    expect(awareness.getStates().get(peerAwareness.clientID)?.user?.name).toBe('B')
    conn.destroy()
  })

  it('does not echo a remote awareness update back out', () => {
    const doc = new Y.Doc()
    const awareness = new Awareness(doc)
    const conn = new RemoteConnection(
      'ws://x/connect',
      doc,
      awareness,
      () => 'j',
      () => {}
    )
    conn.connect()
    lastSocket().fireOpen()
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
