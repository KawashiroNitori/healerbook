import { describe, it, expect } from 'vitest'
import { mergeTimelineList } from './homeTimelineList'
import type { LocalDocMeta } from '@/collab/types'
import type { MyTimelineItem } from '@/api/timelineShareApi'

function meta(
  p: Partial<LocalDocMeta> & Pick<LocalDocMeta, 'docId' | 'kind' | 'lastViewedAt'>
): LocalDocMeta {
  return {
    docId: p.docId,
    name: p.name ?? p.docId,
    encounterId: p.encounterId ?? 0,
    createdAt: p.createdAt ?? 0,
    updatedAt: p.updatedAt ?? 0,
    composition: p.composition ?? null,
    kind: p.kind,
    lastViewedAt: p.lastViewedAt,
  }
}

describe('mergeTimelineList', () => {
  it('按 lastViewedAt 倒序排列本地条目', () => {
    const list = mergeTimelineList(
      [
        meta({ docId: 'a', kind: 'local', lastViewedAt: 100 }),
        meta({ docId: 'b', kind: 'local', lastViewedAt: 300 }),
        meta({ docId: 'c', kind: 'visited', lastViewedAt: 200 }),
      ],
      []
    )
    expect(list.map(x => x.id)).toEqual(['b', 'c', 'a'])
  })

  it('服务端独有条目并入，按其 updatedAt 排序', () => {
    const server: MyTimelineItem[] = [
      { id: 's', name: 'S', publishedAt: 0, updatedAt: 250, composition: null },
    ]
    const list = mergeTimelineList([meta({ docId: 'a', kind: 'local', lastViewedAt: 100 })], server)
    expect(list.map(x => x.id)).toEqual(['s', 'a'])
    expect(list.find(x => x.id === 's')!.kind).toBe('published')
    expect(list.find(x => x.id === 's')!.encounterId).toBe(0)
  })

  it('本地与服务端同 id：本地条目优先，不重复', () => {
    const server: MyTimelineItem[] = [
      { id: 'a', name: 'A-server', publishedAt: 0, updatedAt: 999, composition: null },
    ]
    const list = mergeTimelineList(
      [meta({ docId: 'a', name: 'A-local', kind: 'published', lastViewedAt: 100 })],
      server
    )
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('A-local')
  })
})
