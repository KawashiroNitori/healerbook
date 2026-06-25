import { describe, it, expect } from 'vitest'
import { makeContext, gcdFallback } from './optimizer'
import type { OptimizeInput, Candidate, EvalResult, OptimizeDeps } from './types'
import type { MitigationAction } from '@/types/mitigation'
import type { DamageEvent, CastEvent } from '@/types/timeline'
import type { PlacementEngine } from '@/utils/placement/types'

const gcdAct = (id: number): MitigationAction =>
  ({
    id,
    name: `g${id}`,
    icon: '',
    jobs: ['WHM'],
    duration: 30,
    cooldown: 1,
    category: ['partywide', 'percentage', 'gcd'], // 显式 gcd 标签 → 走兜底
  }) as MitigationAction
const dmg = (id: string, damage: number): DamageEvent =>
  ({ id, name: id, time: 10, damage, type: 'aoe', damageType: 'magical' }) as DamageEvent

// fake：每个覆盖该事件的 cast 把其 finalDamage ×0.9；refHP 固定
function fakeDeps(
  rawDamage: Record<string, number>,
  refHP: number,
  cands: Candidate[]
): OptimizeDeps {
  const evaluator = (casts: CastEvent[]): EvalResult => {
    const perEvent = new Map()
    const lethal = new Set<string>()
    let total = 0
    for (const [id, base] of Object.entries(rawDamage)) {
      const hits = casts.filter(c =>
        cands.find(k => k.start === c.timestamp && k.action.id === c.actionId)?.covers.has(id)
      ).length
      const fd = base * Math.pow(0.9, hits)
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
  actions: new Map([[100, gcdAct(100)]]),
  initialState: { statuses: [], timestamp: 0 } as never,
  baseReferenceMaxHPForAoe: 100000,
})

describe('gcdFallback', () => {
  it('对仍危险(≥满血×95%)的事件，动用 GCD 减伤压下去', () => {
    const cands: Candidate[] = [
      { action: gcdAct(100), playerId: 1, start: 10, covers: new Set(['x']) },
    ]
    // x=98000：未致死(<100000)但危险(≥95000)
    const deps = fakeDeps({ x: 98000 }, 100000, cands)
    const ctx = makeContext(input([dmg('x', 98000)]), deps, cands)
    expect(ctx.evalState.perEvent.get('x')!.finalDamage).toBe(98000) // 仍危险
    gcdFallback(ctx, cands)
    // 98000×0.9=88200 < 95000，不再危险
    expect(ctx.added.length).toBe(1)
    expect(ctx.evalState.perEvent.get('x')!.finalDamage).toBeCloseTo(88200)
  })

  it('没有危险事件时不放 GCD 减伤', () => {
    const cands: Candidate[] = [
      { action: gcdAct(100), playerId: 1, start: 10, covers: new Set(['y']) },
    ]
    const deps = fakeDeps({ y: 80000 }, 100000, cands) // 80000 < 95000，安全
    const ctx = makeContext(input([dmg('y', 80000)]), deps, cands)
    gcdFallback(ctx, cands)
    expect(ctx.added.length).toBe(0)
  })

  it('GCD 把 infeasible(仍致死)事件救回时，从 infeasible 移除', () => {
    const cands: Candidate[] = [
      { action: gcdAct(100), playerId: 1, start: 10, covers: new Set(['z']) },
    ]
    const deps = fakeDeps({ z: 105000 }, 100000, cands) // 致死
    const ctx = makeContext(input([dmg('z', 105000)]), deps, cands)
    ctx.infeasible.set('z', {
      eventId: 'z',
      originalDamage: 105000,
      bestAchievedFinalDamage: 105000,
    })
    gcdFallback(ctx, cands)
    // 105000×0.9=94500 < 100000，不再致死 → 从 infeasible 清除
    expect(ctx.added.length).toBe(1)
    expect(ctx.infeasible.has('z')).toBe(false)
  })
})
