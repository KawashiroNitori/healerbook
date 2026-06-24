import { describe, it, expect } from 'vitest'
import { makeContext, phase2Minimize, phase3LocalSearch } from './optimizer'
import { mulberry32 } from './prng'
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

function fakeDeps(
  rawDamage: Record<string, number>,
  cands: Candidate[],
  clock: { t: number }
): OptimizeDeps {
  const evaluator = (casts: CastEvent[]): EvalResult => {
    const perEvent = new Map()
    let total = 0
    for (const [id, base] of Object.entries(rawDamage)) {
      const hits = casts.filter(c =>
        cands.find(k => k.start === c.timestamp && k.action.id === c.actionId)?.covers.has(id)
      ).length
      const fd = base * Math.pow(0.5, hits)
      perEvent.set(id, { time: 10, inScope: true, finalDamage: fd })
      total += fd
    }
    return {
      total,
      perEvent,
      lethal: new Set(),
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
    now: () => clock.t++,
    makeRandom: mulberry32,
  }
}

describe('phase3LocalSearch', () => {
  it('预算内不退化（best 不升）', () => {
    const cands: Candidate[] = [
      { action: act(100), playerId: 1, start: 10, covers: new Set(['x']) },
    ]
    const clock = { t: 0 }
    const deps = fakeDeps({ x: 100000 }, cands, clock)
    const input: OptimizeInput = {
      damageEvents: [dmg('x', 100000)],
      lockedCastEvents: [],
      composition: { players: [{ id: 1, job: 'WHM' }] },
      actions: new Map([[100, act(100)]]),
      initialState: { statuses: [], timestamp: 0 } as never,
    }
    const ctx = makeContext(input, deps, cands)
    phase2Minimize(ctx)
    const before = ctx.evalState.total
    phase3LocalSearch(ctx, mulberry32(1), 100)
    expect(ctx.evalState.total).toBeLessThanOrEqual(before)
  })
})
