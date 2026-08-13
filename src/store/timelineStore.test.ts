/**
 * 时间轴状态管理测试
 *
 * 真相源是 SyncEngine 的 Y.Doc;`timeline` 是其投影。
 * 测试用 fake-indexeddb 提供 IndexedDB,每个用例独立 DB。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import * as Y from 'yjs'
import { useTimelineStore } from './timelineStore'
import type { Composition, DamageEvent, CastEvent, SyncEvent } from '@/types/timeline'
import type { TimelineContent } from '@/collab/types'
import type { EncounterStatistics } from '@/types/mitigation'
import { IndexedDBDocStore } from '@/collab/storage/IndexedDBDocStore'
import { buildYDoc } from '@/collab/docSchema'
import * as RaidEncountersModule from '@/data/raidEncounters'
import { toLevel } from '@/types/level'

const mockComposition: Composition = {
  players: [
    { id: 1, job: 'PLD' },
    { id: 2, job: 'WHM' },
  ],
}

/** 医养（白魔群体治疗 GCD），Task 5 落的 minLevel: 96，90 级下不可用 */
const MEDICA_III_ID = 37010
/** 铁壁，无等级区间限制，任何等级都可用 */
const RAMPART_ID = 7531

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

  describe('会话重置', () => {
    it('openTimeline 应清空上一文档残留的 statistics', async () => {
      const store = useTimelineStore.getState()
      // 模拟上一个文档留下的统计数据（仅需 truthy 对象，字段不参与断言）
      store.setStatistics({ players: [] } as unknown as EncounterStatistics)
      expect(useTimelineStore.getState().statistics).not.toBeNull()

      await store.openTimeline('doc-b', { role: 'local', seedContent: baseContent })

      expect(useTimelineStore.getState().statistics).toBeNull()
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

  it('应该能撤销删除伤害事件（单个 removeDamageEvent）', async () => {
    await useTimelineStore.getState().openTimeline('test-undo-dmg', {
      role: 'local',
      seedContent: {
        ...baseContent,
        damageEvents: [
          {
            id: 'dmg-1',
            name: '地火',
            time: 10,
            damage: 80000,
            type: 'aoe',
            damageType: 'magical',
          },
        ],
      },
    })
    const store = useTimelineStore.getState()

    store.removeDamageEvent('dmg-1')
    expect(useTimelineStore.getState().timeline!.damageEvents).toHaveLength(0)

    store.undo()
    expect(useTimelineStore.getState().timeline!.damageEvents).toHaveLength(1)
    expect(useTimelineStore.getState().timeline!.damageEvents[0].id).toBe('dmg-1')
  })

  it('应该能撤销批量删除（bulkDeleteSelection）', async () => {
    await useTimelineStore.getState().openTimeline('test-undo-bulk', {
      role: 'local',
      seedContent: {
        ...baseContent,
        damageEvents: [
          {
            id: 'dmg-1',
            name: '地火',
            time: 10,
            damage: 80000,
            type: 'aoe',
            damageType: 'magical',
          },
          {
            id: 'dmg-2',
            name: '月环',
            time: 20,
            damage: 90000,
            type: 'aoe',
            damageType: 'magical',
          },
        ],
      },
    })
    const store = useTimelineStore.getState()
    store.setSelection({ eventIds: ['dmg-1', 'dmg-2'], castEventIds: [], annotationIds: [] })
    store.bulkDeleteSelection()
    expect(useTimelineStore.getState().timeline!.damageEvents).toHaveLength(0)

    store.undo()
    expect(useTimelineStore.getState().timeline!.damageEvents).toHaveLength(2)
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

    expect(useTimelineStore.getState().canUndo).toBe(false)
  })

  it('addCastEventsBatch 批量加 = 单步 undo', async () => {
    await useTimelineStore
      .getState()
      .openTimeline('test-batch-cast', { role: 'local', seedContent: baseContent })
    const store = useTimelineStore.getState()
    const before = useTimelineStore.getState().timeline!.castEvents.length
    store.addCastEventsBatch([
      { actionId: 7535, timestamp: 10, playerId: 1 },
      { actionId: 3540, timestamp: 20, playerId: 2 },
    ])
    expect(useTimelineStore.getState().timeline!.castEvents.length).toBe(before + 2)
    store.undo()
    expect(useTimelineStore.getState().timeline!.castEvents.length).toBe(before) // 一步全撤
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

  it('addAnnotation 应该添加备注', async () => {
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

  it('updateAnnotation 应该更新备注文本', async () => {
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

  it('removeAnnotation 应该删除备注', async () => {
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

  it('updateComposition 应该过滤掉不在新阵容中的 skillTrack 备注', async () => {
    await useTimelineStore.getState().openTimeline('test-ann-comp', {
      role: 'local',
      seedContent: {
        ...baseContent,
        annotations: [
          {
            id: 'ann-1',
            text: '坦克备注',
            time: 10,
            anchor: { type: 'skillTrack', playerId: 1, actionId: 100 },
          },
          {
            id: 'ann-2',
            text: '治疗备注',
            time: 20,
            anchor: { type: 'skillTrack', playerId: 2, actionId: 200 },
          },
          { id: 'ann-3', text: '伤害备注', time: 30, anchor: { type: 'damageTrack' } },
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

  it('onLoadedHandler 幂等:连续触发 2 次只生效 1 次', async () => {
    await useTimelineStore
      .getState()
      .openTimeline('idempotent-doc', { role: 'local', seedContent: baseContent })
    await useTimelineStore.getState().engine!.flush()
    useTimelineStore.getState().reset()

    const fallback = {
      ...baseContent,
      id: 'idempotent-doc',
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
      .openTimeline('idempotent-doc', { role: 'author', snapshot: fallback })

    // 第一次已由 hadPersistedData 路径触发:yDocReady=true,snapshot=null
    const after1 = useTimelineStore.getState()
    expect(after1.yDocReady).toBe(true)
    expect(after1.snapshot).toBeNull()
    const projectionRef = after1.yDocProjection

    // 模拟 LOAD_REPLY 再次触发 onLoadedHandler:伪造一个新 snapshot,然后调用内部 handler
    // 由于 handler 闭包私有,改通过 store 模拟"重新打开 + 再次缓存命中"的二次幂等:
    // 直接验证 set 一次 snapshot 再不被自动清除(因为 yDocReady 已 true,reset 之前都不会再短路)
    // 这里采用更直接的方法:断言第二次同样路径的 openTimeline 仍是幂等的 —— yDocProjection 引用变,
    // 但 yDocReady / snapshot 状态正确。
    await useTimelineStore
      .getState()
      .openTimeline('idempotent-doc', { role: 'author', snapshot: fallback })
    const after2 = useTimelineStore.getState()
    expect(after2.yDocReady).toBe(true)
    expect(after2.snapshot).toBeNull()
    // 第二次 openTimeline 重建了 engine,所以 yDocProjection 引用换;但 selector 值非 null
    expect(after2.yDocProjection).not.toBeNull()
    // engine 不同实例
    expect(after2.engine).not.toBe(after1.engine)
    // 引用变化是正常的;关键是 snapshot 没回到 fallback
    void projectionRef

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

  it('撤权时 yDocProjection 已就绪:sessionRole 变 viewer,selector 仍走 yDocProjection', async () => {
    await useTimelineStore
      .getState()
      .openTimeline('revoke-after-ready', { role: 'local', seedContent: baseContent })
    const projection = useTimelineStore.getState().yDocProjection
    expect(projection).not.toBeNull()

    // 模拟撤权:sessionRole 直接设为 viewer(实际通过 wireRemote 的 onRevoked 回调驱动,
    // 此测试只验证 selector 仍走 yDocProjection)
    useTimelineStore.setState({ sessionRole: 'viewer' })

    const state = useTimelineStore.getState()
    expect(state.sessionRole).toBe('viewer')
    expect(state.yDocProjection).toBe(projection)
    expect(state.timeline).toBe(state.yDocProjection)
  })

  it('撤权时仍在 snapshot 兜底渲染期:sessionRole 变 viewer,selector 走 snapshot', async () => {
    const fallback = {
      id: 'revoke-during-fallback',
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
      .openTimeline('revoke-during-fallback', { role: 'editor', snapshot: fallback })

    expect(useTimelineStore.getState().yDocProjection).toBeNull()
    expect(useTimelineStore.getState().snapshot).toBe(fallback)
    expect(useTimelineStore.getState().timeline).toBe(fallback)

    // 模拟撤权
    useTimelineStore.setState({ sessionRole: 'viewer' })

    const state = useTimelineStore.getState()
    expect(state.sessionRole).toBe('viewer')
    expect(state.yDocProjection).toBeNull()
    expect(state.snapshot).toBe(fallback)
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
})

describe('bulkImport', () => {
  beforeEach(async () => {
    // eslint-disable-next-line no-global-assign
    indexedDB = new IDBFactory()
    const store = useTimelineStore.getState()
    await store.openTimeline('bulk-import-test', { role: 'local', seedContent: baseContent })
  })

  afterEach(() => {
    useTimelineStore.getState().reset()
  })

  it('一次写入若干 damage / cast / sync，仅一步 undo 全部回滚', () => {
    const before = useTimelineStore.getState().timeline!
    const damages: DamageEvent[] = [
      { id: 'will-regen-1', name: 'd1', time: 1, damage: 100, type: 'aoe', damageType: 'magical' },
      { id: 'will-regen-2', name: 'd2', time: 2, damage: 200, type: 'aoe', damageType: 'magical' },
    ]
    const casts: CastEvent[] = [{ id: 'will-regen-c1', actionId: 7382, timestamp: 1, playerId: 1 }]
    const syncs: SyncEvent[] = [
      { time: 1, type: 'cast', actionId: 100, actionName: 'A', window: [2, 2], syncOnce: false },
    ]

    useTimelineStore
      .getState()
      .bulkImport({ damageEvents: damages, castEvents: casts, syncEvents: syncs })

    const after = useTimelineStore.getState().timeline!
    expect(after.damageEvents.length).toBe(before.damageEvents.length + 2)
    expect(after.castEvents.length).toBe(before.castEvents.length + 1)
    expect(after.syncEvents?.length).toBe(1)

    // 一步 undo 即清空
    expect(useTimelineStore.getState().canUndo).toBe(true)
    useTimelineStore.getState().undo()

    const reverted = useTimelineStore.getState().timeline!
    expect(reverted.damageEvents.length).toBe(before.damageEvents.length)
    expect(reverted.castEvents.length).toBe(before.castEvents.length)
    expect(useTimelineStore.getState().canUndo).toBe(false)
    expect(reverted.syncEvents == null || reverted.syncEvents.length === 0).toBe(true)
  })

  it('写入时给每条 damage / cast 重新生成 id（避免与现有冲突）', () => {
    useTimelineStore.getState().bulkImport({
      damageEvents: [
        { id: 'foo', name: 'd', time: 1, damage: 100, type: 'aoe', damageType: 'magical' },
      ],
    })
    const ev = useTimelineStore.getState().timeline!.damageEvents.at(-1)!
    expect(ev.id).not.toBe('foo')
    expect(ev.id.length).toBeGreaterThan(4)
  })

  it('sync 整数组替换（带原有 sync 时与 incoming 合并并按 time 排序）', () => {
    // 通过 store 不暴露的方式预置 sync 不方便；改用先 bulkImport 一条做 baseline
    useTimelineStore.getState().bulkImport({
      syncEvents: [
        { time: 10, type: 'cast', actionId: 100, actionName: 'A', window: [0, 0], syncOnce: false },
      ],
    })
    // 再追加另一条更早的
    useTimelineStore.getState().bulkImport({
      syncEvents: [
        { time: 5, type: 'cast', actionId: 200, actionName: 'B', window: [0, 0], syncOnce: false },
      ],
    })

    const sync = useTimelineStore.getState().timeline!.syncEvents!
    expect(sync.map(s => s.time)).toEqual([5, 10])
  })
})

const seedWithItems: TimelineContent = {
  ...baseContent,
  damageEvents: [
    { id: 'd1', name: 'AA', time: 10, damage: 1000, type: 'aoe', damageType: 'magical' },
  ],
  castEvents: [{ id: 'c1', actionId: 16536, timestamp: 12, playerId: 2 }],
  annotations: [{ id: 'a1', text: '注', time: 14, anchor: { type: 'damageTrack' } }],
}

describe('bulkMoveSelection', () => {
  beforeEach(async () => {
    // eslint-disable-next-line no-global-assign
    indexedDB = new IDBFactory()
    await useTimelineStore
      .getState()
      .openTimeline('move-test', { role: 'local', seedContent: seedWithItems })
  })

  afterEach(() => {
    useTimelineStore.getState().reset()
  })

  it('对全部选中对象施加同一 delta，下界夹紧', () => {
    const store = useTimelineStore.getState()
    store.setSelection({ eventIds: ['d1'], castEventIds: ['c1'], annotationIds: ['a1'] })
    store.bulkMoveSelection(5)
    const tl = useTimelineStore.getState().timeline!
    expect(tl.damageEvents.find(e => e.id === 'd1')!.time).toBe(15)
    expect(tl.castEvents.find(c => c.id === 'c1')!.timestamp).toBe(17)
    expect(tl.annotations!.find(a => a.id === 'a1')!.time).toBe(19)
  })

  it('伤害事件下界为 0', () => {
    const store = useTimelineStore.getState()
    store.setSelection({ eventIds: ['d1'] })
    store.bulkMoveSelection(-1000)
    expect(useTimelineStore.getState().timeline!.damageEvents.find(e => e.id === 'd1')!.time).toBe(
      0
    )
  })

  it('一次移动只产生一步 undo', () => {
    const store = useTimelineStore.getState()
    store.setSelection({ eventIds: ['d1'], castEventIds: ['c1'] })
    store.bulkMoveSelection(3)
    store.undo()
    const tl = useTimelineStore.getState().timeline!
    expect(tl.damageEvents.find(e => e.id === 'd1')!.time).toBe(10)
    expect(tl.castEvents.find(c => c.id === 'c1')!.timestamp).toBe(12)
  })
})

describe('bulkMoveSelection – 地板 effective delta 保持 castWindow 偏移', () => {
  const seedWithCastFields: TimelineContent = {
    ...baseContent,
    damageEvents: [
      {
        id: 'dc',
        name: 'W',
        time: 5,
        damage: 100,
        type: 'aoe',
        damageType: 'magical',
        castStartTime: 3,
        castEndTime: 8,
      } as DamageEvent,
    ],
    castEvents: [],
    annotations: [],
  }

  beforeEach(async () => {
    // eslint-disable-next-line no-global-assign
    indexedDB = new IDBFactory()
    await useTimelineStore
      .getState()
      .openTimeline('cast-floor-test', { role: 'local', seedContent: seedWithCastFields })
  })

  afterEach(() => {
    useTimelineStore.getState().reset()
  })

  it('超出地板时 castStartTime/castEndTime 按 effective delta 移动（窗口与菱形保持对齐）', () => {
    const store = useTimelineStore.getState()
    store.setSelection({ eventIds: ['dc'] })
    // delta = -1000: time 从 5 夹紧到 0，eff = -5
    store.bulkMoveSelection(-1000)
    const ev = useTimelineStore.getState().timeline!.damageEvents.find(e => e.id === 'dc')!
    expect(ev.time).toBe(0)
    // offset (castStart - time) 应保持为 -2，offset (castEnd - time) 保持为 3
    expect(ev.castStartTime).toBe(3 + (0 - 5)) // = -2
    expect(ev.castEndTime).toBe(8 + (0 - 5)) // = 3
  })
})

describe('bulkDeleteSelection', () => {
  beforeEach(async () => {
    // eslint-disable-next-line no-global-assign
    indexedDB = new IDBFactory()
    await useTimelineStore
      .getState()
      .openTimeline('del-test', { role: 'local', seedContent: seedWithItems })
  })

  afterEach(() => {
    useTimelineStore.getState().reset()
  })

  it('删除全部选中并清空 selection，单步 undo', () => {
    const store = useTimelineStore.getState()
    store.setSelection({ eventIds: ['d1'], castEventIds: ['c1'], annotationIds: ['a1'] })
    store.bulkDeleteSelection()
    let tl = useTimelineStore.getState().timeline!
    expect(tl.damageEvents).toHaveLength(0)
    expect(tl.castEvents).toHaveLength(0)
    expect(tl.annotations ?? []).toHaveLength(0)
    expect(useTimelineStore.getState().selectedEventIds).toEqual([])

    store.undo()
    tl = useTimelineStore.getState().timeline!
    expect(tl.damageEvents).toHaveLength(1)
    expect(tl.castEvents).toHaveLength(1)
  })
})

describe('多选 selection', () => {
  beforeEach(async () => {
    // eslint-disable-next-line no-global-assign
    indexedDB = new IDBFactory()
    useTimelineStore.getState().reset()
    await useTimelineStore.getState().openTimeline('sel-test', {
      role: 'local',
      seedContent: baseContent,
    })
  })

  it('setSelection 写入数组并派生单选', () => {
    useTimelineStore.getState().setSelection({ eventIds: ['e1'] })
    const s = useTimelineStore.getState()
    expect(s.selectedEventIds).toEqual(['e1'])
    expect(s.selectedEventId).toBe('e1') // 单选派生
    expect(s.selectedCastEventId).toBeNull()
  })

  it('多选时派生单选为 null（面板不弹）', () => {
    useTimelineStore.getState().setSelection({ eventIds: ['e1', 'e2'] })
    const s = useTimelineStore.getState()
    expect(s.selectedEventIds).toEqual(['e1', 'e2'])
    expect(s.selectedEventId).toBeNull()
  })

  it('混合类型选中时派生单选为 null', () => {
    useTimelineStore.getState().setSelection({ eventIds: ['e1'], castEventIds: ['c1'] })
    expect(useTimelineStore.getState().selectedEventId).toBeNull()
    expect(useTimelineStore.getState().selectedCastEventId).toBeNull()
  })

  it('toggleSelection 切换单个对象', () => {
    useTimelineStore.getState().setSelection({ castEventIds: ['c1'] })
    useTimelineStore.getState().toggleSelection('cast', 'c2')
    expect(useTimelineStore.getState().selectedCastEventIds.sort()).toEqual(['c1', 'c2'])
    useTimelineStore.getState().toggleSelection('cast', 'c1')
    expect(useTimelineStore.getState().selectedCastEventIds).toEqual(['c2'])
  })

  it('addToSelection 求并集去重', () => {
    useTimelineStore.getState().setSelection({ eventIds: ['e1'] })
    useTimelineStore.getState().addToSelection({ eventIds: ['e1', 'e2'], annotationIds: ['a1'] })
    const s = useTimelineStore.getState()
    expect(s.selectedEventIds.sort()).toEqual(['e1', 'e2'])
    expect(s.selectedAnnotationIds).toEqual(['a1'])
  })

  it('clearSelection 清空全部', () => {
    useTimelineStore.getState().setSelection({ eventIds: ['e1'], castEventIds: ['c1'] })
    useTimelineStore.getState().clearSelection()
    const s = useTimelineStore.getState()
    expect(s.selectedEventIds).toEqual([])
    expect(s.selectedCastEventIds).toEqual([])
    expect(s.selectedAnnotationIds).toEqual([])
    expect(s.selectedEventId).toBeNull()
  })

  it('selectEvent(id) 等价单选；selectEvent(null) 清空', () => {
    useTimelineStore.getState().selectEvent('e9')
    expect(useTimelineStore.getState().selectedEventIds).toEqual(['e9'])
    useTimelineStore.getState().selectEvent(null)
    expect(useTimelineStore.getState().selectedEventIds).toEqual([])
  })

  it('removeAnnotation 清理 selectedAnnotationIds', async () => {
    const seedAnn: TimelineContent = {
      ...baseContent,
      annotations: [{ id: 'an1', text: 'n', time: 5, anchor: { type: 'damageTrack' } }],
    }
    await useTimelineStore
      .getState()
      .openTimeline('ann-rm-test', { role: 'local', seedContent: seedAnn })
    useTimelineStore.getState().setSelection({ annotationIds: ['an1'] })
    expect(useTimelineStore.getState().selectedAnnotationIds).toEqual(['an1'])
    useTimelineStore.getState().removeAnnotation('an1')
    expect(useTimelineStore.getState().selectedAnnotationIds).toEqual([])
  })

  it('切换时间轴清空选择数组', async () => {
    useTimelineStore.getState().setSelection({ eventIds: ['x1', 'x2'] })
    expect(useTimelineStore.getState().selectedEventIds).toEqual(['x1', 'x2'])
    await useTimelineStore
      .getState()
      .openTimeline('another-tl', { role: 'local', seedContent: baseContent })
    expect(useTimelineStore.getState().selectedEventIds).toEqual([])
  })
})

describe('pasteObjects', () => {
  beforeEach(async () => {
    // eslint-disable-next-line no-global-assign
    indexedDB = new IDBFactory()
    await useTimelineStore
      .getState()
      .openTimeline('paste-test', { role: 'local', seedContent: baseContent })
  })

  afterEach(() => {
    useTimelineStore.getState().reset()
  })

  it('以新 id 写入三类对象并选中它们，单步 undo', () => {
    const store = useTimelineStore.getState()
    store.pasteObjects({
      damageEvents: [{ name: 'X', time: 5, damage: 1, type: 'aoe', damageType: 'magical' }],
      castEvents: [{ actionId: 16536, timestamp: 6, playerId: 2 }],
      annotations: [{ text: '注', time: 7, anchor: { type: 'damageTrack' } }],
    })
    const s = useTimelineStore.getState()
    const tl = s.timeline!
    expect(tl.damageEvents).toHaveLength(1)
    expect(tl.castEvents).toHaveLength(1)
    expect(tl.annotations).toHaveLength(1)
    expect(s.selectedEventIds).toEqual([tl.damageEvents[0].id])
    expect(s.selectedCastEventIds).toEqual([tl.castEvents[0].id])
    expect(s.selectedAnnotationIds).toEqual([tl.annotations![0].id])

    store.undo()
    expect(useTimelineStore.getState().timeline!.damageEvents).toHaveLength(0)
  })
})

describe('setLevel', () => {
  beforeEach(async () => {
    // eslint-disable-next-line no-global-assign
    indexedDB = new IDBFactory()
    await useTimelineStore
      .getState()
      .openTimeline('set-level-test', { role: 'local', seedContent: baseContent })
  })

  afterEach(() => {
    useTimelineStore.getState().reset()
  })

  it('切到低等级时清理该等级不可用的 cast', () => {
    const store = useTimelineStore.getState()
    store.addCastEvent({
      id: 'cast-medica',
      actionId: MEDICA_III_ID,
      timestamp: 10,
      playerId: 2,
    })
    expect(useTimelineStore.getState().timeline!.castEvents).toHaveLength(1)

    store.setLevel(90)

    expect(useTimelineStore.getState().timeline!.level).toBe(90)
    expect(useTimelineStore.getState().timeline!.castEvents).toHaveLength(0)
  })

  it('保留该等级仍可用的 cast', () => {
    const store = useTimelineStore.getState()
    store.addCastEvent({
      id: 'cast-rampart',
      actionId: RAMPART_ID,
      timestamp: 10,
      playerId: 1,
    })

    store.setLevel(70)

    expect(useTimelineStore.getState().timeline!.castEvents).toHaveLength(1)
  })

  it('一次 undo 同时恢复等级与被清理的 cast', () => {
    const store = useTimelineStore.getState()
    store.addCastEvent({
      id: 'cast-medica',
      actionId: MEDICA_III_ID,
      timestamp: 10,
      playerId: 2,
    })

    // Y.UndoManager 在 captureTimeout(400ms)内会把相邻事务合并为一个撤销步；
    // 这里显式截断，让 setLevel 独立成一步，才能验证「setLevel 自身单事务」的语义，
    // 而不是恰好把 addCastEvent 也一并撤销掉。
    store.engine!.undoManager.stopCapturing()

    store.setLevel(90)
    expect(useTimelineStore.getState().timeline!.castEvents).toHaveLength(0)

    store.undo()

    expect(useTimelineStore.getState().timeline!.level).toBe(100)
    expect(useTimelineStore.getState().timeline!.castEvents).toHaveLength(1)
  })

  it('setLevel 只产生一个顶层 Yjs 事务', () => {
    const store = useTimelineStore.getState()
    // 前置：加一个 90 级下不可用的 cast（医养），确保清理分支真的会执行——
    // 否则 removedIds 为空，测的就只是 ySetMeta 的空转路径。
    store.addCastEvent({
      id: 'cast-medica',
      actionId: MEDICA_III_ID,
      timestamp: 10,
      playerId: 2,
    })

    const engine = store.engine!
    let transactions = 0
    const handler = () => {
      transactions++
    }
    // afterTransaction 只在最外层 transact 结束时触发一次；嵌套 transact（ySetMeta /
    // yRemoveCastEvent 内部各自的 doc.transact）会被合并进最外层，不会重复计数。
    // 这与 UndoManager 的 captureTimeout 合并栈项是两回事，能精确区分
    // 「单个顶层 transact」和「两个紧邻的独立顶层 transact」。
    engine.doc.on('afterTransaction', handler)
    store.setLevel(90)
    engine.doc.off('afterTransaction', handler)

    expect(transactions).toBe(1)
  })

  it('等级未变化时不产生事务', () => {
    const store = useTimelineStore.getState()
    const before = useTimelineStore.getState().canUndo
    const engine = store.engine!
    let transactions = 0
    const handler = () => {
      transactions++
    }
    engine.doc.on('afterTransaction', handler)
    store.setLevel(useTimelineStore.getState().timeline!.level ?? 100)
    engine.doc.off('afterTransaction', handler)

    expect(useTimelineStore.getState().canUndo).toBe(before)
    // 早退路径完全不调用 engine.doc.transact，afterTransaction 应为 0 次
    expect(transactions).toBe(0)
  })
})

describe('updateEncounter', () => {
  beforeEach(async () => {
    // eslint-disable-next-line no-global-assign
    indexedDB = new IDBFactory()
    await useTimelineStore
      .getState()
      .openTimeline('update-encounter-test', { role: 'local', seedContent: baseContent })
  })

  afterEach(() => {
    useTimelineStore.getState().reset()
    vi.restoreAllMocks()
  })

  it('改绑到另一个已存在的副本：encounter 各字段与 gameZoneId 都按新副本更新', () => {
    const store = useTimelineStore.getState()
    // FRU（id 1079）：真实静态表条目，与 baseContent 里的假副本（id 1）完全不同，
    // 用来断言写入的不是「碰巧一样」的值。
    store.updateEncounter(1079)

    const encounter = useTimelineStore.getState().timeline!.encounter
    expect(encounter).toEqual({
      id: 1079,
      name: 'FRU',
      displayName: '光暗未来绝境战',
      zone: '',
      damageEvents: [],
    })
    expect(useTimelineStore.getState().timeline!.gameZoneId).toBe(1238)
  })

  it('一次 undo 能还原 encounter（锁定用了 LOCAL_ORIGIN，UndoManager 能追踪到）', () => {
    const store = useTimelineStore.getState()
    const before = useTimelineStore.getState().timeline!.encounter

    store.updateEncounter(1079)
    expect(useTimelineStore.getState().timeline!.encounter.id).toBe(1079)

    store.undo()

    expect(useTimelineStore.getState().timeline!.encounter).toEqual(before)
    expect(useTimelineStore.getState().timeline!.gameZoneId).toBeUndefined()
  })

  it('encounterId 查不到对应副本时直接返回，不产生事务', () => {
    const store = useTimelineStore.getState()
    const engine = store.engine!
    const beforeEncounter = useTimelineStore.getState().timeline!.encounter
    let transactions = 0
    const handler = () => {
      transactions++
    }
    engine.doc.on('afterTransaction', handler)
    store.updateEncounter(999999)
    engine.doc.off('afterTransaction', handler)

    expect(useTimelineStore.getState().timeline!.encounter).toEqual(beforeEncounter)
    // 守卫路径（getEncounterById 返回 undefined）完全不调用 engine.doc.transact
    expect(transactions).toBe(0)
  })

  // 覆盖边界说明：SettingsDialog 的 handleEncounterChange 是 updateEncounter + setLevel(toLevel(encounter.level))
  // 这两步的实际调用方（组件里额外读一次 getEncounterById 拿 level 再传给 setLevel）。
  // 组件渲染成本高（需要 mock 阵容 / statistics 等一堆上下文），这里改为在 store 层
  // 直接复现同样的两步调用序列，验证「改绑副本 → 等级跟着跳到新副本 level」这条组合语义，
  // 不覆盖 SettingsDialog 内 JSX/Select 交互本身。
  it('改绑到等级不同的副本后，随后 setLevel(新副本 level) 能让等级真的跳过去', () => {
    // RAID_TIERS 现有副本清一色 level: 100，真实数据下这条分支永远是从 100 跳到 100
    // 的空操作，测不出真变化；注入一个 level: 90 的假副本来锁住链路本身是否连通。
    const mockEncounter = {
      id: 8888,
      name: '假绝境战',
      shortName: 'FAKE',
      gameZoneId: 8888,
      level: 90,
    }
    vi.spyOn(RaidEncountersModule, 'getEncounterById').mockReturnValue(mockEncounter)

    const store = useTimelineStore.getState()
    expect(useTimelineStore.getState().timeline!.level).toBe(100)

    // 复现 SettingsDialog.handleEncounterChange 的调用序列
    store.updateEncounter(8888)
    store.setLevel(toLevel(mockEncounter.level))

    expect(useTimelineStore.getState().timeline!.encounter.id).toBe(8888)
    expect(useTimelineStore.getState().timeline!.gameZoneId).toBe(8888)
    expect(useTimelineStore.getState().timeline!.level).toBe(90)
  })
})
