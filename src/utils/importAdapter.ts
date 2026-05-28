/**
 * 编辑器导入适配层 —— 纯函数。
 *
 * 把 /api/fflogs/import 返回的 Timeline 或 /api/encounter-templates 返回的事件，
 * 收窄成「可追加到当前时间轴」的子集，并提供过滤 / 职业映射 / cast 校验 / sync 去重。
 */

import type { Timeline, DamageEvent, CastEvent, SyncEvent, Composition } from '@/types/timeline'
import type { MitigationAction } from '@/types/mitigation'
import type { StatusTimelineByPlayer, PlacementEngine } from '@/utils/placement/types'
import type { createPlacementEngine } from '@/utils/placement/engine'

export interface ImportableSubset {
  damageEvents: DamageEvent[]
  castEvents: CastEvent[]
  syncEvents: SyncEvent[]
  encounter: Timeline['encounter'] | null
  /** 报告内的 incoming composition；用于按职业映射 playerId */
  composition: Composition
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

export interface ValidateCastsArgs {
  incoming: CastEvent[]
  playerIdMap: Map<number, number>
  baseTimeline: Timeline
  mitigationActions: MitigationAction[]
  statusTimelineByPlayer: StatusTimelineByPlayer
  /** 注入 engine factory，方便测试 / 解耦 */
  createEngine: typeof createPlacementEngine
}

export function validateCastsForImport(args: ValidateCastsArgs): {
  kept: CastEvent[]
  skipped: number
} {
  const {
    incoming,
    playerIdMap,
    baseTimeline,
    mitigationActions,
    statusTimelineByPlayer,
    createEngine,
  } = args
  const actionMap = new Map(mitigationActions.map(a => [a.id, a]))
  const sorted = [...incoming].sort((a, b) => a.timestamp - b.timestamp)

  const accepted: CastEvent[] = []
  let skipped = 0

  // 每次接受新 cast 后重建 engine —— O(n²) 但 n≈50，可接受
  const buildEngine = (): PlacementEngine =>
    createEngine({
      castEvents: [...baseTimeline.castEvents, ...accepted],
      actions: actionMap,
      statusTimelineByPlayer,
    })
  let engine = buildEngine()

  for (const raw of sorted) {
    const mappedId = playerIdMap.get(raw.playerId)
    if (mappedId === undefined) {
      // reason: incoming playerId not present in current composition
      skipped++
      continue
    }
    const action = actionMap.get(raw.actionId)
    if (!action) {
      // reason: actionId not in mitigation registry
      skipped++
      continue
    }
    // excludeId 传 undefined：incoming cast 不在 engine 当前 castEvents 内，无需排除
    const result = engine.canPlaceCastEvent(action, mappedId, raw.timestamp, undefined)
    if (!result.ok) {
      // reason: placement engine rejected (CD / status / resource)
      skipped++
      continue
    }
    accepted.push({ ...raw, playerId: mappedId })
    engine = buildEngine()
  }

  return { kept: accepted, skipped }
}

export function dedupeSyncEvents(
  incoming: SyncEvent[],
  existing: SyncEvent[]
): { kept: SyncEvent[]; dedupedCount: number } {
  const taken = new Set(existing.map(s => s.actionId))
  const kept: SyncEvent[] = []
  let dedupedCount = 0
  for (const s of incoming) {
    if (taken.has(s.actionId)) {
      dedupedCount++
      continue
    }
    kept.push(s)
  }
  return { kept, dedupedCount }
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
    composition: t.composition ?? { players: [] },
    sourceLabel: parts.join(' / ') || '未知来源',
  }
}
