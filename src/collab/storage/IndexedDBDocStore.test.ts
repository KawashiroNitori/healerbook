import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import * as Y from 'yjs'
import { IndexedDBDocStore } from './IndexedDBDocStore'

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
})
