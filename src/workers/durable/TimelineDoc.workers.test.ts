import { describe, it, expect, vi } from 'vitest'
import { env, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test'
import * as Y from 'yjs'
import { signAccessToken } from '@/workers/jwt'
import { encodeMessage, MSG, decodeMessage, decodeLoadReply } from '@/collab/syncProtocol'

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

  it('flush 把阵容回写 D1 timelines.content', async () => {
    const docName = 't-d1-comp'
    await env.healerbook_timelines
      .prepare(
        'INSERT INTO timelines (id, name, author_id, author_name, published_at, updated_at, version, content) VALUES (?,?,?,?,?,?,?,?)'
      )
      .bind(docName, 'TL', 'us', 'Us', 1, 1, 1, '{}')
      .run()

    const stub = env.TIMELINE_DOC.get(env.TIMELINE_DOC.idFromName(docName))
    // /connect 让 DO 记下 timelineId（writeSnapshotCache 依赖 cachedDocId）
    await stub.fetch('https://do/connect', {
      headers: { Upgrade: 'websocket', 'X-Timeline-Id': docName },
    })

    // seed 一个带阵容的 Y.Doc（composition Map:key=玩家槽位 id，value={job}）
    const doc = new Y.Doc()
    const comp = doc.getMap('composition')
    const p0 = new Y.Map()
    p0.set('job', 'WHM')
    comp.set('0', p0)
    const p1 = new Y.Map()
    p1.set('job', 'SGE')
    comp.set('1', p1)
    await stub.seed(Y.encodeStateAsUpdate(doc))

    // 直接执行 DO 的 alarm(= squash + 写 KV 快照 + 回写 D1 阵容)
    await runInDurableObject(stub, async instance => {
      await instance.alarm()
    })

    const row = await env.healerbook_timelines
      .prepare('SELECT content FROM timelines WHERE id = ?')
      .bind(docName)
      .first<{ content: string }>()
    const parsed = JSON.parse(row!.content) as {
      composition: { players: { id: number; job: string }[] }
    }
    expect(parsed.composition.players.map(p => p.job)).toEqual(['WHM', 'SGE'])
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

  describe('awareness snapshot on join', () => {
    it('新连接鉴权后立刻收到已在线连接的 awareness 快照', async () => {
      const docName = 't-awareness-snapshot'

      // 连接 A 鉴权
      const wsA = await authConnect(docName, 'ua-snap')

      // A 发送一帧 awareness
      const awarePayload = new Uint8Array([1, 2, 3, 4])
      wsA.send(encodeMessage(MSG.AWARENESS, awarePayload))

      // 等待 DO 处理完 A 的 awareness 帧
      await new Promise(r => setTimeout(r, 50))

      // 连接 B 鉴权;收集鉴权后到来的所有消息
      const stub = env.TIMELINE_DOC.get(env.TIMELINE_DOC.idFromName(docName))
      await env.healerbook_timelines
        .prepare(
          'INSERT OR IGNORE INTO timeline_editors (timeline_id, user_id, created_at) VALUES (?,?,?)'
        )
        .bind(docName, 'ub-snap', Date.now())
        .run()
      const jwtB = await signAccessToken('ub-snap', 'ub-snap', 'test-secret')
      const resB = await stub.fetch('https://do/connect', {
        headers: { Upgrade: 'websocket', 'X-Timeline-Id': docName },
      })
      const wsB = resB.webSocket!
      wsB.accept()

      const frames: Uint8Array[] = []
      wsB.addEventListener('message', e => {
        frames.push(new Uint8Array((e as MessageEvent).data as ArrayBuffer))
      })

      // 发送鉴权
      wsB.send(encodeMessage(MSG.AUTH, new TextEncoder().encode(jwtB)))

      // 等待收到 AUTH_OK 和快照帧
      await vi.waitFor(
        () => {
          const hasAuthOk = frames.some(f => f[0] === MSG.AUTH_OK)
          const hasAwareness = frames.some(f => f[0] === MSG.AWARENESS)
          if (!hasAuthOk || !hasAwareness) throw new Error('waiting for frames')
        },
        { timeout: 2000 }
      )

      const awarenessFrames = frames.filter(f => f[0] === MSG.AWARENESS)
      expect(awarenessFrames.length).toBeGreaterThanOrEqual(1)
      const decoded = decodeMessage(awarenessFrames[0])
      expect(decoded.payload).toEqual(awarePayload)
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
