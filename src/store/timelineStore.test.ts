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
      expect(partyState?.players).toHaveLength(2)
      expect(partyState?.players[0].id).toBe(1)
      expect(partyState?.players[0].job).toBe('PLD')
      expect(partyState?.players[0].statuses).toEqual([])
      expect(partyState?.enemy.statuses).toEqual([])
    })

    it('setTimeline 应该自动初始化小队状态', () => {
      const store = useTimelineStore.getState()
      store.setTimeline(mockTimeline)

      // 重新获取状态
      const partyState = useTimelineStore.getState().partyState
      expect(partyState).toBeDefined()
      expect(partyState?.players).toHaveLength(2)
    })
  })

  describe('executeAction', () => {
    it('应该执行技能并更新小队状态', () => {
      const store = useTimelineStore.getState()
      store.initializePartyState(mockComposition)

      // 执行节制 (16536) - 群体减伤
      store.executeAction(16536, 10)

      // 重新获取状态
      const partyState = useTimelineStore.getState().partyState
      expect(partyState?.players[0].statuses).toHaveLength(1)
      expect(partyState?.players[0].statuses[0].statusId).toBe(1873)
      expect(partyState?.players[0].statuses[0].startTime).toBe(10)
      expect(partyState?.players[0].statuses[0].endTime).toBe(35)
    })

    it('应该支持单体技能', () => {
      const store = useTimelineStore.getState()
      store.initializePartyState(mockComposition)

      // 执行鼓舞激励之策 (185) - 单体盾
      store.executeAction(185, 20, 2)

      // 重新获取状态
      const partyState = useTimelineStore.getState().partyState
      expect(partyState?.players[0].statuses).toHaveLength(0)
      expect(partyState?.players[1].statuses).toHaveLength(1)
      expect(partyState?.players[1].statuses[0].statusId).toBe(297)
    })

    it('应该支持敌方 Debuff', () => {
      const store = useTimelineStore.getState()
      store.initializePartyState(mockComposition)

      // 执行雪仇 (7535) - 敌方减伤
      store.executeAction(7535, 30)

      // 重新获取状态
      const partyState = useTimelineStore.getState().partyState
      expect(partyState?.enemy.statuses).toHaveLength(1)
      expect(partyState?.enemy.statuses[0].statusId).toBe(1193)
    })
  })

  describe('getPartyStateAtTime', () => {
    it('应该返回指定时间点的小队状态', () => {
      const store = useTimelineStore.getState()
      const timeline: Timeline = {
        ...mockTimeline,
        castEvents: [
          {
            id: 'c1',
            actionId: 16536, // 节制
            timestamp: 10000, // 10 秒（毫秒）
            playerId: 1,
            job: 'WHM',
          },
          {
            id: 'c2',
            actionId: 7535, // 雪仇
            timestamp: 15000, // 15 秒（毫秒）
            playerId: 2,
            job: 'PLD',
          },
        ],
        statusEvents: [],
      }
      store.setTimeline(timeline)

      // 时间点 20: 两个技能都应该生效
      const state20 = store.getPartyStateAtTime(20)
      expect(state20?.players[0].statuses).toHaveLength(1) // 节制
      expect(state20?.enemy.statuses).toHaveLength(1) // 雪仇

      // 时间点 5: 没有技能生效
      const state5 = store.getPartyStateAtTime(5)
      expect(state5?.players[0].statuses).toHaveLength(0)
      expect(state5?.enemy.statuses).toHaveLength(0)
    })

    it('应该过滤掉已过期的状态', () => {
      const store = useTimelineStore.getState()
      const timeline: Timeline = {
        ...mockTimeline,
        castEvents: [
          {
            id: 'c1',
            actionId: 16536, // 节制 (持续 25 秒)
            timestamp: 10000, // 10 秒（毫秒）
            playerId: 1,
            job: 'WHM',
          },
        ],
        statusEvents: [],
      }
      store.setTimeline(timeline)

      // 时间点 20: 节制生效 (10-35)
      const state20 = store.getPartyStateAtTime(20)
      expect(state20?.players[0].statuses).toHaveLength(1)

      // 时间点 40: 节制已过期
      const state40 = store.getPartyStateAtTime(40)
      expect(state40?.players[0].statuses).toHaveLength(0)
    })
  })

  describe('cleanupExpiredStatuses', () => {
    it('应该清理过期的状态', () => {
      const store = useTimelineStore.getState()
      store.initializePartyState(mockComposition)

      // 执行节制 (持续 25 秒)
      store.executeAction(16536, 10)

      // 时间点 20: 状态仍然生效
      store.cleanupExpiredStatuses(20)
      expect(useTimelineStore.getState().partyState?.players[0].statuses).toHaveLength(1)

      // 时间点 40: 状态已过期
      store.cleanupExpiredStatuses(40)
      expect(useTimelineStore.getState().partyState?.players[0].statuses).toHaveLength(0)
    })
  })

  describe('updatePartyState', () => {
    it('应该更新小队状态', () => {
      const store = useTimelineStore.getState()
      store.initializePartyState(mockComposition)

      const currentState = useTimelineStore.getState().partyState!
      const newPartyState = {
        ...currentState,
        players: currentState.players.map((p) => ({
          ...p,
          currentHP: 50000,
        })),
      }

      store.updatePartyState(newPartyState)
      expect(useTimelineStore.getState().partyState?.players[0].currentHP).toBe(50000)
    })
  })
})
