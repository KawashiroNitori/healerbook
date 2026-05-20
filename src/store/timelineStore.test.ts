/**
 * 时间轴状态管理测试
 *
 * 真相源是 SyncEngine 的 Y.Doc;`timeline` 是其投影。
 * 测试用 fake-indexeddb 提供 IndexedDB,每个用例独立 DB。
 */

import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import * as Y from 'yjs'
import { useTimelineStore } from './timelineStore'
import type { Composition } from '@/types/timeline'
import type { TimelineContent } from '@/collab/types'
import { IndexedDBDocStore } from '@/collab/storage/IndexedDBDocStore'
import { buildYDoc } from '@/collab/docSchema'

const mockComposition: Composition = {
  players: [
    { id: 1, job: 'PLD' },
    { id: 2, job: 'WHM' },
  ],
}

/** 基础 TimelineContent(去掉 id / updatedAt / statusEvents 等本地/派生字段) */
const baseContent: TimelineContent = {
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
  annotations: [],
  createdAt: 1000,
}

describe('timelineStore - 状态管理', () => {
  beforeEach(() => {
    // eslint-disable-next-line no-global-assign
    indexedDB = new IDBFactory()
    useTimelineStore.getState().reset()
  })

  describe('initializePartyState', () => {
    it('应该根据阵容初始化小队状态', () => {
      const store = useTimelineStore.getState()
      store.initializePartyState(mockComposition)

      const partyState = useTimelineStore.getState().partyState
      expect(partyState).toBeDefined()
      expect(partyState?.statuses).toEqual([])
      expect(partyState?.timestamp).toBe(0)
    })

    it('openTimeline 应该自动初始化小队状态', async () => {
      await useTimelineStore
        .getState()
        .openTimeline('test-timeline', { role: 'local', seedContent: baseContent })

      const partyState = useTimelineStore.getState().partyState
      expect(partyState).toBeDefined()
      expect(partyState?.statuses).toEqual([])
      expect(partyState?.timestamp).toBe(0)
    })

    it('openTimeline 后 timeline 投影 id 为 docId', async () => {
      await useTimelineStore
        .getState()
        .openTimeline('test-timeline', { role: 'local', seedContent: baseContent })
      const timeline = useTimelineStore.getState().timeline
      expect(timeline?.id).toBe('test-timeline')
      expect(timeline?.name).toBe('测试时间轴')
    })
  })

  describe('executeAction', () => {
    it('应该执行技能并更新小队状态', () => {
      const store = useTimelineStore.getState()
      store.initializePartyState(mockComposition)

      // 执行节制 (16536) - 群体减伤
      store.executeAction(16536, 10, 1)

      const partyState = useTimelineStore.getState().partyState
      // 节制会同时附加主状态 1873 与副状态 3881
      expect(partyState?.statuses).toHaveLength(2)
      const primary = partyState?.statuses.find(s => s.statusId === 1873)
      expect(primary?.startTime).toBe(10)
      expect(primary?.endTime).toBe(35)
      const secondary = partyState?.statuses.find(s => s.statusId === 3881)
      expect(secondary?.startTime).toBe(10)
      expect(secondary?.endTime).toBe(40)
    })
  })

  describe('cleanupExpiredStatuses', () => {
    it('应该清理过期的状态', () => {
      const store = useTimelineStore.getState()
      store.initializePartyState(mockComposition)

      // 执行节制（1873 持续 25s，副状态 3881 持续 30s）
      store.executeAction(16536, 10, 1)

      // 时间点 20: 两个状态都仍然生效
      store.cleanupExpiredStatuses(20)
      expect(useTimelineStore.getState().partyState?.statuses).toHaveLength(2)

      // 时间点 36: 1873 已过期（endTime=35），3881 仍生效（endTime=40）
      store.cleanupExpiredStatuses(36)
      const remaining = useTimelineStore.getState().partyState?.statuses ?? []
      expect(remaining).toHaveLength(1)
      expect(remaining[0].statusId).toBe(3881)

      // 时间点 41: 两个状态都已过期
      store.cleanupExpiredStatuses(41)
      expect(useTimelineStore.getState().partyState?.statuses).toHaveLength(0)
    })
  })

  describe('updatePartyState', () => {
    it('应该更新小队状态', () => {
      const store = useTimelineStore.getState()
      store.initializePartyState(mockComposition)

      const newPartyState = {
        statuses: [
          {
            instanceId: 'manual-status',
            statusId: 1873,
            startTime: 0,
            endTime: 10,
          },
        ],
        timestamp: 5,
      }

      store.updatePartyState(newPartyState)
      expect(useTimelineStore.getState().partyState?.statuses).toHaveLength(1)
      expect(useTimelineStore.getState().partyState?.statuses[0].instanceId).toBe('manual-status')
      expect(useTimelineStore.getState().partyState?.timestamp).toBe(5)
    })
  })
})

