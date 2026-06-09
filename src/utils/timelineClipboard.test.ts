import { describe, it, expect } from 'vitest'
import {
  CLIPBOARD_MIME,
  buildClipboardPayload,
  parseClipboardPayload,
  remapClipboardForPaste,
} from './timelineClipboard'
import type { Timeline, Composition } from '@/types/timeline'

const timeline = {
  id: 't1',
  name: 'TL',
  encounter: { id: 1, name: 'E', displayName: 'E', zone: 'Z', damageEvents: [] },
  composition: {
    players: [
      { id: 1, job: 'PLD' },
      { id: 2, job: 'WHM' },
    ],
  },
  damageEvents: [
    { id: 'd1', name: 'AA', time: 10, damage: 1, type: 'aoe', damageType: 'magical' },
    { id: 'd2', name: 'BB', time: 20, damage: 2, type: 'aoe', damageType: 'magical' },
  ],
  castEvents: [{ id: 'c1', actionId: 16536, timestamp: 12, playerId: 2 }],
  annotations: [{ id: 'a1', text: 'n', time: 14, anchor: { type: 'damageTrack' } }],
  statusEvents: [],
  createdAt: 1,
  updatedAt: 1,
} as unknown as Timeline

describe('timelineClipboard 构造/解析', () => {
  it('buildClipboardPayload 仅含选中子集', () => {
    const p = buildClipboardPayload(timeline, {
      eventIds: ['d1'],
      castEventIds: ['c1'],
      annotationIds: ['a1'],
    })
    expect(p.__healerbook__).toBe('timeline-clipboard')
    expect(p.version).toBe(1)
    expect(p.v2.de).toHaveLength(1) // 只有 d1
  })

  it('CLIPBOARD_MIME 是 web 自定义格式', () => {
    expect(CLIPBOARD_MIME.startsWith('web ')).toBe(true)
  })

  it('parseClipboardPayload 校验标识', () => {
    const p = buildClipboardPayload(timeline, {
      eventIds: ['d1'],
      castEventIds: [],
      annotationIds: [],
    })
    expect(parseClipboardPayload(JSON.stringify(p))).not.toBeNull()
    expect(parseClipboardPayload('hello world')).toBeNull()
    expect(parseClipboardPayload(JSON.stringify({ foo: 1 }))).toBeNull()
  })
})

describe('remapClipboardForPaste', () => {
  const validActionIds = new Set<number>([16536])

  it('职业相同：cast 落回对应职业玩家，时间按最早对象对齐 targetTime', () => {
    const p = buildClipboardPayload(timeline, {
      eventIds: ['d1', 'd2'],
      castEventIds: ['c1'],
      annotationIds: ['a1'],
    })
    const cur: Composition = {
      players: [
        { id: 7, job: 'PLD' },
        { id: 9, job: 'WHM' },
      ],
    }
    const out = remapClipboardForPaste(p, {
      currentComposition: cur,
      targetTime: 100,
      validActionIds,
    })
    // 最早对象 d1.time=10 → baseTime=10；targetTime=100 → 偏移 +90
    expect(out.damageEvents.map(e => e.time).sort((a, b) => a - b)).toEqual([100, 110])
    // cast 原 playerId=WHM 槽 → 落到当前 WHM=9
    expect(out.castEvents[0].playerId).toBe(9)
    expect(out.castEvents[0].timestamp).toBe(102)
    expect(out.skipped).toBe(0)
  })

  it('absolute=true（全选来源）：保留原始绝对时间，忽略 targetTime', () => {
    const p = buildClipboardPayload(
      timeline,
      { eventIds: ['d1', 'd2'], castEventIds: ['c1'], annotationIds: ['a1'] },
      true
    )
    expect(p.absolute).toBe(true)
    const cur: Composition = {
      players: [
        { id: 7, job: 'PLD' },
        { id: 9, job: 'WHM' },
      ],
    }
    const out = remapClipboardForPaste(p, {
      currentComposition: cur,
      targetTime: 100, // 应被忽略
      validActionIds,
    })
    // 原始绝对时间保留：d1=10, d2=20, cast=12
    expect(out.damageEvents.map(e => e.time).sort((a, b) => a - b)).toEqual([10, 20])
    expect(out.castEvents[0].timestamp).toBe(12)
  })

  it('目标缺职业：该 cast 跳过并计数；伤害事件仍保留', () => {
    const p = buildClipboardPayload(timeline, {
      eventIds: ['d1'],
      castEventIds: ['c1'],
      annotationIds: [],
    })
    const cur: Composition = { players: [{ id: 7, job: 'PLD' }] } // 无 WHM
    const out = remapClipboardForPaste(p, {
      currentComposition: cur,
      targetTime: 0,
      validActionIds,
    })
    expect(out.castEvents).toHaveLength(0)
    expect(out.skipped).toBe(1)
    expect(out.damageEvents).toHaveLength(1)
  })

  it('actionId 不在注册表：跳过', () => {
    const p = buildClipboardPayload(timeline, {
      eventIds: [],
      castEventIds: ['c1'],
      annotationIds: [],
    })
    const cur: Composition = {
      players: [
        { id: 7, job: 'PLD' },
        { id: 9, job: 'WHM' },
      ],
    }
    const out = remapClipboardForPaste(p, {
      currentComposition: cur,
      targetTime: 0,
      validActionIds: new Set(),
    })
    expect(out.castEvents).toHaveLength(0)
    expect(out.skipped).toBe(1)
  })
})
