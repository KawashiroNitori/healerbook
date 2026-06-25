import { describe, it, expect } from 'vitest'
import { makeContext, phase1Feasibility } from './optimizer'
import type { OptimizeInput, Candidate, EvalResult, OptimizeDeps } from './types'
import type { MitigationAction } from '@/types/mitigation'
import type { DamageEvent, CastEvent } from '@/types/timeline'
import type { PlacementEngine } from '@/utils/placement/types'

const act = (id: number): MitigationAction =>
  ({
    id,
    name: `a${id}`,
    icon: '',
    jobs: ['WHM'],
    duration: 30,
    cooldown: 60,
    category: ['partywide', 'percentage'],
  }) as MitigationAction
const dmg = (id: string, damage: number): DamageEvent =>
  ({ id, name: id, time: 10, damage, type: 'aoe', damageType: 'magical' }) as DamageEvent

// fake：每放一个覆盖事件 e 的 cast，把 e 的 finalDamage 砍半
function fakeDeps(
  rawDamage: Record<string, number>,
  refHP: number,
  cands: Candidate[]
): OptimizeDeps {
  const evaluator = (casts: CastEvent[]): EvalResult => {
    const perEvent = new Map(),
      lethal = new Set<string>()
    let total = 0
    for (const [id, base] of Object.entries(rawDamage)) {
      const hits = casts.filter(c =>
        cands.find(k => k.start === c.timestamp && k.action.id === c.actionId)?.covers.has(id)
      ).length
      const fd = base / Math.pow(2, hits)
      perEvent.set(id, { time: 10, inScope: true, finalDamage: fd, referenceMaxHP: refHP })
      total += fd
      if (fd >= refHP) lethal.add(id)
    }
    return {
      total,
      perEvent,
      lethal,
      statusTimelineByPlayer: new Map(),
      resolvedVariantByCastId: new Map(),
    }
  }
  return {
    createEvaluator: () => evaluator,
    buildPlacementEngine: () =>
      ({
        canPlaceCastEvent: () => ({ ok: true }),
        findInvalidCastEvents: () => [],
      }) as unknown as PlacementEngine,
    generateId: (() => {
      let n = 0
      return () => `g${n++}`
    })(),
    now: () => 0,
    makeRandom: () => () => 0,
  }
}

const input = (events: DamageEvent[]): OptimizeInput => ({
  damageEvents: events,
  lockedCastEvents: [],
  composition: { players: [{ id: 1, job: 'WHM' }] },
  actions: new Map([
    [100, act(100)],
    [200, act(200)],
  ]),
  initialState: { statuses: [], timestamp: 0 } as never,
  baseReferenceMaxHPForAoe: 100000,
})

describe('phase1Feasibility', () => {
  it('消解可救的致死事件', () => {
    const cands: Candidate[] = [
      { action: act(100), playerId: 1, start: 10, covers: new Set(['x']) },
      { action: act(200), playerId: 1, start: 10, covers: new Set(['x']) },
    ]
    const deps = fakeDeps({ x: 120000 }, 100000, cands) // 120000 致死，砍一半→60000 不致死
    const ctx = makeContext(input([dmg('x', 120000)]), deps, cands)
    phase1Feasibility(ctx)
    expect(ctx.evalState.lethal.has('x')).toBe(false)
    expect(ctx.added.length).toBeGreaterThanOrEqual(1)
    expect(ctx.infeasible.has('x')).toBe(false)
  })
  it('救不了的事件落入 infeasible', () => {
    const cands: Candidate[] = [] // 无候选可救
    const deps = fakeDeps({ y: 120000 }, 100000, cands)
    const ctx = makeContext(input([dmg('y', 120000)]), deps, cands)
    phase1Feasibility(ctx)
    expect(ctx.infeasible.has('y')).toBe(true)
  })
})