describe('undo/redo - Y.UndoManager', () => {
  beforeEach(() => {
    // eslint-disable-next-line no-global-assign
    indexedDB = new IDBFactory()
    useTimelineStore.getState().reset()
  })

  it('应该能撤销添加伤害事件', async () => {
    await useTimelineStore
      .getState()
      .openTimeline('test-undo', { role: 'local', seedContent: baseContent })
    const store = useTimelineStore.getState()

    store.addDamageEvent({
      id: 'dmg-1',
      name: '地火',
      time: 10,
      damage: 80000,
      type: 'aoe',
      damageType: 'magical',
    })
    expect(useTimelineStore.getState().timeline!.damageEvents).toHaveLength(1)

    store.undo()
    expect(useTimelineStore.getState().timeline!.damageEvents).toHaveLength(0)

    store.redo()
    expect(useTimelineStore.getState().timeline!.damageEvents).toHaveLength(1)
    expect(useTimelineStore.getState().timeline!.damageEvents[0].id).toBe('dmg-1')
  })

  it('应该能撤销删除技能使用事件', async () => {
    await useTimelineStore.getState().openTimeline('test-undo-cast', {
      role: 'local',
      seedContent: {
        ...baseContent,
        castEvents: [{ id: 'cast-1', actionId: 16536, timestamp: 5, playerId: 1 }],
      },
    })
    const store = useTimelineStore.getState()

    store.removeCastEvent('cast-1')
    expect(useTimelineStore.getState().timeline!.castEvents).toHaveLength(0)

    store.undo()
    expect(useTimelineStore.getState().timeline!.castEvents).toHaveLength(1)
    expect(useTimelineStore.getState().timeline!.castEvents[0].id).toBe('cast-1')
  })

  it('应该能撤销阵容修改（含级联删除 castEvents）', async () => {
    await useTimelineStore.getState().openTimeline('test-undo-comp', {
      role: 'local',
      seedContent: {
        ...baseContent,
        castEvents: [
          { id: 'cast-1', actionId: 16536, timestamp: 5, playerId: 1 },
          { id: 'cast-2', actionId: 16534, timestamp: 10, playerId: 2 },
        ],
      },
    })
    const store = useTimelineStore.getState()

    // 修改阵容：移除 PLD，只留 WHM
    store.updateComposition({ players: [{ id: 2, job: 'WHM' }] })
    expect(useTimelineStore.getState().timeline!.castEvents).toHaveLength(1)
    expect(useTimelineStore.getState().timeline!.composition.players).toHaveLength(1)

    // 撤销 → 恢复阵容和被级联删除的 castEvents
    store.undo()
    expect(useTimelineStore.getState().timeline!.castEvents).toHaveLength(2)
    expect(useTimelineStore.getState().timeline!.composition.players).toHaveLength(2)
  })

  it('不应该跟踪非 timeline 字段的变化', async () => {
    await useTimelineStore
      .getState()
      .openTimeline('test-ui-state', { role: 'local', seedContent: baseContent })
    const store = useTimelineStore.getState()
    expect(useTimelineStore.getState().canUndo).toBe(false)

    // 修改 UI 状态（不应该产生历史记录）
    store.selectEvent('some-event')
    store.setZoomLevel(80)
    store.setCurrentTime(30)

    expect(useTimelineStore.getState().canUndo).toBe(false)
  })

  it('历史栈应该在 openTimeline 时清空', async () => {
    await useTimelineStore
      .getState()
      .openTimeline('test-clear', { role: 'local', seedContent: baseContent })
    useTimelineStore.getState().addDamageEvent({
      id: 'dmg-1',
      name: '地火',
      time: 10,
      damage: 80000,
      type: 'aoe',
      damageType: 'magical',
    })
    expect(useTimelineStore.getState().canUndo).toBe(true)

    // 加载新时间轴 → 新引擎,撤销栈应该为空
    await useTimelineStore
      .getState()
      .openTimeline('new-timeline', { role: 'local', seedContent: baseContent })
    expect(useTimelineStore.getState().canUndo).toBe(false)
    expect(useTimelineStore.getState().canRedo).toBe(false)
  })
})

