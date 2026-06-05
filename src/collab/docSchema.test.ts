import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import {
  buildYDoc,
  projectTimeline,
  yAddDamageEvent,
  yUpdateDamageEvent,
  yRemoveDamageEvent,
  yExitReplayMode,
} from './docSchema'
import { Y_MAP, LOCAL_ORIGIN } from './constants'
import type { TimelineContent } from './types'

const sample: TimelineContent = {
  name: '测试',
  encounter: { id: 1, name: 'E', displayName: 'E', zone: '', damageEvents: [] },
  composition: {
    players: [
      { id: 1, job: 'PLD' },
      { id: 2, job: 'WHM' },
    ],
  },
  damageEvents: [
    { id: 'd1', name: 'AOE', time: 10, damage: 1000, type: 'aoe', damageType: 'magical' },
  ],
  castEvents: [{ id: 'c1', actionId: 100, timestamp: 5, playerId: 1 }],
  annotations: [{ id: 'a1', text: '注释', time: 8, anchor: { type: 'damageTrack' } }],
  createdAt: 1000,
}

describe('buildYDoc', () => {
  it('把内容写进 Y.Doc 的对应 Map', () => {
    const doc = buildYDoc(sample)
    expect(doc.getMap(Y_MAP.meta).get('name')).toBe('测试')
    const de = doc.getMap(Y_MAP.damageEvents)
    expect(de.size).toBe(1)
    expect((de.get('d1') as Y.Map<unknown>).get('damage')).toBe(1000)
    expect(doc.getMap(Y_MAP.castEvents).size).toBe(1)
    expect(doc.getMap(Y_MAP.annotations).size).toBe(1)
    expect((doc.getMap(Y_MAP.composition).get('1') as Y.Map<unknown>).get('job')).toBe('PLD')
  })
})

describe('projectTimeline', () => {
  it('round-trip:buildYDoc 后投影回等价内容', () => {
    const doc = buildYDoc(sample)
    const out = projectTimeline(doc)
    expect(out.name).toBe('测试')
    expect(out.damageEvents).toHaveLength(1)
    expect(out.damageEvents[0]).toEqual(sample.damageEvents[0])
    expect(out.castEvents[0]).toEqual(sample.castEvents[0])
    expect(out.composition.players).toEqual(sample.composition.players)
  })

  it('damageEvents / castEvents 按 time 字段升序', () => {
    const doc = buildYDoc({
      ...sample,
      damageEvents: [
        { id: 'd2', name: 'B', time: 30, damage: 1, type: 'aoe', damageType: 'magical' },
        { id: 'd1', name: 'A', time: 10, damage: 1, type: 'aoe', damageType: 'magical' },
      ],
    })
    const out = projectTimeline(doc)
    expect(out.damageEvents.map(e => e.id)).toEqual(['d1', 'd2'])
  })

  it('sanitizer:丢弃 playerId 不在 composition 内的孤儿 castEvent', () => {
    const doc = buildYDoc(sample)
    const orphan = new Y.Map<unknown>()
    orphan.set('id', 'c-orphan')
    orphan.set('actionId', 1)
    orphan.set('timestamp', 1)
    orphan.set('playerId', 9)
    doc.getMap<Y.Map<unknown>>(Y_MAP.castEvents).set('c-orphan', orphan)
    const out = projectTimeline(doc)
    expect(out.castEvents.find(c => c.id === 'c-orphan')).toBeUndefined()
    expect(out.castEvents).toHaveLength(1)
  })

  it('sanitizer:丢弃玩家已不在的 skillTrack 注释', () => {
    const doc = buildYDoc(sample)
    const orphan = new Y.Map<unknown>()
    orphan.set('id', 'a-orphan')
    orphan.set('text', 'x')
    orphan.set('time', 1)
    orphan.set('anchor', { type: 'skillTrack', playerId: 9, actionId: 1 })
    doc.getMap<Y.Map<unknown>>(Y_MAP.annotations).set('a-orphan', orphan)
    const out = projectTimeline(doc)
    expect(out.annotations.find(a => a.id === 'a-orphan')).toBeUndefined()
  })
})

