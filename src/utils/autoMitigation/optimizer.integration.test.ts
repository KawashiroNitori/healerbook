import { describe, it, expect } from 'vitest'
import { runOptimize, defaultDeps } from './optimizer'
import { createEvaluator } from './evaluate'
import { generateCandidates } from './candidates'
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

  it('确定性：同 seed + 固定时钟 → 同结果（硬断言）', () => {
    // 决定性时钟：每次 now() 固定步进，使 phase-3 迭代次数与挂钟无关、两次运行完全一致。
    // 真实挂钟预算下 phase-3 迭代次数随负载变化，故"可复现"只在固定时钟下成立（见设计 §8.6）。
    const makeDeterministicDeps = () => {
      const base = defaultDeps()
      let clock = 0
      return { ...base, now: () => (clock += 10) }
    }
    const a = runOptimize(input, makeDeterministicDeps())
    const b = runOptimize(input, makeDeterministicDeps())
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

  it('依赖子技能解锁：放置节制(16536)后，神爱抚(37011)进入候选；不放则无候选', () => {
    const whm = 1
    const buildEngine = (input: OptimizeInput) => {
      const ev = createEvaluator(input)(input.lockedCastEvents)
      return createPlacementEngine({
        castEvents: input.lockedCastEvents,
        actions: input.actions,
        statusTimelineByPlayer: ev.statusTimelineByPlayer,
        resolvedVariantByCastId: ev.resolvedVariantByCastId,
      })
    }
    const base = {
      damageEvents: [dmg('a', 15, 90000), dmg('b', 25, 90000), dmg('c', 35, 90000)],
      composition: { players: [{ id: whm, job: 'WHM' as const }] },
      actions: actionsMap(),
      initialState: { statuses: [], timestamp: 0 } as PartyState,
      baseReferenceMaxHPForAoe: 200000,
    }
    // 放了节制 → 其施加的 3881「神爱抚预备」buff 存在 → 神爱抚 whileStatus(3881) 有合法窗口
    const withParent: OptimizeInput = {
      ...base,
      lockedCastEvents: [{ id: 'lock-temperance', actionId: 16536, timestamp: 10, playerId: whm }],
    }
    expect(
      generateCandidates(withParent, buildEngine(withParent)).some(c => c.action.id === 37011)
    ).toBe(true)
    // 不放节制 → 无 3881 → 神爱抚无候选（这正是修复前整段缺失的原因）
    const noParent: OptimizeInput = { ...base, lockedCastEvents: [] }
    expect(
      generateCandidates(noParent, buildEngine(noParent)).some(c => c.action.id === 37011)
    ).toBe(false)
  })

  it('进度回调 + 规模指标：onProgress 收到阶段进度，summary 含规模', () => {
    const seen: string[] = []
    let lastSim = 0
    const out = runOptimize(input, defaultDeps(), p => {
      seen.push(p.phase)
      expect(p.simulateCalls).toBeGreaterThanOrEqual(lastSim) // 单调非减
      lastSim = p.simulateCalls
      expect(p.inScopeEventCount).toBe(3)
    })
    expect(seen).toContain('feasibility')
    expect(seen).toContain('minimize')
    expect(seen[seen.length - 1]).toBe('done') // 最后一帧是 done
    // 规模指标
    expect(out.summary.inScopeEventCount).toBe(3)
    expect(out.summary.candidateCount).toBeGreaterThan(0)
    expect(out.summary.simulateCalls).toBeGreaterThan(0)
    expect(out.summary.rounds).toBeGreaterThanOrEqual(1)
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
