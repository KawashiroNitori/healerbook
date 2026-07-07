import { describe, it, expect } from 'vitest'
import { makeContext, phase2Minimize } from './optimizer'
import type { OptimizeInput, Candidate, EvalResult, OptimizeDeps } from './types'
import type { MitigationAction } from '@/types/mitigation'
import type { DamageEvent, CastEvent } from '@/types/timeline'
import type { PlacementEngine } from '@/types/placement'

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

// fake：每个覆盖把对应事件 finalDamage 砍 30%；无致死约束
function fakeDeps(rawDamage: Record<string, number>, cands: Candidate[]): OptimizeDeps {
  const evaluator = (casts: CastEvent[]): EvalResult => {
    const perEvent = new Map()
    let total = 0
    for (const [id, base] of Object.entries(rawDamage)) {
      const hits = casts.filter(c =>
        cands.find(k => k.start === c.timestamp && k.action.id === c.actionId)?.covers.has(id)
      ).length
      const fd = base * Math.pow(0.7, hits)
      perEvent.set(id, { time: 10, inScope: true, finalDamage: fd, referenceMaxHP: undefined })
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
    now: () => 0,
    makeRandom: () => () => 0,
  }
}

const input = (events: DamageEvent[]): OptimizeInput => ({
  damageEvents: events,
  lockedCastEvents: [],
  composition: { players: [{ id: 1, job: 'WHM' }] },
  actions: new Map([[100, act(100)]]),
  initialState: { statuses: [], timestamp: 0 } as never,
})

describe('phase2Minimize', () => {
  it('优先把减伤盖在更高伤害的事件上', () => {
    // 两个互斥候选（同 action 占同一池，fake 不限制，故都能放，但优先级体现在先选高收益）
    const cands: Candidate[] = [
      { action: act(100), playerId: 1, start: 10, covers: new Set(['big']) },
      { action: act(100), playerId: 1, start: 50, covers: new Set(['small']) },
    ]
    const deps = fakeDeps({ big: 100000, small: 20000 }, cands)
    const ctx = makeContext(input([dmg('big', 100000), dmg('small', 20000)]), deps, cands)
    phase2Minimize(ctx)
    // 第一个被接受的应是覆盖 big 的候选（边际收益更大）
    const first = ctx.added[0]
    expect(first.timestamp).toBe(10)
    expect(ctx.evalState.total).toBeLessThan(120000)
  })
  it('无正收益时停止（不无意义加 cast）', () => {
    const cands: Candidate[] = []
    const deps = fakeDeps({ a: 10000 }, cands)
    const ctx = makeContext(input([dmg('a', 10000)]), deps, cands)
    phase2Minimize(ctx)
    expect(ctx.added.length).toBe(0)
  })
})
