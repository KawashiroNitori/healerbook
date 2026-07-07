/**
 * hpPipeline 独立单测。
 *
 * 覆盖从 simulate 抽出的 HP 池演算管道：
 *   - applyDamage 的盾扣减 / overkill / partial 段行为
 *   - recomputeAndTrack 的 max 变化记录（含影子状态回填）
 *   - recordTimelinePoint / recordHeal / finish 的收尾与 skipHpPipeline 短路
 *
 * mitigationCalculator.test.ts 的 2900+ 行黑盒锚继续兜底 simulate 整体行为，
 * 本文件只保护 hpPipeline 局部契约。
 */

import { describe, it, expect, vi } from 'vitest'
import * as registry from '@/utils/statusRegistry'
import type { PartyState } from '@/types/partyState'
import type { DamageEvent } from '@/types/timeline'
import { createHpPipeline } from './hpPipeline'

const mkDmg = (
  id: string,
  time: number,
  type: DamageEvent['type'],
  damage: number
): DamageEvent => ({
  id,
  name: id,
  time,
  type,
  damage,
})

const mkState = (hp?: { current: number; max: number; base: number }): PartyState => ({
  statuses: [],
  timestamp: 0,
  hp,
  segment: { inSegment: false, segMax: 0, segCandidateMax: 0, segOriginalMax: 0 },
})

describe('hpPipeline.applyDamage', () => {
  it('aoe 全额扣 HP，返回 snapshot', () => {
    const hp = createHpPipeline({ skipHpPipeline: false, initialState: mkState() })
    const state = mkState({ current: 100000, max: 100000, base: 100000 })
    const { nextState, snapshot } = hp.applyDamage(state, mkDmg('A', 10, 'aoe', 0), 30000, 30000)

    expect(nextState.hp?.current).toBe(70000)
    expect(snapshot).toEqual({
      hpBefore: 100000,
      hpAfter: 70000,
      hpMax: 100000,
      segMax: undefined,
      segOriginalMax: undefined,
      preShieldDealt: undefined,
      overkill: undefined,
    })
  })

  it('overkill：扣血量超过当前 HP 时 hpAfter clamp 到 0，snapshot.overkill 记录溢出', () => {
    const hp = createHpPipeline({ skipHpPipeline: false, initialState: mkState() })
    const state = mkState({ current: 20000, max: 100000, base: 100000 })
    const { nextState, snapshot } = hp.applyDamage(state, mkDmg('A', 10, 'aoe', 0), 30000, 30000)

    expect(nextState.hp?.current).toBe(0)
    expect(snapshot?.overkill).toBe(10000)
  })

  it('tankbuster / auto 不入池，snapshot 为 undefined', () => {
    const hp = createHpPipeline({ skipHpPipeline: false, initialState: mkState() })
    const state = mkState({ current: 100000, max: 100000, base: 100000 })
    const tb = hp.applyDamage(state, mkDmg('A', 10, 'tankbuster', 0), 30000, 30000)
    expect(tb.snapshot).toBeUndefined()
    expect(tb.nextState.hp?.current).toBe(100000)

    const auto = hp.applyDamage(state, mkDmg('B', 10, 'auto', 0), 30000, 30000)
    expect(auto.snapshot).toBeUndefined()
    expect(auto.nextState.hp?.current).toBe(100000)
  })

  it('partial_aoe：段内按增量扣血（max(finalDamage) - segMaxBefore）', () => {
    const hp = createHpPipeline({ skipHpPipeline: false, initialState: mkState() })
    let state = mkState({ current: 100000, max: 100000, base: 100000 })

    // 首个 partial：段内 segMaxBefore=0，扣全额 30000
    const first = hp.applyDamage(state, mkDmg('P1', 5, 'partial_aoe', 30000), 30000, 30000)
    expect(first.nextState.hp?.current).toBe(70000)
    expect(first.snapshot?.segMax).toBe(30000)
    state = first.nextState

    // 第二个 partial 更大：50000，只扣增量 20000
    const second = hp.applyDamage(state, mkDmg('P2', 6, 'partial_aoe', 50000), 50000, 50000)
    expect(second.nextState.hp?.current).toBe(50000)
    expect(second.snapshot?.segMax).toBe(50000)
    state = second.nextState

    // 第三个 partial 更小：40000，增量为 0，不扣血
    const third = hp.applyDamage(state, mkDmg('P3', 7, 'partial_aoe', 40000), 40000, 40000)
    expect(third.nextState.hp?.current).toBe(50000)
    expect(third.snapshot?.segMax).toBe(50000)
  })

  it('partial_final_aoe：结算后段清零（inSegment=false）', () => {
    const hp = createHpPipeline({ skipHpPipeline: false, initialState: mkState() })
    let state = mkState({ current: 100000, max: 100000, base: 100000 })

    const first = hp.applyDamage(state, mkDmg('P1', 5, 'partial_aoe', 30000), 30000, 30000)
    state = first.nextState
    expect(state.segment?.inSegment).toBe(true)

    const final = hp.applyDamage(state, mkDmg('P2', 6, 'partial_final_aoe', 50000), 50000, 50000)
    expect(final.nextState.segment?.inSegment).toBe(false)
    // 段增量 = max(50000, 30000) - 30000 = 20000 → 70000 - 20000 = 50000
    expect(final.nextState.hp?.current).toBe(50000)
  })

  it('无 hp 池时（skipHpPipeline 场景）仍维护 segment，snapshot 为 undefined', () => {
    const hp = createHpPipeline({ skipHpPipeline: true, initialState: mkState() })
    const state = mkState() // hp undefined
    const { nextState, snapshot } = hp.applyDamage(
      state,
      mkDmg('P1', 5, 'partial_aoe', 30000),
      30000,
      30000
    )
    expect(snapshot).toBeUndefined()
    expect(nextState.segment?.inSegment).toBe(true)
  })
})