describe('openTimeline statData auto-fill 不可撤销', () => {
  beforeEach(() => {
    // eslint-disable-next-line no-global-assign
    indexedDB = new IDBFactory()
    useTimelineStore.getState().reset()
  })

  it('打开缺少 statData 的持久化时间轴后,canUndo 应为 false', async () => {
    const docId = 'test-housekeeping-no-statdata'

    // 构建一个不含 statData 的 Y.Doc 并直接落盘,模拟存量迁移产物
    const docWithoutStatData = buildYDoc({ ...baseContent }) // baseContent 无 statData 字段
    const store = new IndexedDBDocStore()
    await store.open()
    await store.appendUpdate(docId, Y.encodeStateAsUpdate(docWithoutStatData))

    // 不传 seedContent,让 openTimeline 从 IndexedDB 加载 → 触发 auto-fill 路径
    await useTimelineStore.getState().openTimeline(docId, { role: 'local' })

    // auto-fill 后,投影应已包含 statData
    expect(useTimelineStore.getState().timeline?.statData).toBeDefined()
    // 关键断言:HOUSEKEEPING_ORIGIN 写入不应被 UndoManager 跟踪
    expect(useTimelineStore.getState().canUndo).toBe(false)
  })
})

describe('annotation CRUD', () => {
  beforeEach(() => {
    // eslint-disable-next-line no-global-assign
    indexedDB = new IDBFactory()
    useTimelineStore.getState().reset()
  })

  it('addAnnotation 应该添加注释', async () => {
    await useTimelineStore
      .getState()
      .openTimeline('test-ann-add', { role: 'local', seedContent: baseContent })
    useTimelineStore.getState().addAnnotation({
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

  it('updateAnnotation 应该更新注释文本', async () => {
    await useTimelineStore.getState().openTimeline('test-ann-update', {
      role: 'local',
      seedContent: {
        ...baseContent,
        annotations: [{ id: 'ann-1', text: '旧文本', time: 10, anchor: { type: 'damageTrack' } }],
      },
    })
    useTimelineStore.getState().updateAnnotation('ann-1', { text: '新文本' })
    const annotation = useTimelineStore.getState().timeline!.annotations[0]
    expect(annotation.text).toBe('新文本')
    expect(annotation.time).toBe(10)
  })

  it('removeAnnotation 应该删除注释', async () => {
    await useTimelineStore.getState().openTimeline('test-ann-remove', {
      role: 'local',
      seedContent: {
        ...baseContent,
        annotations: [{ id: 'ann-1', text: '测试', time: 10, anchor: { type: 'damageTrack' } }],
      },
    })
    useTimelineStore.getState().removeAnnotation('ann-1')
    expect(useTimelineStore.getState().timeline!.annotations).toHaveLength(0)
  })

  it('updateComposition 应该过滤掉不在新阵容中的 skillTrack 注释', async () => {
    await useTimelineStore.getState().openTimeline('test-ann-comp', {
      role: 'local',
      seedContent: {
        ...baseContent,
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
      },
    })
    useTimelineStore.getState().updateComposition({ players: [{ id: 2, job: 'WHM' }] })
    const annotations = useTimelineStore.getState().timeline!.annotations
    expect(annotations).toHaveLength(2)
    expect(annotations.map(a => a.id).sort()).toEqual(['ann-2', 'ann-3'])
  })

  it('addAnnotation 应该支持撤销/重做', async () => {
    await useTimelineStore
      .getState()
      .openTimeline('test-ann-undo', { role: 'local', seedContent: baseContent })
    const store = useTimelineStore.getState()
    store.addAnnotation({
      id: 'ann-1',
      text: '测试撤销',
      time: 10,
      anchor: { type: 'damageTrack' },
    })
    expect(useTimelineStore.getState().timeline!.annotations).toHaveLength(1)
    store.undo()
    expect(useTimelineStore.getState().timeline!.annotations).toHaveLength(0)
    store.redo()
    expect(useTimelineStore.getState().timeline!.annotations).toHaveLength(1)
  })
})

describe('timelineStore - snapshot 兜底渲染数据源', () => {
  beforeEach(() => {
    // eslint-disable-next-line no-global-assign
    indexedDB = new IDBFactory()
    useTimelineStore.getState().reset()
  })

  it('selector: yDocProjection 有值时优先于 snapshot', async () => {
    await useTimelineStore
      .getState()
      .openTimeline('selector-yDoc-priority', { role: 'local', seedContent: baseContent })
    // local 角色不挂 remote、本地 build seed 即视为已加载
    const state = useTimelineStore.getState()
    expect(state.yDocProjection?.name).toBe('测试时间轴')
    expect(state.timeline).toBe(state.yDocProjection)
  })

  it('selector: yDocProjection 为 null 时回退到 snapshot', () => {
    const fakeTimeline: import('@/types/timeline').Timeline = {
      id: 'snap-only',
      name: '只读',
      encounter: null,
      composition: { players: [] },
      damageEvents: [],
      castEvents: [],
      annotations: [],
      statusEvents: [],
      createdAt: 0,
      updatedAt: 0,
    } as unknown as import('@/types/timeline').Timeline
    useTimelineStore.getState().setViewerSnapshot(fakeTimeline)
    const state = useTimelineStore.getState()
    expect(state.yDocProjection).toBeNull()
    expect(state.snapshot).toBe(fakeTimeline)
    expect(state.timeline).toBe(fakeTimeline)
  })

  it('selector: 两者皆 null 时 timeline 为 null', () => {
    useTimelineStore.getState().reset()
    const state = useTimelineStore.getState()
    expect(state.yDocProjection).toBeNull()
    expect(state.snapshot).toBeNull()
    expect(state.timeline).toBeNull()
  })

  it('openTimeline (editor) 缓存命中:立即清 snapshot、yDocReady=true、yDocProjection 就位', async () => {
    // 第一次写入持久化数据
    await useTimelineStore
      .getState()
      .openTimeline('cache-hit-doc', { role: 'local', seedContent: baseContent })
    await useTimelineStore.getState().engine!.flush()
    useTimelineStore.getState().reset()

    // 第二次以 editor 模式打开同 doc 并传 snapshot 兜底:本地缓存应优先,snapshot 立即清
    const fallback = {
      ...baseContent,
      id: 'cache-hit-doc',
      updatedAt: 0,
    } as import('@/types/timeline').Timeline
    // 注意:openTimeline 在 editor/author 模式下会尝试连 WS;此处不挂 WS 测试,因此用 'author'
    // 角色构造同样的"非 local"路径(role !== 'local' → wireRemote)。为避免真实 WS,我们 stub WebSocket。
    // SyncEngine.buildWsUrl 还会读 window.location,node 环境下需要 stub。
    const oldWS = globalThis.WebSocket
    const oldWindow = (globalThis as { window?: unknown }).window
    class StubWS {
      static OPEN = 1
      static CLOSED = 3
      readyState = 0
      binaryType = ''
      onopen: (() => void) | null = null
      onmessage: ((ev: { data: ArrayBuffer }) => void) | null = null
      onclose: ((ev: { code: number }) => void) | null = null
      onerror: (() => void) | null = null
      constructor(public url: string) {}
      send() {}
      close() {
        this.readyState = StubWS.CLOSED
      }
    }
    // @ts-expect-error stub
    globalThis.WebSocket = StubWS
    ;(globalThis as { window?: unknown }).window = {
      location: { protocol: 'http:', host: 'localhost' },
    }

    await useTimelineStore
      .getState()
      .openTimeline('cache-hit-doc', { role: 'author', snapshot: fallback })
    const state = useTimelineStore.getState()
    expect(state.yDocReady).toBe(true)
    expect(state.snapshot).toBeNull()
    expect(state.yDocProjection).not.toBeNull()
    expect(state.timeline).toBe(state.yDocProjection)

    if (oldWS === undefined) {
      delete (globalThis as Record<string, unknown>).WebSocket
    } else {
      globalThis.WebSocket = oldWS
    }
    if (oldWindow === undefined) {
      delete (globalThis as Record<string, unknown>).window
    } else {
      ;(globalThis as { window?: unknown }).window = oldWindow
    }
    useTimelineStore.getState().reset()
  })

  it('openTimeline (editor) 缓存 miss:snapshot 保持、yDocProjection null、yDocReady false', async () => {
    const fallback = {
      id: 'cache-miss-doc',
      name: '兜底',
      encounter: null,
      composition: { players: [] },
      damageEvents: [],
      castEvents: [],
      annotations: [],
      statusEvents: [],
      createdAt: 0,
      updatedAt: 0,
    } as unknown as import('@/types/timeline').Timeline

    const oldWS = globalThis.WebSocket
    const oldWindow = (globalThis as { window?: unknown }).window
    class StubWS {
      static OPEN = 1
      static CLOSED = 3
      readyState = 0
      binaryType = ''
      onopen: (() => void) | null = null
      onmessage: ((ev: { data: ArrayBuffer }) => void) | null = null
      onclose: ((ev: { code: number }) => void) | null = null
      onerror: (() => void) | null = null
      constructor(public url: string) {}
      send() {}
      close() {
        this.readyState = StubWS.CLOSED
      }
    }
    // @ts-expect-error stub
    globalThis.WebSocket = StubWS
    ;(globalThis as { window?: unknown }).window = {
      location: { protocol: 'http:', host: 'localhost' },
    }

    await useTimelineStore
      .getState()
      .openTimeline('cache-miss-doc', { role: 'editor', snapshot: fallback })
    const state = useTimelineStore.getState()
    expect(state.snapshot).toBe(fallback)
    expect(state.yDocProjection).toBeNull()
    expect(state.yDocReady).toBe(false)
    expect(state.timeline).toBe(fallback)

    if (oldWS === undefined) {
      delete (globalThis as Record<string, unknown>).WebSocket
    } else {
      globalThis.WebSocket = oldWS
    }
    if (oldWindow === undefined) {
      delete (globalThis as Record<string, unknown>).window
    } else {
      ;(globalThis as { window?: unknown }).window = oldWindow
    }
    useTimelineStore.getState().reset()
  })

  it('setViewerSnapshot 设置 snapshot 字段、yDocProjection null、yDocReady false', () => {
    const t = {
      id: 'viewer-doc',
      name: 'viewer',
      encounter: null,
      composition: { players: [] },
      damageEvents: [],
      castEvents: [],
      annotations: [],
      statusEvents: [],
      createdAt: 0,
      updatedAt: 0,
    } as unknown as import('@/types/timeline').Timeline
    useTimelineStore.getState().setViewerSnapshot(t)
    const state = useTimelineStore.getState()
    expect(state.snapshot).toBe(t)
    expect(state.yDocProjection).toBeNull()
    expect(state.yDocReady).toBe(false)
    expect(state.sessionRole).toBe('viewer')
  })

  it('reset 清空三源', async () => {
    await useTimelineStore
      .getState()
      .openTimeline('to-reset', { role: 'local', seedContent: baseContent })
    expect(useTimelineStore.getState().yDocProjection).not.toBeNull()
    useTimelineStore.getState().reset()
    const state = useTimelineStore.getState()
    expect(state.yDocProjection).toBeNull()
    expect(state.snapshot).toBeNull()
    expect(state.yDocReady).toBe(false)
    expect(state.timeline).toBeNull()
  })
})
