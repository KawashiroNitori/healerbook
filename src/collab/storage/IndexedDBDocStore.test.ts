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
