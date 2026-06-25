import { TIME_EPS } from '@/utils/placement/types'
import type { CastEvent } from '@/types/timeline'
import type { Candidate } from './types'
import type { OptimizerContext } from './optimizer'

export interface MoveProposal {
  remove: CastEvent[]
  add: Candidate[]
}

/**
 * 应用一个 move（撤 remove、加 add），仅当：保持合法 + 不新增致死 + 总伤严格下降 时接受。
 * rng 预留给退火接受准则（计划二）；本版只接受严格改进。
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- reserved for plan-2 annealing accept-worse path
export function applyMove(ctx: OptimizerContext, mv: MoveProposal, _rng: () => number): boolean {
  const removeIds = new Set(mv.remove.map(c => c.id))
  const kept = ctx.added.filter(c => !removeIds.has(c.id))
  const newCasts = mv.add.map(c => ({
    id: ctx.deps.generateId(),
    actionId: c.action.id,
    timestamp: c.start,
    playerId: c.playerId,
  }))
  const candidate = [...kept, ...newCasts]

  const all = [...ctx.input.lockedCastEvents, ...candidate]
  const next = ctx.evaluator(all)

  // 合法
  const engine = ctx.deps.buildPlacementEngine(ctx.input, all, next)
  if (engine.findInvalidCastEvents().length > 0) return false
  // 不新增致死
  for (const id of next.lethal) if (!ctx.evalState.lethal.has(id)) return false
  // 严格降总伤
  if (next.total >= ctx.evalState.total - TIME_EPS) return false

  ctx.added = candidate
  ctx.evalState = next
  return true
}

/**
 * 提议一个随机 move：在现有 added 与候选间做 move/swap/replace/remove+add。
 * 偏向围绕高伤害事件采样（轻量启发，详细邻域剪枝见计划二）。
 */
export function proposeMove(ctx: OptimizerContext, rng: () => number): MoveProposal | null {
  if (ctx.cands.length === 0) return null
  const c = ctx.cands[Math.floor(rng() * ctx.cands.length)]
  // 若该候选时间点上已有同 player 的 cast，做替换；否则纯加入
  const clash = ctx.added.filter(
    a => a.playerId === c.playerId && Math.abs(a.timestamp - c.start) < TIME_EPS
  )
  return { remove: clash, add: [c] }
}
