import type { CastEvent, DamageEvent, Composition } from '@/types/timeline'
import type { MitigationAction } from '@/types/mitigation'
import type { PartyState } from '@/types/partyState'
import type { TimelineStatData } from '@/types/statData'
import type { StatusInterval } from '@/types/status'
import type { PlacementEngine } from '@/utils/placement/types'

export interface OptimizeOptions {
  timeBudgetMs?: number // 默认 ≈ 3000
  seed?: number // 确定性 PRNG 播种，默认 1
  aggressive?: boolean // 计划二启发剪枝总开关；当前版本未接线（inert），保留以固化公共 API
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
  // 计算规模
  inScopeEventCount: number // in-scope 伤害事件数
  candidateCount: number // 候选放置点数（多轮取最大）
  simulateCalls: number // simulate 评估调用总数
  rounds: number // 候选重生成轮数
}

export interface OptimizeOutput {
  addedCastEvents: CastEvent[]
  infeasibleEvents: InfeasibleEvent[]
  summary: OptimizeSummary
}

/** 优化阶段标识（用于进度回显）。 */
export type OptimizePhase = 'feasibility' | 'minimize' | 'localSearch' | 'gcdFallback' | 'done'

/** 实时进度快照（worker 流式回传）。 */
export interface OptimizeProgress {
  phase: OptimizePhase
  round: number // 当前候选重生成轮（从 1 起）
  inScopeEventCount: number
  candidateCount: number
  simulateCalls: number
  castsPlaced: number
  elapsedMs: number
}

/** 进度回调（runOptimize 第三参数）。 */
export type OptimizeProgressCallback = (p: OptimizeProgress) => void

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