describe('hpPipeline.recomputeAndTrack', () => {
  it('hp.max 无变化时不 push 点', () => {
    const hp = createHpPipeline({ skipHpPipeline: false, initialState: mkState() })
    const state = mkState({ current: 100000, max: 100000, base: 100000 })
    hp.recordTimelinePoint({ time: 0, hp: 100000, hpMax: 100000, kind: 'init' })

    const next = hp.recomputeAndTrack(state, 5)
    expect(next.hp?.max).toBe(100000)
    const { hpTimeline } = hp.finish()
    // 只有 init 那一条
    expect(hpTimeline.filter(p => p.kind === 'maxhp-change')).toEqual([])
  })

  it('maxHP buff active 时 hp.max 变化 → push maxhp-change 点并回填影子状态', () => {
    const MAXHP_BUFF_ID = 990001
    const spy = vi.spyOn(registry, 'getStatusById').mockImplementation(
      id =>
        (id === MAXHP_BUFF_ID
          ? ({
              id: MAXHP_BUFF_ID,
              name: 'mock-maxhp',
              type: 'multiplier',
              performance: { physics: 1, magic: 1, darkness: 1, maxHP: 1.2 },
              isFriendly: true,
              isTankOnly: false,
            } as unknown)
          : undefined) as ReturnType<typeof registry.getStatusById>
    )
    try {
      const hp = createHpPipeline({ skipHpPipeline: false, initialState: mkState() })
      const state: PartyState = {
        statuses: [
          {
            instanceId: 'maxhp',
            statusId: MAXHP_BUFF_ID,
            startTime: 0,
            endTime: 60,
            sourcePlayerId: 1,
          },
        ],
        timestamp: 0,
        hp: { current: 100000, max: 100000, base: 100000 },
        segment: { inSegment: false, segMax: 0, segCandidateMax: 0, segOriginalMax: 0 },
      }
      const next = hp.recomputeAndTrack(state, 3)
      expect(next.hp?.max).toBe(120000)
      const { hpTimeline } = hp.finish()
      const changes = hpTimeline.filter(p => p.kind === 'maxhp-change')
      expect(changes).toHaveLength(1)
      expect(changes[0]).toMatchObject({ time: 3, hpMax: 120000 })
    } finally {
      spy.mockRestore()
    }
  })
})

describe('hpPipeline.recordHeal / recordTimelinePoint / finish', () => {
  it('recordHeal 回填 hpAfter 并 push heal 点（读上一已知 hp）', () => {
    const hp = createHpPipeline({ skipHpPipeline: false, initialState: mkState() })
    // 先 seed 影子状态：当前 hp 50000 / max 100000
    hp.recordTimelinePoint({ time: 0, hp: 50000, hpMax: 100000, kind: 'init' })
    hp.recordHeal?.({
      castEventId: 'cast-1',
      actionId: 1,
      sourcePlayerId: 1,
      time: 5,
      baseAmount: 20000,
      finalHeal: 20000,
      applied: 20000,
      overheal: 0,
      isHotTick: false,
    })
    const { hpTimeline, healSnapshots } = hp.finish()
    expect(healSnapshots).toHaveLength(1)
    const healPoint = hpTimeline.find(p => p.kind === 'heal')
    expect(healPoint).toMatchObject({ time: 5, hp: 70000, refEventId: 'cast-1' })
  })

  it('recordHeal 溢出 clamp 到 hpMax', () => {
    const hp = createHpPipeline({ skipHpPipeline: false, initialState: mkState() })
    hp.recordTimelinePoint({ time: 0, hp: 90000, hpMax: 100000, kind: 'init' })
    hp.recordHeal?.({
      castEventId: '',
      actionId: 1302,
      sourcePlayerId: 0,
      time: 3,
      baseAmount: 20000,
      finalHeal: 20000,
      applied: 20000,
      overheal: 0,
      isHotTick: true,
    })
    const { hpTimeline } = hp.finish()
    const tick = hpTimeline.find(p => p.kind === 'tick')
    expect(tick?.hp).toBe(100000)
  })

  it('finish 按 time 升序 sort hpTimeline 与 healSnapshots', () => {
    const hp = createHpPipeline({ skipHpPipeline: false, initialState: mkState() })
    hp.recordTimelinePoint({ time: 10, hp: 100000, hpMax: 100000, kind: 'init' })
    hp.recordTimelinePoint({ time: 3, hp: 100000, hpMax: 100000, kind: 'maxhp-change' })
    hp.recordTimelinePoint({ time: 7, hp: 100000, hpMax: 100000, kind: 'damage' })
    const { hpTimeline } = hp.finish()
    const times = hpTimeline.map(p => p.time)
    for (let i = 1; i < times.length; i++) {
      expect(times[i]).toBeGreaterThanOrEqual(times[i - 1])
    }
  })

  it('skipHpPipeline=true：recordHeal 为 undefined，finish 返回空数组', () => {
    const hp = createHpPipeline({ skipHpPipeline: true, initialState: mkState() })
    expect(hp.recordHeal).toBeUndefined()
    // recordTimelinePoint 在 skip 下短路，不 push
    hp.recordTimelinePoint({ time: 0, hp: 100000, hpMax: 100000, kind: 'init' })
    const { hpTimeline, healSnapshots } = hp.finish()
    expect(hpTimeline).toEqual([])
    expect(healSnapshots).toEqual([])
  })
})
