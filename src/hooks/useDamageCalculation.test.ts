// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import * as registry from '@/utils/statusRegistry'
import { useDamageCalculation } from './useDamageCalculation'
import { useTimelineStore } from '@/store/timelineStore'
import type { MitigationStatusMetadata } from '@/types/status'
import type { Timeline } from '@/types/timeline'
import { MITIGATION_DATA } from '@/data/mitigationActions'
import { createHealExecutor } from '@/executors/createHealExecutor'
import { createRegenExecutor, regenStatusExecutor } from '@/executors/createRegenExecutor'

function fakeMeta(
  id: number,
  overrides: Partial<MitigationStatusMetadata>
): MitigationStatusMetadata {
  return {
    id,
    name: `fake-${id}`,
    type: 'multiplier',
    performance: { physics: 1, magic: 1, darkness: 1, heal: 1, maxHP: 1 },
    isFriendly: true,
    isTankOnly: false,
    ...overrides,
  } as MitigationStatusMetadata
}

function makeTimeline(events: Array<{ time: number }>): Timeline {
  return {
    id: 't',
    name: 't',
    encounter: { id: 0, name: '', displayName: '', zone: '', damageEvents: [] },
    composition: { players: [{ id: 1, job: 'DRK' }] },
    damageEvents: events.map((e, i) => ({
      id: `e${i}`,
      name: '',
      time: e.time,
      damage: 1000,
      type: 'tankbuster',
      damageType: 'physical',
    })),
    castEvents: [],
    statusEvents: [],
    annotations: [],
    createdAt: 0,
    updatedAt: 0,
  }
}

