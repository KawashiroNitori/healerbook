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

  it('squash 经 GC 丢弃删除墓碑,显著缩小 snapshot 体积、内容一致', async () => {
    const id = env.TIMELINE_DOC.idFromName('t-sqlstore-gc')
    const stub = env.TIMELINE_DOC.get(id)
    await runInDurableObject(stub, async (_instance, state) => {
      const store = new DoSqlStore(state.storage.sql)
      store.init()

      // 制造大量内容,再整体删除 —— 模拟反复重导入留下的墓碑
      const d = new Y.Doc()
      const arr = d.getArray('big')
      d.transact(() => {
        for (let i = 0; i < 2000; i++) arr.push(['x'.repeat(50)])
      })
      store.appendUpdate(Y.encodeStateAsUpdate(d))
      const svAfterAdd = Y.encodeStateVector(d)
      d.transact(() => arr.delete(0, arr.length))
      store.appendUpdate(Y.encodeStateAsUpdate(d, svAfterAdd)) // 删除增量

      // squash 前:mergeUpdates 保留墓碑内容,体积大
      const beforeBytes = store.getMergedDoc().byteLength
      store.squash()
      // squash 后:snapshot 已 GC,墓碑内容被丢弃
      const afterBytes = store.getMergedDoc().byteLength

      expect(afterBytes).toBeLessThan(beforeBytes / 2)
      // 可见内容一致:数组已空
      const check = new Y.Doc()
      Y.applyUpdate(check, store.getMergedDoc())
      expect(check.getArray('big').length).toBe(0)
      expect(store.countUpdates()).toBe(0)
    })
  })

  it('isEmpty 在 init 后为 true、appendUpdate 后为 false', async () => {
    const id = env.TIMELINE_DOC.idFromName('t-sqlstore-3')
    const stub = env.TIMELINE_DOC.get(id)
    await runInDurableObject(stub, async (_instance, state) => {
      const store = new DoSqlStore(state.storage.sql)
      store.init()
      expect(store.isEmpty()).toBe(true)
      store.appendUpdate(freshUpdate('x', 42))
      expect(store.isEmpty()).toBe(false)
    })
  })

  it('clear 清空 snapshot 与 updates,isEmpty 回到 true', async () => {
    const id = env.TIMELINE_DOC.idFromName('t-sqlstore-clear')
    const stub = env.TIMELINE_DOC.get(id)
    await runInDurableObject(stub, async (_instance, state) => {
      const store = new DoSqlStore(state.storage.sql)
      store.init()
      store.appendUpdate(freshUpdate('a', 1))
      store.squash() // 写入 snapshot
      store.appendUpdate(freshUpdate('b', 2)) // 再留一条 update
      expect(store.isEmpty()).toBe(false)
      store.clear()
      expect(store.isEmpty()).toBe(true)
      expect(store.countUpdates()).toBe(0)
    })
  })

  it('seedSnapshot 幂等：第二次 seed 不覆盖第一次', async () => {
    const id = env.TIMELINE_DOC.idFromName('t-sqlstore-4')
    const stub = env.TIMELINE_DOC.get(id)
    await runInDurableObject(stub, async (_instance, state) => {
      const store = new DoSqlStore(state.storage.sql)
      store.init()
      store.seedSnapshot(freshUpdate('a', 1))
      store.seedSnapshot(freshUpdate('a', 999))
      const merged = store.getMergedDoc()
      const d = new Y.Doc()
      Y.applyUpdate(d, merged)
      expect(d.getMap('m').get('a')).toBe(1)
    })
  })
})
