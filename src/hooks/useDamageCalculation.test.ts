// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import * as registry from '@/utils/statusRegistry'
import { useDamageCalculation, __setWorkerClientForTesting } from './useDamageCalculation'
import { useTimelineStore } from '@/store/timelineStore'
import { CalculatorWorkerClient } from '@/web-workers/calculator/client'
import type {
  SimulateBundle,
  SimulateRequest,
  SimulateResponse,
  StatusTimelineByPlayer,
} from '@/web-workers/calculator/types'
import { simulate } from '@/utils/mitigationCalculator'
import type { MitigationStatusMetadata } from '@/types/status'
import type { Timeline } from '@/types/timeline'
import { MITIGATION_DATA } from '@/data/mitigationActions'
import { createHealExecutor } from '@/executors/createHealExecutor'
import { createRegenExecutor } from '@/executors/createRegenExecutor'
import { regenStatusExecutor } from '@/executors/regenStatusExecutor'

// FakeWorker：用真实 simulate 在主线程同步算，下一个 microtask 回包。
// 这样所有依赖具体计算结果的断言（HP 演化、healSnapshots 反向溯源等）都能保持原有语义；
// 唯一变化是 hook 现在通过 Promise.resolve().then(...) 异步 setState，测试需要 flush microtask。
class FakeWorker implements Partial<Worker> {
  onmessage: ((e: MessageEvent<SimulateResponse>) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  postedMessages: SimulateRequest[] = []
  postMessage(msg: SimulateRequest) {
    this.postedMessages.push(msg)
    Promise.resolve().then(() => {
      try {
        const main = simulate(msg.input)
        const removalTimelinesByExcludeId: Map<string, StatusTimelineByPlayer> = new Map()
        for (const id of msg.extraExcludeIds) {
          const out = simulate({
            ...msg.input,
            castEvents: msg.input.castEvents.filter(ev => ev.id !== id),
            skipHpPipeline: true,
          })
          removalTimelinesByExcludeId.set(id, out.statusTimelineByPlayer)
        }
        const bundle: SimulateBundle = { main, removalTimelinesByExcludeId }
        this.onmessage?.(
          new MessageEvent('message', {
            data: { requestId: msg.requestId, ok: true, bundle },
          })
        )
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        this.onmessage?.(
          new MessageEvent('message', {
            data: { requestId: msg.requestId, ok: false, error: { message } },
          })
        )
      }
    })
  }
  terminate() {}
}

// 等待 worker microtask + React setState 落地
async function flushWorker() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  __setWorkerClientForTesting(
    new CalculatorWorkerClient(() => new FakeWorker() as unknown as Worker)
  )
})

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
  it('状态在事件之间过期时，onExpire 被调用', async () => {
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

      const tl = makeTimeline([{ time: 3 }, { time: 10 }])
      renderHook(() => useDamageCalculation(tl))
      await flushWorker()

      expect(onExpire).toHaveBeenCalledTimes(1)
      expect(onExpire.mock.calls[0][0].status.instanceId).toBe('will-expire')
    } finally {
      spy.mockRestore()
    }
  })

  it('活跃状态在全局 3s 网格的整秒点触发 onTick', async () => {
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
      const tl = makeTimeline([{ time: 10 }])
      renderHook(() => useDamageCalculation(tl))
      await flushWorker()

      const ticksCalled = onTick.mock.calls.map(c => c[0].tickTime)
      expect(ticksCalled).toEqual([3, 6, 9])
    } finally {
      spy.mockRestore()
    }
  })

  it('活跃状态的 performance.maxHP 会把 referenceMaxHP 乘上', async () => {
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

      const tl = makeTimeline([{ time: 5 }])
      const { result } = renderHook(() => useDamageCalculation(tl))
      await flushWorker()
      const e0 = result.current.results.get('e0')
      expect(e0?.referenceMaxHP).toBe(Math.round(100000 * 1.2))
    } finally {
      spy.mockRestore()
    }
  })

  it('非坦克事件不叠加 isTankOnly 的 maxHP', async () => {
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
      await flushWorker()
      const e0 = result.current.results.get('e0')
      expect(e0?.referenceMaxHP).toBe(100000)
    } finally {
      spy.mockRestore()
    }
  })

  it('状态未覆盖的 tick 点不触发 onTick', async () => {
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

      const tl = makeTimeline([{ time: 9 }])
      renderHook(() => useDamageCalculation(tl))
      await flushWorker()

      expect(onTick).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })
})

