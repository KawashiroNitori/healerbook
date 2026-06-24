import { effectiveTrackGroup } from '@/types/mitigation'
import { TIME_EPS } from '@/utils/placement/types'
import type { Interval, PlacementEngine } from '@/utils/placement/types'
import { isInScope } from './scope'
import type { OptimizeInput, Candidate } from './types'

function inSomeLegal(t: number, legal: Interval[]): boolean {
  // 半开区间 [from, to) 成员判定：下界留 EPS 容差吸收"贴合 from"的浮点噪声；
  // 上界用朴素 < to，不收窄——避免丢弃贴近右沿的合法起点（权威合法性由 canPlaceCastEvent 复查）。
  return legal.some(iv => t >= iv.from - TIME_EPS && t < iv.to)
}

/** 同 (action,player) 内丢弃覆盖集被严格包含或相等的候选，仅留极大集。 */
function dropDominated(cands: Candidate[]): Candidate[] {
  const sorted = [...cands].sort((a, b) => b.covers.size - a.covers.size)
  const kept: Candidate[] = []
  for (const c of sorted) {
    const dominated = kept.some(k => {
      if (k.covers.size < c.covers.size) return false
      for (const id of c.covers) if (!k.covers.has(id)) return false
      return true // k.covers ⊇ c.covers
    })
    if (!dominated) kept.push(c)
  }
  return kept
}

/**
 * 候选生成（§4 断点集 Bcov ∪ Bwin；Bvar 留待计划二接入变体感知）。
 * 候选起点固定于断点；合法性后续由 PlacementEngine 动态复查。
 */
export function generateCandidates(input: OptimizeInput, engine: PlacementEngine): Candidate[] {
  const inScopeEvents = input.damageEvents.filter(isInScope)
  const result: Candidate[] = []

  for (const player of input.composition.players) {
    for (const action of input.actions.values()) {
      if (action.hidden) continue
      if (effectiveTrackGroup(action) !== action.id) continue // 只放 trackGroup 父
      if (!action.jobs.includes(player.job)) continue

      const legal = engine.getValidIntervals(action, player.id)
      if (legal.length === 0) continue

      const d = action.duration
      const starts = new Set<number>()
      for (const e of inScopeEvents) {
        if (inSomeLegal(e.time, legal)) starts.add(e.time) // 左沿对齐事件
        const late = e.time - d + TIME_EPS // 尽量晚放仍罩住 e
        if (inSomeLegal(late, legal)) starts.add(late)
      }
      for (const iv of legal) starts.add(iv.from) // 合法窗口左端

      const perAction: Candidate[] = []
      for (const start of starts) {
        const covers = new Set<string>()
        for (const e of inScopeEvents) {
          if (e.time >= start - TIME_EPS && e.time < start + d - TIME_EPS) covers.add(e.id)
        }
        if (covers.size === 0) continue // A2 零贡献剪枝
        perAction.push({ action, playerId: player.id, start, covers })
      }
      result.push(...dropDominated(perAction)) // A1 支配剪枝
    }
  }
  return result
}
