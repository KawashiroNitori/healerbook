import { effectiveTrackGroup } from '@/types/mitigation'
import type { MitigationAction } from '@/types/mitigation'
import { TIME_EPS } from '@/utils/placement/types'
import type { Interval, PlacementEngine } from '@/utils/placement/types'
import { isInScope } from './scope'
import type { OptimizeInput, Candidate } from './types'

/**
 * GCD 减伤技：由数据显式标 `category: 'gcd'`（占 GCD、有真实机会成本）。
 * 这类技能在排布上被降优先级：仅在非 GCD 减伤都生效后事件仍危险时作兜底（见 optimizer.gcdFallback）。
 * 父技能免费触发的赠送技（如节制→神爱抚）不打此标签，照常进主池贪心放置——否则不放等于浪费免费盾。
 */
export function isGcdMit(action: MitigationAction): boolean {
  return action.category.includes('gcd')
}

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
 *
 * 注意：covers 是基于 locked 基线 status 时间线的静态结构预测（lower-bound 启发式），
 * 生成后不随接受动态重算。真正的权威闸是 probe 的真实 simulate 增益 +
 * canPlaceCastEvent 合法性；设计 §5 的 recomputeLegality（接受后刷新受影响候选的
 * 合法窗口/覆盖）留待计划二。当前实现因此 sound（不产出非法/致死）但非 complete，
 * 符合 §8.4 的 best-effort 声明。
 */
export function generateCandidates(input: OptimizeInput, engine: PlacementEngine): Candidate[] {
  const inScopeEvents = input.damageEvents.filter(isInScope)
  const result: Candidate[] = []

  for (const player of input.composition.players) {
    for (const action of input.actions.values()) {
      if (action.hidden) continue
      if (effectiveTrackGroup(action) !== action.id) continue // 只放 trackGroup 父
      // 仅团辅减伤/盾：partywide 且 (percentage 或 shield)；剔除单体/自减与纯治疗
      if (!action.category.includes('partywide')) continue
      if (!action.category.includes('percentage') && !action.category.includes('shield')) continue
      if (!action.jobs.includes(player.job)) continue

      const legal = engine.getValidIntervals(action, player.id)
      if (legal.length === 0) continue

      const d = action.duration
      const starts = new Set<number>()
      for (const e of inScopeEvents) {
        if (inSomeLegal(e.time, legal)) starts.add(e.time) // 左沿对齐事件
        const late = e.time - d // 尽量晚放仍罩住 e
        if (inSomeLegal(late, legal)) starts.add(late)
      }
      for (const iv of legal) starts.add(iv.from) // 合法窗口左端

      const perAction: Candidate[] = []
      for (const start of starts) {
        const covers = new Set<string>()
        for (const e of inScopeEvents) {
          if (e.time - start > TIME_EPS && e.time <= start + d + TIME_EPS) covers.add(e.id)
        }
        if (covers.size === 0) continue // A2 零贡献剪枝
        perAction.push({ action, playerId: player.id, start, covers })
      }
      result.push(...dropDominated(perAction)) // A1 支配剪枝
    }
  }
  return result
}
