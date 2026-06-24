import { describe, it, expect } from 'vitest'
import { runOptimize, defaultDeps } from './optimizer'
import { createEvaluator } from './evaluate'
import { MITIGATION_DATA } from '@/data/mitigationActions'
import { createPlacementEngine } from '@/utils/placement/engine'
import type { OptimizeInput } from './types'
import type { DamageEvent } from '@/types/timeline'
import type { PartyState } from '@/types/partyState'

function actionsMap() {
  return new Map(MITIGATION_DATA.actions.map(a => [a.id, a]))
}

const dmg = (id: string, time: number, damage: number): DamageEvent =>
  ({ id, name: id, time, damage, type: 'aoe', damageType: 'magical' }) as DamageEvent

describe('runOptimize（集成）', () => {
  const input: OptimizeInput = {
    damageEvents: [dmg('m1', 30, 90000), dmg('m2', 90, 95000), dmg('m3', 150, 88000)],
    lockedCastEvents: [],
    composition: {
      players: [
        { id: 1, job: 'WAR' },
        { id: 2, job: 'WHM' },
        { id: 3, job: 'SCH' },
        { id: 4, job: 'SAM' },
      ],
    },
    actions: actionsMap(),
    initialState: { statuses: [], timestamp: 0 } as PartyState,
    baseReferenceMaxHPForAoe: 100000,
    options: { timeBudgetMs: 800, seed: 1 },
  }

  it('产出合法且减伤行为符合预期', () => {
    const out = runOptimize(input)
    // 用真实 PlacementEngine 校验产出全合法（硬断言）
    const ev = createEvaluator(input)(input.lockedCastEvents.concat(out.addedCastEvents))
    const engine = createPlacementEngine({
      castEvents: [...input.lockedCastEvents, ...out.addedCastEvents],
      actions: input.actions,
      statusTimelineByPlayer: ev.statusTimelineByPlayer,
      resolvedVariantByCastId: ev.resolvedVariantByCastId,
    })
    expect(engine.findInvalidCastEvents()).toEqual([])

    // 覆盖语义修正后，有效候选被正确识别，总伤严格降低（硬断言）
    expect(out.summary.totalDamageAfter).toBeLessThan(out.summary.totalDamageBefore)
    expect(out.summary.castsAdded).toBeGreaterThan(0)
  })

  it('确定性：同 seed 同结果（硬断言）', () => {
    const a = runOptimize(input)
    const b = runOptimize(input)
    expect(a.addedCastEvents.map(c => `${c.actionId}@${c.timestamp}#${c.playerId}`)).toEqual(
      b.addedCastEvents.map(c => `${c.actionId}@${c.timestamp}#${c.playerId}`)
    )
  })

  it('addedCastEvents 结构合法：actionId 存在于 actions map、id 唯一（硬断言）', () => {
    const out = runOptimize(input)
    const ids = out.addedCastEvents.map(c => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const c of out.addedCastEvents) {
      expect(input.actions.has(c.actionId)).toBe(true)
    }
  })

  it('defaultDeps 返回完整依赖对象', () => {
    const deps = defaultDeps()
    expect(typeof deps.createEvaluator).toBe('function')
    expect(typeof deps.buildPlacementEngine).toBe('function')
    expect(typeof deps.generateId).toBe('function')
    expect(typeof deps.now).toBe('function')
    expect(typeof deps.makeRandom).toBe('function')
    expect(typeof deps.now()).toBe('number')
    expect(typeof deps.generateId()).toBe('string')
  })
})
