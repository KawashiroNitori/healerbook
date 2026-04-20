// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import * as registry from '@/utils/statusRegistry'
import { useDamageCalculation } from './useDamageCalculation'
import { useTimelineStore } from '@/store/timelineStore'
import type { MitigationStatusMetadata } from '@/types/status'
import type { Timeline } from '@/types/timeline'

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
