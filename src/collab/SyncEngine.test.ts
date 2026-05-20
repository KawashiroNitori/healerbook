import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import * as Y from 'yjs'
import { SyncEngine } from './SyncEngine'
import { buildYDoc, yAddCastEvent, projectTimeline } from './docSchema'
import type { TimelineContent } from './types'

const content: TimelineContent = {
  name: 'eng',
  encounter: { id: 1, name: 'E', displayName: 'E', zone: '', damageEvents: [] },
  composition: { players: [{ id: 1, job: 'PLD' }] },
  damageEvents: [],
  castEvents: [],
  annotations: [],
  createdAt: 0,
}

describe('SyncEngine', () => {
  beforeEach(() => {
    // @ts-expect-error fake-indexeddb: 每个用例独立 DB
    // eslint-disable-next-line no-global-assign
    indexedDB = new IDBFactory()
  })

  it('本地编辑会持久化,重开引擎能读回', async () => {
    const e1 = await SyncEngine.create('t1', buildYDoc(content))
    yAddCastEvent(e1.doc, { id: 'c1', actionId: 1, timestamp: 1, playerId: 1 })
    await e1.flush() // 等持久化完成
    e1.destroy()

    const e2 = await SyncEngine.create('t1')
    expect(projectTimeline(e2.doc).castEvents.map(c => c.id)).toEqual(['c1'])
  })

  it('新建引擎不做任何编辑,seed 内容仍可持久化重开读回', async () => {
    const e1 = await SyncEngine.create('t3', buildYDoc(content))
    await e1.flush()
    e1.destroy()

    const e2 = await SyncEngine.create('t3')
    expect(projectTimeline(e2.doc).name).toBe('eng')
  })

  it('undo 撤销本地编辑', async () => {
    const e = await SyncEngine.create('t2', buildYDoc(content))
    yAddCastEvent(e.doc, { id: 'c1', actionId: 1, timestamp: 1, playerId: 1 })
    expect(projectTimeline(e.doc).castEvents).toHaveLength(1)
    e.undoManager.undo()
    expect(projectTimeline(e.doc).castEvents).toHaveLength(0)
  })
})

describe('SyncEngine - hadPersistedData', () => {
  beforeEach(() => {
    // eslint-disable-next-line no-global-assign
    indexedDB = new IDBFactory()
  })

  it('首次创建无本地数据时 hadPersistedData = false', async () => {
    const engine = await SyncEngine.create('no-cache-doc')
    expect(engine.hadPersistedData).toBe(false)
    engine.destroy()
  })

  it('seed 提供时也算作 false(seed 不是持久化数据)', async () => {
    const seed = new Y.Doc()
    seed.getMap('meta').set('name', 'fresh')
    const engine = await SyncEngine.create('seed-doc', seed)
    expect(engine.hadPersistedData).toBe(false)
    expect(engine.doc.getMap('meta').get('name')).toBe('fresh')
    engine.destroy()
  })

  it('再次打开同 docId 时 hadPersistedData = true', async () => {
    const first = await SyncEngine.create('reopen-doc')
    first.doc.getMap('meta').set('name', 'persisted-val')
    await first.flush()
    first.destroy()

    const second = await SyncEngine.create('reopen-doc')
    expect(second.hadPersistedData).toBe(true)
    expect(second.doc.getMap('meta').get('name')).toBe('persisted-val')
    second.destroy()
  })
})
