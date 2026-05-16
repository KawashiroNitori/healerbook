// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import * as Y from 'yjs'
import { runClientMigration } from './migration'
import { IndexedDBDocStore } from './storage/IndexedDBDocStore'
import { MIGRATION_FLAG } from './constants'
import { projectTimeline } from './docSchema'

describe('runClientMigration', () => {
  beforeEach(() => {
    // @ts-expect-error fake-indexeddb: 每个用例独立 DB
    // eslint-disable-next-line no-global-assign
    indexedDB = new IDBFactory()
    localStorage.clear()
  })

  it('把旧 localStorage 时间轴迁进 IndexedDB,并置标志位', async () => {
    localStorage.setItem(
      'healerbook_timelines',
      JSON.stringify([{ id: 'old1', name: 'Old', encounterId: '1', createdAt: 0, updatedAt: 0 }])
    )
    localStorage.setItem(
      'healerbook_timelines_old1',
      JSON.stringify({
        v: 2,
        n: 'Old',
        e: 1,
        c: [],
        de: [],
        ce: { a: [], t: [], p: [] },
        ca: 0,
        ua: 0,
      })
    )

    await runClientMigration()

    expect(localStorage.getItem(MIGRATION_FLAG)).toBe('1')
    const store = new IndexedDBDocStore()
    await store.open()
    const bin = await store.loadDoc('old1')
    expect(bin).not.toBeNull()
    const d = new Y.Doc()
    Y.applyUpdate(d, bin!)
    expect(projectTimeline(d).name).toBe('Old')
  })

  it('已迁移过则跳过', async () => {
    localStorage.setItem(MIGRATION_FLAG, '1')
    localStorage.setItem('healerbook_timelines', JSON.stringify([{ id: 'x' }]))
    await runClientMigration()
    const store = new IndexedDBDocStore()
    await store.open()
    expect(await store.loadDoc('x')).toBeNull()
  })
})
