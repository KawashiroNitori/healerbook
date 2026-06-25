import { TIME_EPS } from '@/utils/placement/types'
import type { CastEvent } from '@/types/timeline'
import type {
  OptimizeInput,
  OptimizeDeps,
  OptimizeOutput,
  Candidate,
  EvalResult,
  InfeasibleEvent,
} from './types'
import { applyMove, proposeMove } from './moves'
import { createPlacementEngine } from '@/utils/placement/engine'
import { generateId } from '@/utils/id'
import { mulberry32 } from './prng'
import { createEvaluator } from './evaluate'
import { generateCandidates, isGcdMit } from './candidates'

export interface OptimizerContext {
  input: OptimizeInput
  deps: OptimizeDeps
  evaluator: (casts: CastEvent[]) => EvalResult
  cands: Candidate[]
  added: CastEvent[]
  evalState: EvalResult
  infeasible: Map<string, InfeasibleEvent>
}

export function makeContext(
  input: OptimizeInput,
  deps: OptimizeDeps,
  cands: Candidate[]
): OptimizerContext {
  const evaluator = deps.createEvaluator(input)
  const evalState = evaluator(input.lockedCastEvents)
  return { input, deps, evaluator, cands, added: [], evalState, infeasible: new Map() }
}

export function makeCast(ctx: OptimizerContext, c: Candidate): CastEvent {
  return {
    id: ctx.deps.generateId(),
    actionId: c.action.id,
    timestamp: c.start,
    playerId: c.playerId,
  }
}

/** 当前 cast 全集 = locked + added。 */
function allCasts(ctx: OptimizerContext): CastEvent[] {
  return [...ctx.input.lockedCastEvents, ...ctx.added]
}

/**
 * 只读试探用的占位 cast id。probe 是纯只读探测，phase1/2/3 探测量极大，
 * 不能每次消耗 generateId。同一次 evaluate 只并入一个试探 cast，固定 id 不冲突；
 * 真实 id（nanoid，21 位随机）不会撞 '__probe__'。
 */
const PROBE_CAST_ID = '__probe__'
function trialCast(c: Candidate): CastEvent {
  return { id: PROBE_CAST_ID, actionId: c.action.id, timestamp: c.start, playerId: c.playerId }
}

/**
 * 试探接受一个候选：合法性闸 → 评估 → 可行性单调（不新增致死）→ 整体合法复查。
 * 通过则提交并返回新 EvalResult；否则不改状态返回 null。
 */
export function tryAccept(ctx: OptimizerContext, c: Candidate): EvalResult | null {
  const engine = ctx.deps.buildPlacementEngine(ctx.input, allCasts(ctx), ctx.evalState)
  if (!engine.canPlaceCastEvent(c.action, c.playerId, c.start).ok) return null

  const cast = makeCast(ctx, c)
  const next = ctx.evaluator([...allCasts(ctx), cast])

  // I2 可行性单调：不得新增致死事件
  for (const id of next.lethal) if (!ctx.evalState.lethal.has(id)) return null

  // I1 合法：加入后整组仍合法（资源争用复查）
  const engine2 = ctx.deps.buildPlacementEngine(ctx.input, [...allCasts(ctx), cast], next)
  if (engine2.findInvalidCastEvents().length > 0) return null

  ctx.added.push(cast)
  ctx.evalState = next
  return next
}

/** 阶段 1：消解致死事件（条件性，无致死 / 无 refHP 时整体跳过）。 */
export function phase1Feasibility(ctx: OptimizerContext): void {
  const shelved = new Set<string>()
  for (;;) {
    // 最致死优先（finalDamage / refHP 比值最大），跳过已 shelve
    let target: string | null = null
    let worst = -Infinity
    for (const id of ctx.evalState.lethal) {
      if (shelved.has(id)) continue
      const pe = ctx.evalState.perEvent.get(id)!
      const ratio = pe.referenceMaxHP ? pe.finalDamage / pe.referenceMaxHP : Infinity
      if (ratio > worst) {
        worst = ratio
        target = id
      }
    }
    if (target === null) break

    // 在覆盖 target 的候选里，选对 target 降伤最大者
    let best: { c: Candidate; next: EvalResult } | null = null
    for (const c of ctx.cands) {
      if (!c.covers.has(target)) continue
      const before = ctx.evalState.perEvent.get(target)!.finalDamage
      const next = probe(ctx, c)
      if (!next) continue
      const after = next.perEvent.get(target)!.finalDamage
      if (
        after < before - TIME_EPS &&
        (!best || after < best.next.perEvent.get(target)!.finalDamage)
      ) {
        best = { c, next }
      }
    }

    if (!best) {
      const pe = ctx.evalState.perEvent.get(target)!
      const orig = ctx.input.damageEvents.find(e => e.id === target)!.damage
      ctx.infeasible.set(target, {
        eventId: target,
        originalDamage: orig,
        bestAchievedFinalDamage: pe.finalDamage,
      })
      shelved.add(target)
      continue
    }
    // 真正接受（tryAccept 复查合法/可行并提交）
    if (!tryAccept(ctx, best.c)) {
      shelved.add(target)
    }
  }
}

