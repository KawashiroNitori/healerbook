import { describe, it, expect } from 'vitest'
import { env, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test'
import * as Y from 'yjs'
import { signAccessToken } from '@/workers/jwt'
import { encodeMessage, MSG, decodeMessage, decodeLoadReply } from '@/workers/collab/syncProtocol'

describe('TimelineDoc WebSocket 接入', () => {
  it('/connect 返回 101 并升级为 WebSocket', async () => {
    const id = env.TIMELINE_DOC.idFromName('t-conn-1')
    const stub = env.TIMELINE_DOC.get(id)
    const res = await stub.fetch('https://do/connect', {
      headers: { Upgrade: 'websocket', 'X-Timeline-Id': 't-conn-1' },
    })
    expect(res.status).toBe(101)
    expect(res.webSocket).toBeTruthy()
  })

  it('非 /connect 路径返回 400', async () => {
    const id = env.TIMELINE_DOC.idFromName('t-conn-2')
    const stub = env.TIMELINE_DOC.get(id)
    const res = await stub.fetch('https://do/other')
    expect(res.status).toBe(400)
  })

  async function connect(name: string) {
    const stub = env.TIMELINE_DOC.get(env.TIMELINE_DOC.idFromName(name))
    const res = await stub.fetch('https://do/connect', {
      headers: { Upgrade: 'websocket', 'X-Timeline-Id': name },
    })
    const ws = res.webSocket!
    ws.accept()
    return ws
  }

  it('编辑者发 AUTH 后收到 AUTH_OK', async () => {
    const docName = 't-auth-ok'
    await env.healerbook_timelines
      .prepare('INSERT INTO timeline_editors (timeline_id, user_id, created_at) VALUES (?,?,?)')
      .bind(docName, 'user-1', Date.now())
      .run()
    const jwt = await signAccessToken('user-1', 'U1', 'test-secret')
    const ws = await connect(docName)
    const got = new Promise<MessageEvent>(resolve => {
      ws.addEventListener('message', e => resolve(e as MessageEvent), { once: true })
    })
    ws.send(encodeMessage(MSG.AUTH, new TextEncoder().encode(jwt)))
    const msg = await got
    const frame = new Uint8Array(msg.data as ArrayBuffer)
    expect(frame[0]).toBe(MSG.AUTH_OK)
  })

  it('非编辑者发 AUTH 被关闭', async () => {
    const jwt = await signAccessToken('stranger', 'S', 'test-secret')
    const ws = await connect('t-auth-deny')
    const closed = new Promise<CloseEvent>(resolve => {
      ws.addEventListener('close', e => resolve(e as CloseEvent), { once: true })
    })
    ws.send(encodeMessage(MSG.AUTH, new TextEncoder().encode(jwt)))
    const ev = await closed
    expect(ev.code).toBeGreaterThanOrEqual(1000)
  })

  it('未鉴权先发非 AUTH 消息被关闭', async () => {
    const ws = await connect('t-auth-order')
    const closed = new Promise<CloseEvent>(resolve => {
      ws.addEventListener('close', e => resolve(e as CloseEvent), { once: true })
    })
    ws.send(encodeMessage(MSG.PUSH, new Uint8Array([1])))
    await closed
    expect(true).toBe(true)
  })

  async function authConnect(docName: string, userId: string) {
    await env.healerbook_timelines
      .prepare(
        'INSERT OR IGNORE INTO timeline_editors (timeline_id, user_id, created_at) VALUES (?,?,?)'
      )
      .bind(docName, userId, Date.now())
      .run()
    const jwt = await signAccessToken(userId, userId, 'test-secret')
    const ws = await connect(docName)
    const ok = new Promise<void>(resolve => {
      ws.addEventListener('message', function h(e) {
        if (new Uint8Array((e as MessageEvent).data as ArrayBuffer)[0] === MSG.AUTH_OK) {
          ws.removeEventListener('message', h)
          resolve()
        }
      })
    })
    ws.send(encodeMessage(MSG.AUTH, new TextEncoder().encode(jwt)))
    await ok
    return ws
  }

  it('alarm 触发 squash 后 updates 清空', async () => {
    const docName = 't-squash-1'
    const ws = await authConnect(docName, 'us')
    const doc = new Y.Doc()
    doc.getMap('m').set('v', 1)
    ws.send(encodeMessage(MSG.PUSH, Y.encodeStateAsUpdate(doc)))
    await new Promise(r => setTimeout(r, 50))

    const stub = env.TIMELINE_DOC.get(env.TIMELINE_DOC.idFromName(docName))
    await runInDurableObject(stub, async (_instance, state) => {
      await state.storage.setAlarm(Date.now())
    })
    await runDurableObjectAlarm(stub)
    await runInDurableObject(stub, async (_i, state) => {
      const n = state.storage.sql.exec('SELECT COUNT(*) AS n FROM updates').one().n
      expect(Number(n)).toBe(0)
    })
  })

  it('seed 灌入初始数据,getSnapshotJson 投影回 Timeline', async () => {
    const docName = 't-rpc-1'
    const seedDoc = new Y.Doc()
    seedDoc.getMap('meta').set('name', 'SeededTL')
    const stub = env.TIMELINE_DOC.get(env.TIMELINE_DOC.idFromName(docName))
    await stub.seed(Y.encodeStateAsUpdate(seedDoc))
    const json = await stub.getSnapshotJson()
    expect(json).not.toBeNull()
    expect(json!.name).toBe('SeededTL')
  })

  it('seed 幂等:第二次 seed 不覆盖', async () => {
    const docName = 't-rpc-2'
    const stub = env.TIMELINE_DOC.get(env.TIMELINE_DOC.idFromName(docName))
    const d1 = new Y.Doc()
    d1.getMap('meta').set('name', 'First')
    await stub.seed(Y.encodeStateAsUpdate(d1))
    const d2 = new Y.Doc()
    d2.getMap('meta').set('name', 'Second')
    await stub.seed(Y.encodeStateAsUpdate(d2))
    const json = await stub.getSnapshotJson()
    expect(json!.name).toBe('First')
  })

  it('fetch /connect 把 timelineId 持久化到 storage["docId"]', async () => {
    const docName = 't-persist-docid'
    const stub = env.TIMELINE_DOC.get(env.TIMELINE_DOC.idFromName(docName))
    await stub.fetch('https://do/connect', {
      headers: { Upgrade: 'websocket', 'X-Timeline-Id': docName },
    })
    await runInDurableObject(stub, async (_instance, state) => {
      const stored = await state.storage.get<string>('docId')
      expect(stored).toBe(docName)
    })
  })

  it('LOAD 返回 LOAD_REPLY;PUSH 广播给其他连接', async () => {
    const docName = 't-sync-1'
    const wsA = await authConnect(docName, 'ua')
    const wsB = await authConnect(docName, 'ub')

    const doc = new Y.Doc()
    doc.getMap('m').set('x', 42)
    const update = Y.encodeStateAsUpdate(doc)

    const broadcastToB = new Promise<Uint8Array>(resolve => {
      wsB.addEventListener('message', e => {
        const f = decodeMessage(new Uint8Array((e as MessageEvent).data as ArrayBuffer))
        if (f.type === MSG.BROADCAST) resolve(f.payload)
      })
    })
    wsA.send(encodeMessage(MSG.PUSH, update))
    const broadcasted = await broadcastToB
    const check = new Y.Doc()
    Y.applyUpdate(check, broadcasted)
    expect(check.getMap('m').get('x')).toBe(42)

    const wsC = await authConnect(docName, 'uc')
    const loadReply = new Promise<Uint8Array>(resolve => {
      wsC.addEventListener('message', e => {
        const f = decodeMessage(new Uint8Array((e as MessageEvent).data as ArrayBuffer))
        if (f.type === MSG.LOAD_REPLY) resolve(f.payload)
      })
    })
    wsC.send(encodeMessage(MSG.LOAD, Y.encodeStateVector(new Y.Doc())))
    const { missing } = decodeLoadReply(await loadReply)
    const loaded = new Y.Doc()
    Y.applyUpdate(loaded, missing)
    expect(loaded.getMap('m').get('x')).toBe(42)
  })
})
