import { describe, it, expect, vi } from 'vitest'
import { env, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test'
import * as Y from 'yjs'
import * as encoding from 'lib0/encoding'
import { signAccessToken } from '@/workers/jwt'
import { Awareness } from 'y-protocols/awareness'
import {
  encodeMessage,
  MSG,
  decodeMessage,
  decodeLoadReply,
  encodeAwarenessBinary,
  applyAwarenessBinary,
} from '@/collab/syncProtocol'

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

  it('purge 清空文档存储,getSnapshotJson 回到 null', async () => {
    const docName = 't-purge-1'
    const stub = env.TIMELINE_DOC.get(env.TIMELINE_DOC.idFromName(docName))
    const seedDoc = new Y.Doc()
    seedDoc.getMap('meta').set('name', 'ToPurge')
    await stub.seed(Y.encodeStateAsUpdate(seedDoc))
    expect(await stub.getSnapshotJson()).not.toBeNull()

    await stub.purge()
    expect(await stub.getSnapshotJson()).toBeNull()
  })

  it('ensureMetaName 给缺 name 的 doc 补名字(非破坏性)', async () => {
    const docName = 't-ensure-name-1'
    const stub = env.TIMELINE_DOC.get(env.TIMELINE_DOC.idFromName(docName))
    // 模拟旧版迁移留下的坏数据:有 meta 但无 name
    const seedDoc = new Y.Doc()
    seedDoc.getMap('meta').set('createdAt', 1)
    await stub.seed(Y.encodeStateAsUpdate(seedDoc))
    expect((await stub.getSnapshotJson())!.name).toBe('')

    const patched = await stub.ensureMetaName('补的名字')
    expect(patched).toBe(true)
    expect((await stub.getSnapshotJson())!.name).toBe('补的名字')
  })

  it('ensureMetaName 对已有 name 的 doc 不动', async () => {
    const docName = 't-ensure-name-2'
    const stub = env.TIMELINE_DOC.get(env.TIMELINE_DOC.idFromName(docName))
    const seedDoc = new Y.Doc()
    seedDoc.getMap('meta').set('name', '原名')
    await stub.seed(Y.encodeStateAsUpdate(seedDoc))

    const patched = await stub.ensureMetaName('新名')
    expect(patched).toBe(false)
    expect((await stub.getSnapshotJson())!.name).toBe('原名')
  })

  it('ensureMetaName 对空 doc / 空 name 是 no-op', async () => {
    const stub = env.TIMELINE_DOC.get(env.TIMELINE_DOC.idFromName('t-ensure-name-3'))
    expect(await stub.ensureMetaName('X')).toBe(false)

    const seedDoc = new Y.Doc()
    seedDoc.getMap('meta').set('createdAt', 1)
    await stub.seed(Y.encodeStateAsUpdate(seedDoc))
    expect(await stub.ensureMetaName('')).toBe(false)
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

  it('getDocId 返回持久化的 timelineId,可经 idFromString 反查', async () => {
    const docName = 't-getdocid'
    const stub = env.TIMELINE_DOC.get(env.TIMELINE_DOC.idFromName(docName))
    await stub.fetch('https://do/connect', {
      headers: { Upgrade: 'websocket', 'X-Timeline-Id': docName },
    })
    // 模拟拿到日志里的 DO id(hex),用 idFromString 还原后直连反查
    const hex = env.TIMELINE_DOC.idFromName(docName).toString()
    const reStub = env.TIMELINE_DOC.get(env.TIMELINE_DOC.idFromString(hex))
    expect(await reStub.getDocId()).toBe(docName)
  })

  it('getDocId 对从未 /connect 的 DO 返回 null', async () => {
    const stub = env.TIMELINE_DOC.get(env.TIMELINE_DOC.idFromName('t-getdocid-never'))
    expect(await stub.getDocId()).toBeNull()
  })

  describe('awareness snapshot on join', () => {
    it('新连接鉴权后立刻收到已在线连接的 awareness 快照', async () => {
      const docName = 't-awareness-snapshot'

      // 连接 A 鉴权
      const wsA = await authConnect(docName, 'ua-snap')

      // A 发送一帧 awareness(本地不带 user,服务端会按 JWT 注入)
      const docA = new Y.Doc()
      const awarenessA = new Awareness(docA)
      awarenessA.setLocalStateField('cursorTime', 12.5)
      const awarePayload = encodeAwarenessBinary(awarenessA, [awarenessA.clientID])
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
      // 补发帧应已注入 A 的可信身份(userId 'ua-snap'),并保留 A 发的 cursorTime
      const decoded = decodeMessage(awarenessFrames[0])
      const docB = new Y.Doc()
      const awarenessB = new Awareness(docB)
      applyAwarenessBinary(awarenessB, decoded.payload, 'remote')
      const peer = awarenessB.getStates().get(awarenessA.clientID) as
        | { user?: { id: string }; cursorTime?: number }
        | undefined
      expect(peer?.user?.id).toBe('ua-snap')
      expect(peer?.cursorTime).toBe(12.5)
    })

    it('大 selection(全选)仍广播给在线连接,不被 serializeAttachment 2KB 上限吞掉', async () => {
      const docName = 't-aware-large-selection'
      const wsA = await authConnect(docName, 'ua-large')
      const wsB = await authConnect(docName, 'ub-large')

      const awarenessToB = new Promise<Uint8Array>(resolve => {
        wsB.addEventListener('message', e => {
          const f = decodeMessage(new Uint8Array((e as MessageEvent).data as ArrayBuffer))
          if (f.type === MSG.AWARENESS) resolve(f.payload)
        })
      })

      // 模拟「全选」:几百个对象 id,注入身份后远超 DO attachment 2KB 上限
      const docA = new Y.Doc()
      const awarenessA = new Awareness(docA)
      const manyIds = Array.from({ length: 400 }, (_, i) => `obj-${i.toString().padStart(8, '0')}`)
      awarenessA.setLocalStateField('selection', {
        eventIds: manyIds,
        castEventIds: manyIds,
        annotationIds: [],
      })
      const payload = encodeAwarenessBinary(awarenessA, [awarenessA.clientID])
      expect(payload.byteLength).toBeGreaterThan(2048)
      wsA.send(encodeMessage(MSG.AWARENESS, payload))

      // 旧实现会在广播前 serializeAttachment 抛错吞掉本次广播,B 收不到 → 超时失败
      const broadcasted = await awarenessToB
      const docB = new Y.Doc()
      const awarenessB = new Awareness(docB)
      applyAwarenessBinary(awarenessB, broadcasted, 'remote')
      const peer = awarenessB.getStates().get(awarenessA.clientID) as
        | { user?: { id: string }; selection?: { eventIds: string[] } }
        | undefined
      expect(peer?.user?.id).toBe('ua-large')
      expect(peer?.selection?.eventIds).toHaveLength(400)
    })

    it('畸形/异格式 awareness 帧被丢弃:不崩连接、不广播,后续合法帧仍正常', async () => {
      const docName = 't-aware-malformed'
      const wsA = await authConnect(docName, 'ua-mal')
      const wsB = await authConnect(docName, 'ub-mal')

      // 构造一帧 ac44397 之前的"旧 wire 格式":selection 走单个 varString 而非 varString[]。
      // 当前 decodeAwarenessState 按 varString[] 解读 → 把字符串内部字节误当成长度 →
      // new Uint8Array(越界长度) 抛 RangeError,精确复现生产栈
      // (_readVarStringNative → readVarUint8Array → readUint8Array → new Uint8Array)。
      const staleClientId = 987654
      const stateEnc = encoding.createEncoder()
      encoding.writeUint8(stateEnc, 1 << 1) // 仅置 B_SEL_EVENT
      encoding.writeVarString(stateEnc, 'cast-event-id-that-is-fairly-long-0123456789')
      const stateBytes = encoding.toUint8Array(stateEnc)
      const envEnc = encoding.createEncoder()
      encoding.writeVarUint(envEnc, 1) // numClients
      encoding.writeVarUint(envEnc, staleClientId)
      encoding.writeVarUint(envEnc, 0) // clock
      encoding.writeVarUint8Array(envEnc, stateBytes)
      const malformed = encoding.toUint8Array(envEnc)

      const awarenessToB: Uint8Array[] = []
      wsB.addEventListener('message', e => {
        const f = decodeMessage(new Uint8Array((e as MessageEvent).data as ArrayBuffer))
        if (f.type === MSG.AWARENESS) awarenessToB.push(f.payload)
      })

      // 取证日志:坏帧应被 catch 并 dump 原始字节(测试与 DO 同 isolate,console 共享可拦截)
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // A 发畸形帧:DO 应丢弃(不抛、不广播),连接保持可用
      wsA.send(encodeMessage(MSG.AWARENESS, malformed))
      await new Promise(r => setTimeout(r, 50))

      // 坏帧被取证 dump:含 base64 原始字节,供离线还原其真实格式
      expect(errorSpy).toHaveBeenCalledWith(
        '[awareness] decode failed, dropping frame',
        expect.objectContaining({ userId: 'ua-mal', payloadB64: expect.any(String) })
      )
      errorSpy.mockRestore()

      // 连接仍健康:A 发一帧合法 awareness,B 应能收到并解出 peer
      const docA = new Y.Doc()
      const awA = new Awareness(docA)
      awA.setLocalStateField('cursorTime', 7.5)
      wsA.send(encodeMessage(MSG.AWARENESS, encodeAwarenessBinary(awA, [awA.clientID])))

      await vi.waitFor(
        () => {
          if (awarenessToB.length === 0) throw new Error('waiting for valid frame')
        },
        { timeout: 2000 }
      )

      const docB = new Y.Doc()
      const awB = new Awareness(docB)
      for (const p of awarenessToB) applyAwarenessBinary(awB, p, 'remote')
      // 合法帧解出
      const peer = awB.getStates().get(awA.clientID) as { cursorTime?: number } | undefined
      expect(peer?.cursorTime).toBe(7.5)
      // 畸形帧从未广播 → staleClientId 不会成为有效 peer
      expect(awB.getStates().has(staleClientId)).toBe(false)
    })
  })

  it('kickUser 用 4001 关闭目标用户连接,不影响他人', async () => {
    const docName = 't-kick-1'
    const wsA = await authConnect(docName, 'kick-a')
    const wsB = await authConnect(docName, 'kick-b')
    const closedA = new Promise<CloseEvent>(resolve => {
      wsA.addEventListener('close', e => resolve(e as CloseEvent), { once: true })
    })
    const stub = env.TIMELINE_DOC.get(env.TIMELINE_DOC.idFromName(docName))
    await runInDurableObject(stub, async instance => {
      await instance.kickUser('kick-a')
    })
    const ev = await closedA
    expect(ev.code).toBe(4001)
    expect(wsB.readyState).toBe(WebSocket.OPEN)
  })

  it('kickUser 对不在线用户为 no-op', async () => {
    const docName = 't-kick-2'
    const wsA = await authConnect(docName, 'kick-online')
    const stub = env.TIMELINE_DOC.get(env.TIMELINE_DOC.idFromName(docName))
    await runInDurableObject(stub, async instance => {
      await instance.kickUser('nobody-here')
    })
    expect(wsA.readyState).toBe(WebSocket.OPEN)
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
