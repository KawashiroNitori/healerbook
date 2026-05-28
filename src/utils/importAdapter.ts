/**
 * 编辑器导入适配层 —— 纯函数。
 *
 * 把 /api/fflogs/import 返回的 Timeline 或 /api/encounter-templates 返回的事件，
 * 收窄成「可追加到当前时间轴」的子集，并提供过滤 / 职业映射 / cast 校验 / sync 去重。
 */

import type { Timeline, DamageEvent, CastEvent, SyncEvent } from '@/types/timeline'

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
