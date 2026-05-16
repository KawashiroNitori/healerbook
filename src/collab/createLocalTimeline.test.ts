import { describe, it, expect } from 'vitest'
import 'fake-indexeddb/auto'
import { createLocalTimeline } from './createLocalTimeline'
import { IndexedDBDocStore } from './storage/IndexedDBDocStore'
import type { TimelineContent } from './types'

function sampleContent(): TimelineContent {
  return {
    name: '测试轴',
    encounter: { id: 88, name: 'E', displayName: 'E', zone: '', damageEvents: [] },
    composition: { players: [{ id: 0, job: 'WHM' }] },
    damageEvents: [],
    castEvents: [],
    annotations: [],
    createdAt: 100,
  }
}

describe('createLocalTimeline', () => {
  it('persists snapshot and meta, returns the new id', async () => {
    const id = await createLocalTimeline(sampleContent())
    expect(id).toBeTruthy()

    const store = new IndexedDBDocStore()
    await store.open()
    expect(await store.loadDoc(id)).not.toBeNull()

    const meta = await store.getMeta(id)
    expect(meta).not.toBeNull()
    expect(meta?.docId).toBe(id)
    expect(meta?.name).toBe('测试轴')
    expect(meta?.encounterId).toBe(88)
    expect(meta?.published).toBe(false)
  })

  it('generates distinct ids on each call', async () => {
    const a = await createLocalTimeline(sampleContent())
    const b = await createLocalTimeline(sampleContent())
    expect(a).not.toBe(b)
  })
})
