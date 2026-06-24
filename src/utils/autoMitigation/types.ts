import type { CastEvent, DamageEvent, Composition } from '@/types/timeline'
import type { MitigationAction } from '@/types/mitigation'
import type { PartyState } from '@/types/partyState'
import type { TimelineStatData } from '@/types/statData'
import type { StatusInterval } from '@/types/status'
import type { PlacementEngine } from '@/utils/placement/types'

export interface OptimizeOptions {
  timeBudgetMs?: number // 默认 ≈ 3000
  seed?: number // 确定性 PRNG 播种，默认 1
  aggressive?: boolean // 启发剪枝开关（计划二）；默认 true
}

export interface OptimizeInput {
  damageEvents: DamageEvent[]
  lockedCastEvents: CastEvent[] // 固定不动；空白入口 = []
  composition: Composition
  actions: Map<number, MitigationAction>
  initialState: PartyState
  statistics?: TimelineStatData
  baseReferenceMaxHPForAoe?: number
  baseReferenceMaxHPForTank?: number
  options?: OptimizeOptions
}

export interface InfeasibleEvent {
  eventId: string
  originalDamage: number
  bestAchievedFinalDamage: number
}

export interface OptimizeSummary {
  totalDamageBefore: number
  totalDamageAfter: number
  castsAdded: number
  elapsedMs: number
}

export interface OptimizeOutput {
  addedCastEvents: CastEvent[]
  infeasibleEvents: InfeasibleEvent[]
  summary: OptimizeSummary
}

export interface PerEventEval {
  time: number
  inScope: boolean
  finalDamage: number
  referenceMaxHP?: number
}

export interface EvalResult {
  total: number // Σ finalDamage（仅 in-scope）
  perEvent: Map<string, PerEventEval>
  lethal: Set<string> // in-scope 且 isLethal 的事件 id
  // 供下游构建 PlacementEngine，免二次 simulate
  statusTimelineByPlayer: Map<number, Map<number, StatusInterval[]>>
  resolvedVariantByCastId: Map<string, number>
}

export type Evaluator = (casts: CastEvent[]) => EvalResult

export interface Candidate {
  action: MitigationAction
  playerId: number
  start: number // = cast.timestamp
  covers: Set<string> // 覆盖的 in-scope 事件 id
}

/** 注入依赖：单测替换为 fake，生产用 defaultDeps()。 */
export interface OptimizeDeps {
  createEvaluator: (input: OptimizeInput) => Evaluator
  buildPlacementEngine: (
    input: OptimizeInput,
    casts: CastEvent[],
    eval0: EvalResult
  ) => PlacementEngine
  generateId: () => string
  now: () => number
  makeRandom: (seed: number) => () => number
}