describe('useDamageCalculation: onExpire / onTick 钩子', () => {
  it('状态在事件之间过期时，onExpire 被调用', () => {
    const FAKE_ID = 999800
    const onExpire = vi.fn().mockImplementation(ctx => ctx.partyState)

    const spy = vi.spyOn(registry, 'getStatusById').mockImplementation(id => {
      if (id === FAKE_ID) return fakeMeta(id, { executor: { onExpire } })
      return undefined
    })

    try {
      useTimelineStore.setState({
        partyState: {
          statuses: [
            {
              instanceId: 'will-expire',
              statusId: FAKE_ID,
              startTime: 0,
              endTime: 5,
              sourcePlayerId: 1,
            },
          ],
          timestamp: 0,
        },
        statistics: null,
      })

      renderHook(() => useDamageCalculation(makeTimeline([{ time: 3 }, { time: 10 }])))

      expect(onExpire).toHaveBeenCalledTimes(1)
      expect(onExpire.mock.calls[0][0].status.instanceId).toBe('will-expire')
    } finally {
      spy.mockRestore()
    }
  })

  it('活跃状态在全局 3s 网格的整秒点触发 onTick', () => {
    const FAKE_ID = 999801
    const onTick = vi.fn().mockImplementation(ctx => ctx.partyState)

    const spy = vi.spyOn(registry, 'getStatusById').mockImplementation(id => {
      if (id === FAKE_ID) return fakeMeta(id, { executor: { onTick } })
      return undefined
    })

    try {
      useTimelineStore.setState({
        partyState: {
          statuses: [
            {
              instanceId: 'ticker',
              statusId: FAKE_ID,
              startTime: 0,
              endTime: 12,
              sourcePlayerId: 1,
            },
          ],
          timestamp: 0,
        },
        statistics: null,
      })

      // 事件在 t=10；推进时间经过 tick 点 t=3,6,9
      renderHook(() => useDamageCalculation(makeTimeline([{ time: 10 }])))

      const ticksCalled = onTick.mock.calls.map(c => c[0].tickTime)
      expect(ticksCalled).toEqual([3, 6, 9])
    } finally {
      spy.mockRestore()
    }
  })

  it('活跃状态的 performance.maxHP 会把 referenceMaxHP 乘上', () => {
    const FAKE_ID = 999803
    const spy = vi.spyOn(registry, 'getStatusById').mockImplementation(id => {
      if (id === FAKE_ID) {
        return fakeMeta(id, {
          isTankOnly: true,
          performance: { physics: 1, magic: 1, darkness: 1, heal: 1, maxHP: 1.2 },
        })
      }
      return undefined
    })

    try {
      useTimelineStore.setState({
        partyState: {
          statuses: [
            {
              instanceId: 'tank-boost',
              statusId: FAKE_ID,
              startTime: 0,
              endTime: 30,
              sourcePlayerId: 1,
            },
          ],
          timestamp: 0,
        },
        statistics: null,
        timeline: null,
      })

      const { result } = renderHook(() => useDamageCalculation(makeTimeline([{ time: 5 }])))
      const e0 = result.current.results.get('e0')
      expect(e0?.referenceMaxHP).toBe(Math.round(100000 * 1.2))
    } finally {
      spy.mockRestore()
    }
  })

  it('非坦克事件不叠加 isTankOnly 的 maxHP', () => {
    const FAKE_ID = 999804
    const spy = vi.spyOn(registry, 'getStatusById').mockImplementation(id => {
      if (id === FAKE_ID) {
        return fakeMeta(id, {
          isTankOnly: true,
          performance: { physics: 1, magic: 1, darkness: 1, heal: 1, maxHP: 1.2 },
        })
      }
      return undefined
    })

    try {
      useTimelineStore.setState({
        partyState: {
          statuses: [
            {
              instanceId: 'tank-boost',
              statusId: FAKE_ID,
              startTime: 0,
              endTime: 30,
              sourcePlayerId: 1,
            },
          ],
          timestamp: 0,
        },
        statistics: null,
        timeline: null,
      })

      const tl = makeTimeline([{ time: 5 }])
      tl.damageEvents[0].type = 'aoe'
      const { result } = renderHook(() => useDamageCalculation(tl))
      const e0 = result.current.results.get('e0')
      expect(e0?.referenceMaxHP).toBe(100000)
    } finally {
      spy.mockRestore()
    }
  })

  it('状态未覆盖的 tick 点不触发 onTick', () => {
    const FAKE_ID = 999802
    const onTick = vi.fn()

    const spy = vi.spyOn(registry, 'getStatusById').mockImplementation(id => {
      if (id === FAKE_ID) return fakeMeta(id, { executor: { onTick } })
      return undefined
    })

    try {
      useTimelineStore.setState({
        partyState: {
          statuses: [
            {
              instanceId: 'short',
              statusId: FAKE_ID,
              startTime: 4,
              endTime: 5, // 覆盖不到任何 3s 网格点
              sourcePlayerId: 1,
            },
          ],
          timestamp: 0,
        },
        statistics: null,
      })

      renderHook(() => useDamageCalculation(makeTimeline([{ time: 9 }])))

      expect(onTick).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })
})

describe('HP 模拟端到端（partial 段 + cast 治疗 + HoT）', () => {
  it('partial 段 + cast 一次性治疗 + HoT 演化正确，healSnapshots 反向溯源 castEventId', () => {
    const HEAL_ACTION_ID = 999801
    const HOT_ACTION_ID = 999802
    const HOT_STATUS_ID = 999803

    // 注入临时 mitigation actions（仅用于本用例）
    // statDataEntries 必须声明，否则 resolveStatData 不会将 statData.healByAbility 中的值传递给 simulator
    const original = [...MITIGATION_DATA.actions]
    MITIGATION_DATA.actions.push(
      {
        id: HEAL_ACTION_ID,
        name: 'mock-heal',
        icon: '',
        jobs: ['WHM'],
        duration: 0,
        cooldown: 0,
        category: ['heal', 'partywide'],
        executor: createHealExecutor(),
        statDataEntries: [{ type: 'heal', key: HEAL_ACTION_ID }],
      },
      {
        id: HOT_ACTION_ID,
        name: 'mock-regen',
        icon: '',
        jobs: ['WHM'],
        duration: 30,
        cooldown: 0,
        category: ['heal', 'partywide'],
        executor: createRegenExecutor(HOT_STATUS_ID, 30),
        statDataEntries: [{ type: 'heal', key: HOT_STATUS_ID }],
      }
    )

    const spy = vi.spyOn(registry, 'getStatusById').mockImplementation(id => {
      if (id === HOT_STATUS_ID) {
        return fakeMeta(id, {
          executor: regenStatusExecutor,
          performance: { physics: 1, magic: 1, darkness: 1, heal: 1, maxHP: 1 },
        })
      }
      return undefined
    })

    try {
      const timeline: Timeline = {
        id: 't',
        name: 't',
        encounter: { id: 0, name: '', displayName: '', zone: '', damageEvents: [] },
        composition: { players: [{ id: 1, job: 'WHM' }] },
        damageEvents: [
          {
            id: 'p1',
            name: '',
            time: 10,
            damage: 20000,
            type: 'partial_aoe',
            damageType: 'magical',
          },
          {
            id: 'p2',
            name: '',
            time: 15,
            damage: 25000,
            type: 'partial_aoe',
            damageType: 'magical',
          },
          {
            id: 'p3',
            name: '',
            time: 25,
            damage: 30000,
            type: 'partial_final_aoe',
            damageType: 'magical',
          },
        ],
        castEvents: [
          { id: 'cast-heal', actionId: HEAL_ACTION_ID, timestamp: 5, playerId: 1 },
          { id: 'cast-hot', actionId: HOT_ACTION_ID, timestamp: 18, playerId: 1 },
        ],
        statusEvents: [],
        annotations: [],
        statData: {
          referenceMaxHP: 100000,
          tankReferenceMaxHP: 100000,
          shieldByAbility: {},
          critShieldByAbility: {},
          healByAbility: {
            [HEAL_ACTION_ID]: 10000,
            [HOT_STATUS_ID]: 30000,
          },
          critHealByAbility: {},
        },
        createdAt: 0,
        updatedAt: 0,
      }

      useTimelineStore.setState({
        partyState: { statuses: [], timestamp: 0 },
        statistics: null,
      })

      const { result } = renderHook(() => useDamageCalculation(timeline))

      // p1 (t=10): hp 100k（cast 在 t=5 时刻 hp 满血、+10k overheal）→ partial 20k → 80k
      expect(result.current.results.get('p1')!.hpSimulation!.hpAfter).toBe(80000)
      // p2 (t=15): segMax 20k → 25k，增量 5k → 75k
      expect(result.current.results.get('p2')!.hpSimulation!.hpAfter).toBe(75000)
      // HoT cast 在 t=18，tick 在 t=21、t=24 触发（每次 +3k）→ p3 前 hp = 75 + 6 = 81k
      // p3 (t=25): segMax 25k → 30k，增量 5k → 76k
      expect(result.current.results.get('p3')!.hpSimulation!.hpAfter).toBe(76000)

      // healSnapshots：1 次 cast 一次性 + 2 次 HoT tick = 3
      const snaps = result.current.healSnapshots
      expect(snaps).toHaveLength(3)
      expect(snaps[0]).toMatchObject({
        castEventId: 'cast-heal',
        isHotTick: false,
        applied: 0,
        overheal: 10000,
      })
      expect(snaps[1]).toMatchObject({ castEventId: 'cast-hot', isHotTick: true, time: 21 })
      expect(snaps[2]).toMatchObject({ castEventId: 'cast-hot', isHotTick: true, time: 24 })
    } finally {
      spy.mockRestore()
      MITIGATION_DATA.actions.length = 0
      MITIGATION_DATA.actions.push(...original)
    }
  })
})