/** 只读试探：返回若接受 c 后的 EvalResult，不改 ctx（用于打分）。 */
function probe(ctx: OptimizerContext, c: Candidate): EvalResult | null {
  const engine = ctx.deps.buildPlacementEngine(ctx.input, allCasts(ctx), ctx.evalState)
  if (!engine.canPlaceCastEvent(c.action, c.playerId, c.start).ok) return null
  return ctx.evaluator([...allCasts(ctx), trialCast(c)])
}

/**
 * 阶段 2：边际贪心最小化总伤。每轮在保持可行下选 ΔTotal 最大的候选加入，
 * 直到无正收益。朴素全量评估（计划二用 CELF 惰性贪心加速）。
 */
export function phase2Minimize(ctx: OptimizerContext): void {
  const placed = new Set<string>() // 已加入的候选 key，避免重复放同点同技能
  const keyOf = (c: Candidate) => `${c.action.id}@${c.start}#${c.playerId}`
  for (;;) {
    let best: { c: Candidate; next: EvalResult; gain: number } | null = null
    for (const c of ctx.cands) {
      if (placed.has(keyOf(c))) continue
      const next = probe(ctx, c)
      if (!next) continue
      // 可行性单调：不新增致死
      let ok = true
      for (const id of next.lethal)
        if (!ctx.evalState.lethal.has(id)) {
          ok = false
          break
        }
      if (!ok) continue
      const gain = ctx.evalState.total - next.total
      if (gain > (best?.gain ?? TIME_EPS)) best = { c, next, gain }
    }
    if (!best || best.gain <= TIME_EPS) break
    // 接受与否都标记 placed：复查失败也不再重试该候选，保证终止。
    tryAccept(ctx, best.c)
    placed.add(keyOf(best.c))
  }
}

/**
 * 危险阈值占比：复用 deriveLethalDangerous 的"剩血<5%"口径（finalDamage ≥ 满血×95%）。
 * GCD 减伤兜底只在事件减伤后仍达到此阈值时才介入。
 */
const DANGER_FRACTION = 0.95

/**
 * GCD 减伤兜底（规则一）：在非 GCD 减伤都生效（phase1/2/3 跑完）后，
 * 对仍"危险"（finalDamage ≥ 满血×95%）的 in-scope 事件，才动用 GCD 减伤候选去压。
 * 最危险优先；每次选对目标事件降伤最大的 GCD 候选，经 tryAccept 保证合法+可行。
 * 可能顺带把 phase1 标记的 infeasible 事件救回（GCD 把它压到不致死）。
 */
export function gcdFallback(ctx: OptimizerContext, gcdCands: Candidate[]): void {
  const shelved = new Set<string>()
  for (;;) {
    // 仍危险且未尽力的事件中，按 finalDamage/refHP 比值取最危险者
    let target: string | null = null
    let worst = -Infinity
    for (const [id, pe] of ctx.evalState.perEvent) {
      if (!pe.inScope || shelved.has(id) || pe.referenceMaxHP == null) continue
      if (pe.finalDamage < pe.referenceMaxHP * DANGER_FRACTION) continue // 已不危险
      const ratio = pe.finalDamage / pe.referenceMaxHP
      if (ratio > worst) {
        worst = ratio
        target = id
      }
    }
    if (target === null) break

    const before = ctx.evalState.perEvent.get(target)!.finalDamage
    let best: Candidate | null = null
    let bestAfter = Infinity
    for (const c of gcdCands) {
      if (!c.covers.has(target)) continue
      const next = probe(ctx, c)
      if (!next) continue
      const after = next.perEvent.get(target)!.finalDamage
      if (after < before - TIME_EPS && after < bestAfter) {
        best = c
        bestAfter = after
      }
    }
    if (!best) {
      shelved.add(target) // GCD 也压不动，放弃
      continue
    }
    if (!tryAccept(ctx, best)) shelved.add(target)
  }

  // GCD 可能把某些 infeasible（仍致死）事件救回 → 清理已不致死的
  for (const id of [...ctx.infeasible.keys()]) {
    const pe = ctx.evalState.perEvent.get(id)
    if (pe && pe.referenceMaxHP != null && pe.finalDamage < pe.referenceMaxHP) {
      ctx.infeasible.delete(id)
    }
  }
}

