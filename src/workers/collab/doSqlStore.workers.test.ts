import { describe, it, expect } from 'vitest'
import { env, runInDurableObject } from 'cloudflare:test'
import * as Y from 'yjs'
import { DoSqlStore } from './doSqlStore'

function freshUpdate(key: string, val: number): Uint8Array {
  const d = new Y.Doc()
  d.getMap('m').set(key, val)
  return Y.encodeStateAsUpdate(d)
}

describe('DoSqlStore', () => {
  it('append 后 getMergedDoc 能读回', async () => {
    const id = env.TIMELINE_DOC.idFromName('t-sqlstore-1')
    const stub = env.TIMELINE_DOC.get(id)
    await runInDurableObject(stub, async (_instance, state) => {
      const store = new DoSqlStore(state.storage.sql)
      store.init()
      store.appendUpdate(freshUpdate('a', 1))
      const merged = store.getMergedDoc()
      const d = new Y.Doc()
      Y.applyUpdate(d, merged)
      expect(d.getMap('m').get('a')).toBe(1)
      expect(store.countUpdates()).toBe(1)
    })
  })

  it('squash 后 updates 清空、内容保留', async () => {
    const id = env.TIMELINE_DOC.idFromName('t-sqlstore-2')
    const stub = env.TIMELINE_DOC.get(id)
    await runInDurableObject(stub, async (_instance, state) => {
      const store = new DoSqlStore(state.storage.sql)
      store.init()
      for (let i = 0; i < 4; i++) store.appendUpdate(freshUpdate('k' + i, i))
      store.squash()
      expect(store.countUpdates()).toBe(0)
      const d = new Y.Doc()
      Y.applyUpdate(d, store.getMergedDoc())
      expect(d.getMap('m').get('k3')).toBe(3)
    })
  })
})
