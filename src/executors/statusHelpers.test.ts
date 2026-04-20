import { describe, it, expect } from 'vitest'
import {
  addStatus,
  removeStatus,
  removeStatusesByStatusId,
  updateStatus,
  updateStatusData,
} from './statusHelpers'
import type { PartyState } from '@/types/partyState'

function basePartyState(): PartyState {
  return {
    statuses: [],
    timestamp: 0,
  }
}

describe('statusHelpers', () => {
  describe('addStatus', () => {
    it('按模板添加状态，自动生成 instanceId + startTime/endTime', () => {
      const state = addStatus(basePartyState(), {
        statusId: 810,
        duration: 10,
        sourcePlayerId: 1,
        eventTime: 30,
      })

      expect(state.statuses).toHaveLength(1)
      const added = state.statuses[0]
      expect(added.statusId).toBe(810)
      expect(added.startTime).toBe(30)
      expect(added.endTime).toBe(40)
      expect(added.sourcePlayerId).toBe(1)
      expect(added.instanceId).toBeTruthy()
    })

    it('initialBarrier 缺省等于 remainingBarrier', () => {
      const state = addStatus(basePartyState(), {
        statusId: 297,
        duration: 30,
        remainingBarrier: 5000,
        eventTime: 0,
      })

      expect(state.statuses[0].remainingBarrier).toBe(5000)
      expect(state.statuses[0].initialBarrier).toBe(5000)
    })

    it('返回新数组，不修改原 state', () => {
      const original = basePartyState()
      const state = addStatus(original, {
        statusId: 810,
        duration: 10,
        eventTime: 0,
      })
      expect(state).not.toBe(original)
      expect(state.statuses).not.toBe(original.statuses)
      expect(original.statuses).toHaveLength(0)
    })

    it('performance 与 data 直接透传到实例字段上', () => {
      const state = addStatus(basePartyState(), {
        statusId: 1234,
        duration: 10,
        eventTime: 5,
        performance: { physics: 0.8, magic: 0.8, darkness: 0.8, heal: 1, maxHP: 1 },
        data: { boosted: true },
      })
      expect(state.statuses[0].performance).toEqual({
        physics: 0.8,
        magic: 0.8,
        darkness: 0.8,
        heal: 1,
        maxHP: 1,
      })
      expect(state.statuses[0].data).toEqual({ boosted: true })
    })
  })

  describe('removeStatus', () => {
    it('按 instanceId 移除指定状态', () => {
      const withStatuses: PartyState = {
        ...basePartyState(),
        statuses: [
          { instanceId: 'a', statusId: 1, startTime: 0, endTime: 10 },
          { instanceId: 'b', statusId: 2, startTime: 0, endTime: 10 },
        ],
      }
      const state = removeStatus(withStatuses, 'a')
      expect(state.statuses).toHaveLength(1)
      expect(state.statuses[0].instanceId).toBe('b')
    })
  })

  describe('removeStatusesByStatusId', () => {
    it('按 statusId 移除所有匹配状态', () => {
      const withStatuses: PartyState = {
        ...basePartyState(),
        statuses: [
          { instanceId: 'a', statusId: 810, startTime: 0, endTime: 10 },
          { instanceId: 'b', statusId: 810, startTime: 5, endTime: 15 },
          { instanceId: 'c', statusId: 811, startTime: 0, endTime: 10 },
        ],
      }
      const state = removeStatusesByStatusId(withStatuses, 810)
      expect(state.statuses).toHaveLength(1)
      expect(state.statuses[0].statusId).toBe(811)
    })
  })

  describe('updateStatus', () => {
    it('按 instanceId 合并更新字段', () => {
      const withStatuses: PartyState = {
        ...basePartyState(),
        statuses: [
          {
            instanceId: 'a',
            statusId: 810,
            startTime: 0,
            endTime: 10,
          },
        ],
      }
      const state = updateStatus(withStatuses, 'a', {
        remainingBarrier: 5000,
        endTime: 5,
      })
      expect(state.statuses[0].remainingBarrier).toBe(5000)
      expect(state.statuses[0].endTime).toBe(5)
      expect(state.statuses[0].statusId).toBe(810) // 未提供的字段保持
    })

    it('instanceId 不匹配时返回新 state 但数据等价', () => {
      const original: PartyState = {
        ...basePartyState(),
        statuses: [{ instanceId: 'a', statusId: 1, startTime: 0, endTime: 10 }],
      }
      const state = updateStatus(original, 'nonexistent', { remainingBarrier: 99 })
      expect(state).not.toBe(original)
      expect(state.statuses[0]).toEqual(original.statuses[0])
    })
  })

  describe('updateStatusData', () => {
    it('把 patch 浅合并到 data 上', () => {
      const withStatuses: PartyState = {
        ...basePartyState(),
        statuses: [
          {
            instanceId: 'a',
            statusId: 1,
            startTime: 0,
            endTime: 10,
            data: { ticksFired: 2, other: 'keep' },
          },
        ],
      }
      const state = updateStatusData(withStatuses, 'a', { ticksFired: 3 })
      expect(state.statuses[0].data).toEqual({ ticksFired: 3, other: 'keep' })
    })

    it('data 为 undefined 时也能初始化', () => {
      const withStatuses: PartyState = {
        ...basePartyState(),
        statuses: [{ instanceId: 'a', statusId: 1, startTime: 0, endTime: 10 }],
      }
      const state = updateStatusData(withStatuses, 'a', { ticksFired: 1 })
      expect(state.statuses[0].data).toEqual({ ticksFired: 1 })
    })
  })
})
