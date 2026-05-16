import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import * as Y from 'yjs'
import { IndexedDBDocStore } from './IndexedDBDocStore'
import { IDB_NAME, IDB_STORE_UPDATES } from '../constants'

function countUpdates(docId: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME)
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction(IDB_STORE_UPDATES, 'readonly')
      const idx = tx.objectStore(IDB_STORE_UPDATES).index('docId')
      const cReq = idx.count(docId)
      cReq.onsuccess = () => {
        resolve(cReq.result)
        db.close()
      }
      cReq.onerror = () => reject(cReq.error)
    }
    req.onerror = () => reject(req.error)
  })
}

function freshDoc(name: string): Uint8Array {
  const d = new Y.Doc()
  d.getMap('meta').set('name', name)
  return Y.encodeStateAsUpdate(d)
}

describe('IndexedDBDocStore', () => {
  let store: IndexedDBDocStore
  beforeEach(async () => {
    // @ts-expect-error fake-indexeddb: 每个用例独立 DB
    // eslint-disable-next-line no-global-assign
    indexedDB = new IDBFactory()
    store = new IndexedDBDocStore()
    await store.open()
  })

  it('appendUpdate 后 loadDoc 能读回内容', async () => {
    await store.appendUpdate('t1', freshDoc('hello'))
    const bin = await store.loadDoc('t1')
    expect(bin).not.toBeNull()
    const d = new Y.Doc()
    Y.applyUpdate(d, bin!)
    expect(d.getMap('meta').get('name')).toBe('hello')
  })

  it('loadDoc 对不存在的 id 返回 null', async () => {
    expect(await store.loadDoc('nope')).toBeNull()
  })

  it('多条 update 合并读回', async () => {
    const d = new Y.Doc()
    d.getMap('meta').set('name', 'a')
    await store.appendUpdate('t1', Y.encodeStateAsUpdate(d))
    d.getMap('meta').set('extra', 1)
    await store.appendUpdate('t1', Y.encodeStateAsUpdate(d))
    const out = new Y.Doc()
    Y.applyUpdate(out, (await store.loadDoc('t1'))!)
    expect(out.getMap('meta').get('extra')).toBe(1)
  })

  it('squash 后 updates 清空、内容不丢', async () => {
    const d = new Y.Doc()
    for (let i = 0; i < 5; i++) {
      d.getMap('meta').set('k' + i, i)
      await store.appendUpdate('t1', Y.encodeStateAsUpdate(d))
    }
    expect(await countUpdates('t1')).toBeGreaterThan(0)
    await store.squash('t1')
    expect(await countUpdates('t1')).toBe(0)
    const out = new Y.Doc()
    Y.applyUpdate(out, (await store.loadDoc('t1'))!)
    expect(out.getMap('meta').get('k4')).toBe(4)
    // squash 后 updates 表应为空 —— 再 append 一条,loadDoc 仍正确
    d.getMap('meta').set('k9', 9)
    await store.appendUpdate('t1', Y.encodeStateAsUpdate(d))
    const out2 = new Y.Doc()
    Y.applyUpdate(out2, (await store.loadDoc('t1'))!)
    expect(out2.getMap('meta').get('k9')).toBe(9)
  })
})

describe('meta store', () => {
  beforeEach(() => {
    // @ts-expect-error fake-indexeddb: 每个用例独立 DB
    // eslint-disable-next-line no-global-assign
    indexedDB = new IDBFactory()
  })

  it('puts and gets a meta row', async () => {
    const store = new IndexedDBDocStore()
    await store.open()
    const meta = {
      docId: 'd1',
      name: 'T',
      encounterId: 42,
      createdAt: 1,
      updatedAt: 2,
      composition: null,
      published: false,
    }
    await store.putMeta(meta)
    expect(await store.getMeta('d1')).toEqual(meta)
  })

  it('getAllMeta returns every row', async () => {
    const store = new IndexedDBDocStore()
    await store.open()
    await store.putMeta({
      docId: 'a',
      name: 'A',
      encounterId: 0,
      createdAt: 1,
      updatedAt: 1,
      composition: null,
      published: false,
    })
    await store.putMeta({
      docId: 'b',
      name: 'B',
      encounterId: 0,
      createdAt: 1,
      updatedAt: 1,
      composition: null,
      published: true,
    })
    const all = await store.getAllMeta()
    expect(all.map(m => m.docId).sort()).toEqual(['a', 'b'])
  })

  it('deleteDoc removes snapshot, updates and meta', async () => {
    const store = new IndexedDBDocStore()
    await store.open()
    await store.appendUpdate('x', new Uint8Array([1, 2, 3]))
    await store.putMeta({
      docId: 'x',
      name: 'X',
      encounterId: 0,
      createdAt: 1,
      updatedAt: 1,
      composition: null,
      published: false,
    })
    await store.deleteDoc('x')
    expect(await store.loadDoc('x')).toBeNull()
    expect(await store.getMeta('x')).toBeNull()
  })

  it('rekey with same oldId and newId is a no-op that preserves data', async () => {
    const store = new IndexedDBDocStore()
    await store.open()
    await store.appendUpdate('same', new Uint8Array([9]))
    await store.putMeta({
      docId: 'same',
      name: 'S',
      encounterId: 3,
      createdAt: 1,
      updatedAt: 1,
      composition: null,
      published: false,
    })
    await store.rekey('same', 'same')
    expect(await store.loadDoc('same')).not.toBeNull()
    expect((await store.getMeta('same'))?.docId).toBe('same')
    expect((await store.getMeta('same'))?.encounterId).toBe(3)
  })

  it('rekey moves snapshot, updates and meta to a new docId', async () => {
    const store = new IndexedDBDocStore()
    await store.open()
    await store.appendUpdate('old', new Uint8Array([9]))
    await store.putMeta({
      docId: 'old',
      name: 'O',
      encounterId: 7,
      createdAt: 1,
      updatedAt: 1,
      composition: null,
      published: false,
    })
    await store.rekey('old', 'new')
    expect(await store.loadDoc('old')).toBeNull()
    expect(await store.getMeta('old')).toBeNull()
    expect(await store.loadDoc('new')).not.toBeNull()
    expect((await store.getMeta('new'))?.docId).toBe('new')
    expect((await store.getMeta('new'))?.encounterId).toBe(7)
  })
})
