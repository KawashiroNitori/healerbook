/** HomePage 统一列表：本地 meta 与服务端「我发布的」按 id 合并去重、按最近查看排序 */
import type { LocalDocMeta } from '@/collab/types'
import type { MyTimelineListItem } from '@/types/apiContracts'
import type { Composition } from '@/types/timeline'

export interface HomeTimelineItem {
  id: string
  name: string
  kind: 'local' | 'published' | 'visited'
  encounterId: number
  createdAt: number
  updatedAt: number
  composition: Composition | null
  /** 排序键：本地用 lastViewedAt，服务端独有条目用其 updatedAt */
  sortAt: number
}

export function mergeTimelineList(
  metas: LocalDocMeta[],
  serverItems: MyTimelineListItem[]
): HomeTimelineItem[] {
  const items: HomeTimelineItem[] = metas.map(m => ({
    id: m.docId,
    name: m.name,
    kind: m.kind,
    encounterId: m.encounterId,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    composition: m.composition,
    sortAt: m.lastViewedAt ?? m.updatedAt ?? m.createdAt ?? 0,
  }))
  const localIds = new Set(items.map(x => x.id))
  for (const s of serverItems) {
    if (localIds.has(s.id)) continue
    items.push({
      id: s.id,
      name: s.name,
      kind: 'published',
      encounterId: 0,
      createdAt: s.publishedAt,
      updatedAt: s.updatedAt,
      composition: s.composition,
      sortAt: s.updatedAt,
    })
  }
  return items.sort((a, b) => b.sortAt - a.sortAt)
}
