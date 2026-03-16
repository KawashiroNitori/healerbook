/**
 * 时间轴状态管理测试
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useTimelineStore } from './timelineStore'
import type { Timeline, Composition } from '@/types/timeline'

describe('timelineStore - 状态管理', () => {
  beforeEach(() => {
    useTimelineStore.getState().reset()
  })

  const mockComposition: Composition = {
    players: [
      { id: 1, job: 'PLD', name: 'Tank' },
      { id: 2, job: 'WHM', name: 'Healer' },
    ],
  }

  const mockTimeline: Timeline = {
    id: 'test-timeline',
    name: '测试时间轴',
    encounter: {
      id: 1,
      name: '绝龙诗',
      displayName: '绝龙诗',
      zone: 'Ultimate',
      damageEvents: [],
    },
    composition: mockComposition,
    phases: [],
    damageEvents: [],
    castEvents: [],
    statusEvents: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  describe('initializePartyState', () => {
    it('应该根据阵容初始化小队状态', () => {
      const store = useTimelineStore.getState()
      store.initializePartyState(mockComposition)

      // 重新获取状态
      const partyState = useTimelineStore.getState().partyState
      expect(partyState).toBeDefined()
      expect(partyState?.player.id).toBe(1)
      expect(partyState?.player.job).toBe('PLD')
      expect(partyState?.player.statuses).toEqual([])
    })

    it('setTimeline 应该自动初始化小队状态', () => {
      const store = useTimelineStore.getState()
      store.setTimeline(mockTimeline)

      // 重新获取状态
      const partyState = useTimelineStore.getState().partyState
      expect(partyState).toBeDefined()
      expect(partyState?.player.id).toBe(1)
      expect(partyState?.player.job).toBe('PLD')
    })
  })

  describe('executeAction', () => {
    it('应该执行技能并更新小队状态', () => {
      const store = useTimelineStore.getState()
      store.initializePartyState(mockComposition)

      // 执行节制 (16536) - 群体减伤
      store.executeAction(16536, 10, 1)

      // 重新获取状态
      const partyState = useTimelineStore.getState().partyState
      expect(partyState?.player.statuses).toHaveLength(1)
      expect(partyState?.player.statuses[0].statusId).toBe(1873)
      expect(partyState?.player.statuses[0].startTime).toBe(10)
      expect(partyState?.player.statuses[0].endTime).toBe(35)
    })
  })

  describe('cleanupExpiredStatuses', () => {
    it('应该清理过期的状态', () => {
      const store = useTimelineStore.getState()
      store.initializePartyState(mockComposition)

      // 执行节制 (持续 25 秒)
      store.executeAction(16536, 10, 1)

      // 时间点 20: 状态仍然生效
      store.cleanupExpiredStatuses(20)
      expect(useTimelineStore.getState().partyState?.player.statuses).toHaveLength(1)

      // 时间点 40: 状态已过期
      store.cleanupExpiredStatuses(40)
      expect(useTimelineStore.getState().partyState?.player.statuses).toHaveLength(0)
    })
  })

  describe('updatePartyState', () => {
    it('应该更新小队状态', () => {
      const store = useTimelineStore.getState()
      store.initializePartyState(mockComposition)

      const currentState = useTimelineStore.getState().partyState!
      const newPartyState = {
        ...currentState,
        player: {
          ...currentState.player,
          currentHP: 50000,
        },
      }

      store.updatePartyState(newPartyState)
      expect(useTimelineStore.getState().partyState?.player.currentHP).toBe(50000)
    })
  })
})
