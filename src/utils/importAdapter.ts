/**
 * 编辑器导入适配层 —— 纯函数。
 *
 * 把 /api/fflogs/import 返回的 Timeline 或 /api/encounter-templates 返回的事件，
 * 收窄成「可追加到当前时间轴」的子集，并提供过滤 / 职业映射 / cast 校验 / sync 去重。
 */

import type { Timeline, DamageEvent, CastEvent, SyncEvent, Composition } from '@/types/timeline'

export interface ImportableSubset {
  damageEvents: DamageEvent[]
  castEvents: CastEvent[]
  syncEvents: SyncEvent[]
  encounter: Timeline['encounter'] | null
  /** 显示给用户的来源标签，例："报告 ABC123 / 战斗 #5 / M3S" 或 "M3S" */
  sourceLabel: string
}

export type ImportRange = { mode: 'all' } | { mode: 'range'; start: number; end: number | null }

export function filterByRange<T>(events: T[], range: ImportRange, getTime: (e: T) => number): T[] {
  if (range.mode === 'all') return events
  return events.filter(e => {
    const t = getTime(e)
    if (t < range.start) return false
    if (range.end !== null && t >= range.end) return false
    return true
  })
}

export function buildPlayerIdMap(incoming: Composition, current: Composition): Map<number, number> {
  // 双方按 job 分桶，组内保持 composition.players 出现顺序
  const groupByJob = (c: Composition): Map<string, number[]> => {
    const groups = new Map<string, number[]>()
    for (const p of c.players) {
      const arr = groups.get(p.job)
      if (arr) arr.push(p.id)
      else groups.set(p.job, [p.id])
    }
    return groups
  }
  const inc = groupByJob(incoming)
  const cur = groupByJob(current)
  const map = new Map<number, number>()
  for (const [job, incIds] of inc) {
    const curIds = cur.get(job)
    if (!curIds) continue
    for (let i = 0; i < incIds.length; i++) {
      const target = curIds[i]
      if (target === undefined) break
      map.set(incIds[i], target)
    }
  }
  return map
}

export function extractImportableFromTimeline(t: Timeline): ImportableSubset {
  const parts: string[] = []
  if (t.fflogsSource) {
    parts.push(`报告 ${t.fflogsSource.reportCode}`)
    parts.push(`战斗 #${t.fflogsSource.fightId}`)
  }
  if (t.encounter?.name) parts.push(t.encounter.name)

  return {
    damageEvents: t.damageEvents ?? [],
    castEvents: t.castEvents ?? [],
    syncEvents: t.syncEvents ?? [],
    encounter: t.encounter ?? null,
    sourceLabel: parts.join(' / ') || '未知来源',
  }
}