/**
 * 阶段 3：局部搜索精修，吃满 deadline 前的预算。维护 best 快照，
 * 预算到点回退到 best（不退化）。本版只接受严格改进的 move。
 */
export function phase3LocalSearch(
  ctx: OptimizerContext,
  rng: () => number,
  deadline: number
): void {
  let bestAdded = [...ctx.added]
  let bestEval = ctx.evalState
  while (ctx.deps.now() < deadline) {
    const mv = proposeMove(ctx, rng)
    if (!mv) break
    applyMove(ctx, mv, rng)
    if (ctx.evalState.total < bestEval.total) {
      bestAdded = [...ctx.added]
      bestEval = ctx.evalState
    }
  }
  ctx.added = bestAdded
  ctx.evalState = bestEval
}

export function defaultDeps(): OptimizeDeps {
  return {
    createEvaluator,
    buildPlacementEngine: (input, casts, eval0) =>
      createPlacementEngine({
        castEvents: casts,
        actions: input.actions,
        statusTimelineByPlayer: eval0.statusTimelineByPlayer,
        resolvedVariantByCastId: eval0.resolvedVariantByCastId,
      }),
    generateId,
    now: () => Date.now(),
    makeRandom: mulberry32,
  }
}

/** 依赖子技能可能链式解锁，但实际深度极浅；上限 3 轮足够且防御无限循环。 */
const MAX_FIXPOINT_ROUNDS = 3

/** 候选集稳定指纹（不动点判定用）。 */
function candidateKeys(cands: Candidate[]): string {
  return cands
    .map(c => `${c.action.id}@${c.start}#${c.playerId}`)
    .sort()
    .join('|')
}

/** 顶层编排：候选生成 → 阶段 1 → 阶段 2 → 阶段 3 → 汇总。 */
export function runOptimize(
  input: OptimizeInput,
  deps: OptimizeDeps = defaultDeps()
): OptimizeOutput {
  const start = deps.now()
  const budget = input.options?.timeBudgetMs ?? 3000
  const rng = deps.makeRandom(input.options?.seed ?? 1)

  // 候选基于当前 status 时间线生成（起点固定，合法性后续动态复查）
  const evaluator = deps.createEvaluator(input)
  const baseEval = evaluator(input.lockedCastEvents)
  const baseEngine = deps.buildPlacementEngine(input, input.lockedCastEvents, baseEval)
  let cands = generateCandidates(input, baseEngine)

  const ctx = makeContext(
    input,
    deps,
    cands.filter(c => !isGcdMit(c.action))
  )
  const totalBefore = ctx.evalState.total

  // 多轮：放完父技能后从当前时间线重生成候选，纳入被解锁的依赖子技能（如节制→神爱抚），
  // 直到候选集稳定（不动点）。规则一：主阶段只用非 GCD 候选。
  let prevKeys = candidateKeys(cands)
  for (let round = 0; round < MAX_FIXPOINT_ROUNDS; round++) {
    if (round > 0) {
      const engine = deps.buildPlacementEngine(input, allCasts(ctx), ctx.evalState)
      cands = generateCandidates(input, engine)
      const keys = candidateKeys(cands)
      if (keys === prevKeys) break // 无新解锁候选 → 不动点
      prevKeys = keys
      ctx.cands = cands.filter(c => !isGcdMit(c.action))
    }
    phase1Feasibility(ctx)
    phase2Minimize(ctx)
  }

  phase3LocalSearch(ctx, rng, start + budget)
  gcdFallback(
    ctx,
    cands.filter(c => isGcdMit(c.action))
  ) // 非 GCD 都生效后，对仍危险事件才动用 GCD 减伤（含被解锁的 GCD 子技能）

  return {
    addedCastEvents: ctx.added,
    infeasibleEvents: [...ctx.infeasible.values()],
    summary: {
      totalDamageBefore: totalBefore,
      totalDamageAfter: ctx.evalState.total,
      castsAdded: ctx.added.length,
      elapsedMs: deps.now() - start,
    },
  }
}
