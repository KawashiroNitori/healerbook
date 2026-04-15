/**
 * 时间轴状态管理测试
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useTimelineStore } from './timelineStore'
import type { Timeline, Composition } from '@/types/timeline'

describe('timelineStore - 状态管理', () => {
  beforeEach(() => {
    useTimelineStore.getState().reset()
    useTimelineStore.temporal.getState().clear()
  })

  const mockComposition: Composition = {
    players: [
      { id: 1, job: 'PLD' },
      { id: 2, job: 'WHM' },
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
    damageEvents: [],
    castEvents: [],
    statusEvents: [],
    annotations: [],
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
      expect(partyState?.players[1].id).toBe(2)
      expect(partyState?.players[1].job).toBe('WHM')
      expect(partyState?.statuses).toEqual([])
    })

    it('setTimeline 应该自动初始化小队状态', () => {
      const store = useTimelineStore.getState()
      store.setTimeline(mockTimeline)

      // 重新获取状态
      const partyState = useTimelineStore.getState().partyState
      expect(partyState).toBeDefined()
      expect(partyState?.players).toHaveLength(2)
      expect(partyState?.players[0].id).toBe(1)
      expect(partyState?.players[0].job).toBe('PLD')
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
      expect(partyState?.statuses).toHaveLength(1)
      expect(partyState?.statuses[0].statusId).toBe(1873)
      expect(partyState?.statuses[0].startTime).toBe(10)
      expect(partyState?.statuses[0].endTime).toBe(35)
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
      expect(useTimelineStore.getState().partyState?.statuses).toHaveLength(1)

      // 时间点 40: 状态已过期
      store.cleanupExpiredStatuses(40)
      expect(useTimelineStore.getState().partyState?.statuses).toHaveLength(0)
    })
  })

  describe('updatePartyState', () => {
    it('应该更新小队状态', () => {
      const store = useTimelineStore.getState()
      store.initializePartyState(mockComposition)

      const currentState = useTimelineStore.getState().partyState!
      const newPartyState = {
        ...currentState,
        players: currentState.players.map(p => (p.id === 1 ? { ...p, maxHP: 50000 } : p)),
      }

      store.updatePartyState(newPartyState)
      expect(useTimelineStore.getState().partyState?.players[0].maxHP).toBe(50000)
    })
  })
})

describe('undo/redo - temporal 中间件', () => {
  const mockComposition: Composition = {
    players: [
      { id: 1, job: 'PLD' },
      { id: 2, job: 'WHM' },
    ],
  }

  const mockTimeline: Timeline = {
    id: 'test-undo',
    name: '测试撤销',
    encounter: {
      id: 1,
      name: '绝龙诗',
      displayName: '绝龙诗',
      zone: 'Ultimate',
      damageEvents: [],
    },
    composition: mockComposition,
    damageEvents: [],
    castEvents: [],
    statusEvents: [],
    annotations: [],
    createdAt: 1000,
    updatedAt: 1000,
  }

  beforeEach(() => {
    useTimelineStore.getState().reset()
    useTimelineStore.temporal.getState().clear()
  })

  it('应该能撤销添加伤害事件', () => {
    const store = useTimelineStore.getState()
    store.setTimeline(mockTimeline)

    // 添加伤害事件
    store.addDamageEvent({
      id: 'dmg-1',
      name: '地火',
      time: 10,
      damage: 80000,
      type: 'aoe',
      damageType: 'magical',
    })
    expect(useTimelineStore.getState().timeline!.damageEvents).toHaveLength(1)

    // 撤销
    useTimelineStore.temporal.getState().undo()
    expect(useTimelineStore.getState().timeline!.damageEvents).toHaveLength(0)

    // 重做
    useTimelineStore.temporal.getState().redo()
    expect(useTimelineStore.getState().timeline!.damageEvents).toHaveLength(1)
    expect(useTimelineStore.getState().timeline!.damageEvents[0].id).toBe('dmg-1')
  })

  it('应该能撤销删除技能使用事件', () => {
    const store = useTimelineStore.getState()
    const timelineWithCast: Timeline = {
      ...mockTimeline,
      castEvents: [{ id: 'cast-1', actionId: 16536, timestamp: 5, playerId: 1 }],
    }
    store.setTimeline(timelineWithCast)

    // 删除
    store.removeCastEvent('cast-1')
    expect(useTimelineStore.getState().timeline!.castEvents).toHaveLength(0)

    // 撤销 → 恢复
    useTimelineStore.temporal.getState().undo()
    expect(useTimelineStore.getState().timeline!.castEvents).toHaveLength(1)
    expect(useTimelineStore.getState().timeline!.castEvents[0].id).toBe('cast-1')
  })

  it('应该能撤销阵容修改（含级联删除 castEvents）', () => {
    const store = useTimelineStore.getState()
    const timelineWithCast: Timeline = {
      ...mockTimeline,
      castEvents: [
        { id: 'cast-1', actionId: 16536, timestamp: 5, playerId: 1 },
        { id: 'cast-2', actionId: 16534, timestamp: 10, playerId: 2 },
      ],
    }
    store.setTimeline(timelineWithCast)

    // 修改阵容：移除 PLD，只留 WHM
    store.updateComposition({
      players: [{ id: 2, job: 'WHM' }],
    })
    expect(useTimelineStore.getState().timeline!.castEvents).toHaveLength(1)
    expect(useTimelineStore.getState().timeline!.composition.players).toHaveLength(1)

    // 撤销 → 恢复阵容和被级联删除的 castEvents
    useTimelineStore.temporal.getState().undo()
    expect(useTimelineStore.getState().timeline!.castEvents).toHaveLength(2)
    expect(useTimelineStore.getState().timeline!.composition.players).toHaveLength(2)
  })

  it('不应该跟踪非 timeline 字段的变化', () => {
    const store = useTimelineStore.getState()
    store.setTimeline(mockTimeline)
    const initialPastLength = useTimelineStore.temporal.getState().pastStates.length

    // 修改 UI 状态（不应该产生历史记录）
    store.selectEvent('some-event')
    store.setZoomLevel(80)
    store.setCurrentTime(30)

    expect(useTimelineStore.temporal.getState().pastStates.length).toBe(initialPastLength)
  })

  it('历史栈应该在 setTimeline 时清空', () => {
    const store = useTimelineStore.getState()
    store.setTimeline(mockTimeline)

    // 添加一些操作历史
    store.addDamageEvent({
      id: 'dmg-1',
      name: '地火',
      time: 10,
      damage: 80000,
      type: 'aoe',
      damageType: 'magical',
    })
    expect(useTimelineStore.temporal.getState().pastStates.length).toBeGreaterThan(0)

    // 加载新时间轴 → 历史栈应该清空
    store.setTimeline({ ...mockTimeline, id: 'new-timeline' })
    expect(useTimelineStore.temporal.getState().pastStates.length).toBe(0)
    expect(useTimelineStore.temporal.getState().futureStates.length).toBe(0)
  })
})

describe('annotation CRUD', () => {
  const mockComposition: Composition = {
    players: [
      { id: 1, job: 'PLD' },
      { id: 2, job: 'WHM' },
    ],
  }

  const mockTimeline: Timeline = {
    id: 'test-annotations',
    name: '测试注释',
    encounter: {
      id: 1,
      name: '绝龙诗',
      displayName: '绝龙诗',
      zone: 'Ultimate',
      damageEvents: [],
    },
    composition: mockComposition,
    damageEvents: [],
    castEvents: [],
    statusEvents: [],
    annotations: [],
    createdAt: 1000,
    updatedAt: 1000,
  }

  beforeEach(() => {
    useTimelineStore.getState().reset()
    useTimelineStore.temporal.getState().clear()
  })

  it('addAnnotation 应该添加注释', () => {
    const store = useTimelineStore.getState()
    store.setTimeline(mockTimeline)
    store.addAnnotation({
      id: 'ann-1',
      text: '注意减伤',
      time: 10,
      anchor: { type: 'damageTrack' },
    })
    const annotations = useTimelineStore.getState().timeline!.annotations
    expect(annotations).toHaveLength(1)
    expect(annotations[0].id).toBe('ann-1')
    expect(annotations[0].text).toBe('注意减伤')
  })

  it('updateAnnotation 应该更新注释文本', () => {
    const store = useTimelineStore.getState()
    store.setTimeline({
      ...mockTimeline,
      annotations: [{ id: 'ann-1', text: '旧文本', time: 10, anchor: { type: 'damageTrack' } }],
    })
    store.updateAnnotation('ann-1', { text: '新文本' })
    const annotation = useTimelineStore.getState().timeline!.annotations[0]
    expect(annotation.text).toBe('新文本')
    expect(annotation.time).toBe(10)
  })

  it('removeAnnotation 应该删除注释', () => {
    const store = useTimelineStore.getState()
    store.setTimeline({
      ...mockTimeline,
      annotations: [{ id: 'ann-1', text: '测试', time: 10, anchor: { type: 'damageTrack' } }],
    })
    store.removeAnnotation('ann-1')
    expect(useTimelineStore.getState().timeline!.annotations).toHaveLength(0)
  })

  it('updateComposition 应该过滤掉不在新阵容中的 skillTrack 注释', () => {
    const store = useTimelineStore.getState()
    store.setTimeline({
      ...mockTimeline,
      annotations: [
        {
          id: 'ann-1',
          text: '坦克注释',
          time: 10,
          anchor: { type: 'skillTrack', playerId: 1, actionId: 100 },
        },
        {
          id: 'ann-2',
          text: '治疗注释',
          time: 20,
          anchor: { type: 'skillTrack', playerId: 2, actionId: 200 },
        },
        { id: 'ann-3', text: '伤害注释', time: 30, anchor: { type: 'damageTrack' } },
      ],
    })
    store.updateComposition({ players: [{ id: 2, job: 'WHM' }] })
    const annotations = useTimelineStore.getState().timeline!.annotations
    expect(annotations).toHaveLength(2)
    expect(annotations.map(a => a.id)).toEqual(['ann-2', 'ann-3'])
  })

  it('addAnnotation 应该支持撤销/重做', () => {
    const store = useTimelineStore.getState()
    store.setTimeline(mockTimeline)
    store.addAnnotation({
      id: 'ann-1',
      text: '测试撤销',
      time: 10,
      anchor: { type: 'damageTrack' },
    })
    expect(useTimelineStore.getState().timeline!.annotations).toHaveLength(1)
    useTimelineStore.temporal.getState().undo()
    expect(useTimelineStore.getState().timeline!.annotations).toHaveLength(0)
    useTimelineStore.temporal.getState().redo()
    expect(useTimelineStore.getState().timeline!.annotations).toHaveLength(1)
  })
})