describe('HP 模拟端到端（partial 段 + cast 治疗 + HoT）', () => {
  it('partial 段 + cast 一次性治疗 + HoT 演化正确，healSnapshots 反向溯源 castEventId', async () => {
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
        statDataEntries: [{ type: 'heal', key: 1e6 + HOT_STATUS_ID }],
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
            [1e6 + HOT_STATUS_ID]: 3000,
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
      await flushWorker()

      // 含常驻自然回复(+1000/tick)；满血段 tick 全溢出。
      // p1 (t=10): hp 100k（cast 在 t=5 满血、+10k overheal；tick 3/6/9 溢出）→ partial 20k → 80k
      expect(result.current.results.get('p1')!.hpSimulation!.hpAfter).toBe(80000)
      // p2 (t=15): (10,15] tick 12/15 +2000 → 82k，segMax 20k→25k 增量 5k → 77k
      expect(result.current.results.get('p2')!.hpSimulation!.hpAfter).toBe(77000)
      // tick 18 +1000 → 78k；HoT cast t=18 起，(18,25] tick 21/24 各 HoT +3k 与常驻 +1k
      // → 78k+3k+1k+3k+1k=86k；p3 (t=25): segMax 25k→30k 增量 5k → 81k
      expect(result.current.results.get('p3')!.hpSimulation!.hpAfter).toBe(81000)

      // 过滤掉常驻自然回复(actionId 1302)：剩 1 次 cast 一次性 + 2 次 HoT tick = 3
      const snaps = result.current.healSnapshots.filter(s => s.actionId !== 1302)
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

describe('useDamageCalculation: castEffectiveEnd 在 stale 帧对齐当前 timestamp（防绿条闪烁）', () => {
  // 拖动结束的时序：updateCastEvent 同步 mutate timeline.castEvents → React re-render 用
  // 新 timestamp，但 worker 异步返回。stale 帧若直接拿旧 effectiveEnd 与新 timestamp 做减法，
  // CastEventIcon 会算出 effectiveDuration = max(0, oldEnd - newTs) 突变（甚至 = 0 让绿条
  // 消失），下一帧 worker 回来又恢复——肉眼"闪一下"。hook 内部用 snapshot duration + 当前
  // timestamp 重组 effectiveEnd 来稳定 stale 帧。
  it('cast timestamp 同步变化、worker 未返回的 stale 帧用 snapshot duration 重组 effectiveEnd', async () => {
    const HOT_ACTION_ID = 999810
    const HOT_STATUS_ID = 999811

    const original = [...MITIGATION_DATA.actions]
    MITIGATION_DATA.actions.push({
      id: HOT_ACTION_ID,
      name: 'mock-regen',
      icon: '',
      jobs: ['WHM'],
      duration: 30,
      cooldown: 0,
      category: ['heal', 'partywide'],
      executor: createRegenExecutor(HOT_STATUS_ID, 30),
      statDataEntries: [{ type: 'heal', key: 1e6 + HOT_STATUS_ID }],
    })

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
      useTimelineStore.setState({
        partyState: { statuses: [], timestamp: 0 },
        statistics: null,
      })

      const baseStatData = {
        referenceMaxHP: 100000,
        tankReferenceMaxHP: 100000,
        shieldByAbility: {},
        critShieldByAbility: {},
        healByAbility: { [1e6 + HOT_STATUS_ID]: 3000 },
        critHealByAbility: {},
      }

      const tl0: Timeline = {
        id: 't',
        name: 't',
        encounter: { id: 0, name: '', displayName: '', zone: '', damageEvents: [] },
        composition: { players: [{ id: 1, job: 'WHM' }] },
        damageEvents: [
          { id: 'd1', name: '', time: 100, damage: 1000, type: 'aoe', damageType: 'magical' },
        ],
        castEvents: [{ id: 'cast-1', actionId: HOT_ACTION_ID, timestamp: 0, playerId: 1 }],
        statusEvents: [],
        annotations: [],
        statData: baseStatData,
        createdAt: 0,
        updatedAt: 0,
      }

      const { result, rerender } = renderHook(({ tl }) => useDamageCalculation(tl), {
        initialProps: { tl: tl0 },
      })
      await flushWorker()
      expect(result.current.castEffectiveEndByCastEventId.get('cast-1')).toBe(30)

      // 拖动结束模拟：timestamp 0 → 20，timeline 新引用、castEvents 新数组（与 zustand mutation 等价）
      const tl1: Timeline = {
        ...tl0,
        castEvents: [{ id: 'cast-1', actionId: HOT_ACTION_ID, timestamp: 20, playerId: 1 }],
      }

      // 不 flushWorker：模拟 stale-while-revalidate 那一帧（worker postMessage 已发出但未回包）
      rerender({ tl: tl1 })

      // 关键：旧实现这里会返回 stale 的 30（worker 还没回新值），CastEventIcon 算
      // effectiveDuration = max(0, 30 − 20) = 10 → 绿条从 30s 长突变到 10s 长 → 闪烁。
      // 修复后：用 snapshot duration (30) + 当前 ts (20) = 50，绿条稳定保持 30s 长。
      expect(result.current.castEffectiveEndByCastEventId.get('cast-1')).toBe(50)

      await flushWorker()
      // worker 返回新结果：仍是 50（buff 未被 consume），但路径已是 worker 真实输出
      expect(result.current.castEffectiveEndByCastEventId.get('cast-1')).toBe(50)
    } finally {
      spy.mockRestore()
      MITIGATION_DATA.actions.length = 0
      MITIGATION_DATA.actions.push(...original)
    }
  })
})