describe('granular mutators', () => {
  it('yAddDamageEvent 往集合加一条', () => {
    const doc = buildYDoc(sample)
    yAddDamageEvent(doc, {
      id: 'd9',
      name: 'N',
      time: 50,
      damage: 5,
      type: 'aoe',
      damageType: 'magical',
    })
    expect(projectTimeline(doc).damageEvents.map(e => e.id)).toContain('d9')
  })

  it('yUpdateDamageEvent 只改给定字段、保留其余', () => {
    const doc = buildYDoc(sample)
    yUpdateDamageEvent(doc, 'd1', { time: 99 })
    const d1 = projectTimeline(doc).damageEvents.find(e => e.id === 'd1')!
    expect(d1.time).toBe(99)
    expect(d1.damage).toBe(1000) // 未动
  })

  it('yRemoveDamageEvent 删除一条', () => {
    const doc = buildYDoc(sample)
    yRemoveDamageEvent(doc, 'd1')
    expect(projectTimeline(doc).damageEvents).toHaveLength(0)
  })

  it('yUpdateDamageEvent tempMitigations round-trip:数组原样写入并投影回来', () => {
    const doc = buildYDoc(sample)
    const tempMitigations = [{ id: 'tm1', name: '临时盾', type: 'shield' as const, value: 30000 }]
    yUpdateDamageEvent(doc, 'd1', { tempMitigations })
    const d1 = projectTimeline(doc).damageEvents.find(e => e.id === 'd1')!
    expect(d1.tempMitigations).toEqual([
      { id: 'tm1', name: '临时盾', type: 'shield', value: 30000 },
    ])
  })

  it('yUpdateDamageEvent 写 undefined 清除字段（DoT / 目标减开关能关闭并重开）', () => {
    const doc = buildYDoc(sample)
    yUpdateDamageEvent(doc, 'd1', { targetMitigationDisabled: true, snapshotTime: 5 })
    const before = projectTimeline(doc).damageEvents.find(e => e.id === 'd1')!
    expect(before.targetMitigationDisabled).toBe(true)
    expect(before.snapshotTime).toBe(5)
    // 写 undefined 必须删除字段——否则旧值残留，开关切不回去
    yUpdateDamageEvent(doc, 'd1', { targetMitigationDisabled: undefined, snapshotTime: undefined })
    const after = projectTimeline(doc).damageEvents.find(e => e.id === 'd1')!
    expect(after.targetMitigationDisabled).toBeUndefined()
    expect(after.snapshotTime).toBeUndefined()
  })
})

describe('projectTimeline 引用保持', () => {
  it('未变动的 damageEvent 在两次投影间保持同一对象引用', () => {
    const doc = buildYDoc({
      ...sample,
      damageEvents: [
        { id: 'd1', name: 'A', time: 10, damage: 1, type: 'aoe', damageType: 'magical' },
        { id: 'd2', name: 'B', time: 20, damage: 2, type: 'aoe', damageType: 'magical' },
      ],
    })
    const first = projectTimeline(doc)
    // 只改 d2
    ;(doc.getMap<Y.Map<unknown>>(Y_MAP.damageEvents).get('d2') as Y.Map<unknown>).set('damage', 999)
    const second = projectTimeline(doc, first)
    const d1a = first.damageEvents.find(e => e.id === 'd1')
    const d1b = second.damageEvents.find(e => e.id === 'd1')
    expect(d1b).toBe(d1a) // d1 引用未变
    const d2b = second.damageEvents.find(e => e.id === 'd2')
    expect(d2b).not.toBe(first.damageEvents.find(e => e.id === 'd2')) // d2 是新对象
    expect(d2b?.damage).toBe(999)
  })
})

describe('yExitReplayMode', () => {
  /** 含 isReplayMode:true 和带 playerDamageDetails 的伤害事件的样本 */
  const replaySample: TimelineContent = {
    ...sample,
    isReplayMode: true,
    damageEvents: [
      {
        id: 'dr1',
        name: 'AOE',
        time: 10,
        damage: 2000,
        type: 'aoe',
        damageType: 'magical',
        playerDamageDetails: [{ playerId: 1, damage: 2000 }],
      } as unknown as TimelineContent['damageEvents'][number],
    ],
  }

  it('将 meta.isReplayMode 置 false 并剥离 playerDamageDetails', () => {
    const doc = buildYDoc(replaySample)
    // 前置断言:进入状态正确
    expect(projectTimeline(doc).isReplayMode).toBe(true)
    expect(
      (doc.getMap<Y.Map<unknown>>(Y_MAP.damageEvents).get('dr1') as Y.Map<unknown>).has(
        'playerDamageDetails'
      )
    ).toBe(true)

    yExitReplayMode(doc)

    const out = projectTimeline(doc)
    expect(out.isReplayMode).toBeFalsy()
    expect(
      (doc.getMap<Y.Map<unknown>>(Y_MAP.damageEvents).get('dr1') as Y.Map<unknown>).has(
        'playerDamageDetails'
      )
    ).toBe(false)
  })

  it('操作不可撤销:UndoManager(只跟踪 LOCAL_ORIGIN)undo 后 isReplayMode 仍为 false', () => {
    const doc = buildYDoc(replaySample)
    const undoManager = new Y.UndoManager(
      [doc.getMap(Y_MAP.meta), doc.getMap(Y_MAP.damageEvents)],
      { trackedOrigins: new Set([LOCAL_ORIGIN]) }
    )

    yExitReplayMode(doc)
    expect(projectTimeline(doc).isReplayMode).toBeFalsy()

    undoManager.undo()
    // EXIT_REPLAY_ORIGIN 不被跟踪,undo 不应回退此变更
    expect(projectTimeline(doc).isReplayMode).toBeFalsy()
  })
})
