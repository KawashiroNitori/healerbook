import { describe, it, expect } from 'vitest'
import { formatSoumaTime } from './soumaExporter'
import type { Timeline, CastEvent } from '@/types/timeline'
import { buildSoumaTimelineText } from './soumaExporter'

function makeTimeline(overrides: Partial<Timeline> = {}): Timeline {
  return {
    id: 't1',
    name: '测试',
    encounter: { id: 101, name: 'M9S', displayName: 'M9S', zone: '', damageEvents: [] },
    composition: { players: [{ id: 1, job: 'WHM' }] },
    damageEvents: [],
    castEvents: [],
    statusEvents: [],
    annotations: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

function makeCast(
  partial: Partial<CastEvent> & Pick<CastEvent, 'actionId' | 'timestamp'>
): CastEvent {
  return {
    id: `c-${partial.actionId}-${partial.timestamp}`,
    actionId: partial.actionId,
    timestamp: partial.timestamp,
    playerId: partial.playerId ?? 1,
    job: partial.job ?? 'WHM',
    ...partial,
  }
}

describe('formatSoumaTime', () => {
  it('zero → "00:00.0"', () => {
    expect(formatSoumaTime(0)).toBe('00:00.0')
  })

  it('positive < 60 → "00:ss.d"', () => {
    expect(formatSoumaTime(12.34)).toBe('00:12.3')
  })

  it('positive ≥ 60 → "mm:ss.d"', () => {
    expect(formatSoumaTime(125.45)).toBe('02:05.5')
  })

  it('positive carry: 59.95 → "01:00.0"', () => {
    expect(formatSoumaTime(59.95)).toBe('01:00.0')
  })

  it('exact minute: 60.0 → "01:00.0"', () => {
    expect(formatSoumaTime(60)).toBe('01:00.0')
  })

  it('negative integer → "-20.0"', () => {
    expect(formatSoumaTime(-20)).toBe('-20.0')
  })

  it('negative fractional → "-0.5"', () => {
    expect(formatSoumaTime(-0.5)).toBe('-0.5')
  })
})

describe('buildSoumaTimelineText', () => {
  it('按时间升序输出行，使用 <技能名>~ 格式', () => {
    const timeline = makeTimeline({
      castEvents: [
        makeCast({ actionId: 16536, timestamp: 30 }),
        makeCast({ actionId: 7433, timestamp: 10 }),
      ],
    })
    const text = buildSoumaTimelineText(timeline, 1, [16536, 7433], false)
    const lines = text.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/^00:10\.0 "<.+>~"$/)
    expect(lines[1]).toMatch(/^00:30\.0 "<.+>~"$/)
  })

  it('TTS 开启时追加裸 tts', () => {
    const timeline = makeTimeline({
      castEvents: [makeCast({ actionId: 16536, timestamp: 30 })],
    })
    const text = buildSoumaTimelineText(timeline, 1, [16536], true)
    expect(text).toMatch(/^00:30\.0 "<.+>~" tts$/)
  })

  it('过滤未选中的技能', () => {
    const timeline = makeTimeline({
      castEvents: [
        makeCast({ actionId: 16536, timestamp: 10 }),
        makeCast({ actionId: 7433, timestamp: 20 }),
      ],
    })
    const text = buildSoumaTimelineText(timeline, 1, [16536], false)
    expect(text.split('\n')).toHaveLength(1)
    expect(text).toContain('00:10.0')
  })

  it('过滤其他玩家的技能', () => {
    const timeline = makeTimeline({
      composition: {
        players: [
          { id: 1, job: 'WHM' },
          { id: 2, job: 'SCH' },
        ],
      },
      castEvents: [
        makeCast({ actionId: 16536, timestamp: 10, playerId: 1, job: 'WHM' }),
        makeCast({ actionId: 7433, timestamp: 20, playerId: 2, job: 'SCH' }),
      ],
    })
    const text = buildSoumaTimelineText(timeline, 1, [16536, 7433], false)
    expect(text.split('\n')).toHaveLength(1)
    expect(text).toContain('00:10.0')
  })

  it('未知 actionId 静默跳过', () => {
    const timeline = makeTimeline({
      castEvents: [
        makeCast({ actionId: 16536, timestamp: 10 }),
        makeCast({ actionId: 999999, timestamp: 20 }),
      ],
    })
    const text = buildSoumaTimelineText(timeline, 1, [16536, 999999], false)
    expect(text.split('\n')).toHaveLength(1)
  })

  it('空选返回空字符串', () => {
    const timeline = makeTimeline({
      castEvents: [makeCast({ actionId: 16536, timestamp: 10 })],
    })
    expect(buildSoumaTimelineText(timeline, 1, [], false)).toBe('')
  })
})

import { wrapAsSoumaITimeline } from './soumaExporter'

describe('wrapAsSoumaITimeline', () => {
  it('name 拼接职业 code', () => {
    const timeline = makeTimeline({ name: 'M9S 规划' })
    const wrapped = wrapAsSoumaITimeline(timeline, 1, 'text')
    expect(wrapped.name).toBe('M9S 规划 - WHM')
  })

  it('condition.jobs 填入玩家职业', () => {
    const timeline = makeTimeline({
      composition: { players: [{ id: 1, job: 'SCH' }] },
    })
    const wrapped = wrapAsSoumaITimeline(timeline, 1, 'text')
    expect(wrapped.condition.jobs).toEqual(['SCH'])
  })

  it('timeline.gameZoneId 存在时优先使用', () => {
    const timeline = makeTimeline({ gameZoneId: 9999 })
    const wrapped = wrapAsSoumaITimeline(timeline, 1, 'text')
    expect(wrapped.condition.zoneId).toBe('9999')
  })

  it('timeline.gameZoneId 缺失、encounter.id 命中静态表时回退静态表', () => {
    const timeline = makeTimeline({
      gameZoneId: undefined,
      encounter: { id: 101, name: '', displayName: '', zone: '', damageEvents: [] },
    })
    const wrapped = wrapAsSoumaITimeline(timeline, 1, 'text')
    expect(wrapped.condition.zoneId).toBe('1321')
  })

  it('两者均缺失时回退 "0"', () => {
    const timeline = makeTimeline({
      gameZoneId: undefined,
      encounter: { id: 999999, name: '', displayName: '', zone: '', damageEvents: [] },
    })
    const wrapped = wrapAsSoumaITimeline(timeline, 1, 'text')
    expect(wrapped.condition.zoneId).toBe('0')
  })

  it('codeFight / create 固定字段', () => {
    const timeline = makeTimeline()
    const wrapped = wrapAsSoumaITimeline(timeline, 1, 'text')
    expect(wrapped.codeFight).toBe('Healerbook 导出')
    expect(typeof wrapped.create).toBe('string')
    expect(wrapped.create.length).toBeGreaterThan(0)
  })

  it('timeline 内容原样透传', () => {
    const wrapped = wrapAsSoumaITimeline(makeTimeline(), 1, 'abc\ndef')
    expect(wrapped.timeline).toBe('abc\ndef')
  })
})

import LZString from 'lz-string'
import { exportSoumaTimeline } from './soumaExporter'

describe('exportSoumaTimeline', () => {
  it('roundtrip: 解压后是 ITimeline 数组且字段正确', () => {
    const timeline = makeTimeline({
      name: '测试',
      gameZoneId: 1321,
      castEvents: [makeCast({ actionId: 16536, timestamp: 30 })],
    })
    const compressed = exportSoumaTimeline({
      timeline,
      playerId: 1,
      selectedActionIds: [16536],
      ttsEnabled: true,
    })
    const decompressed = LZString.decompressFromBase64(compressed)
    expect(decompressed).not.toBeNull()
    const parsed = JSON.parse(decompressed!)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].name).toBe('测试 - WHM')
    expect(parsed[0].condition.zoneId).toBe('1321')
    expect(parsed[0].condition.jobs).toEqual(['WHM'])
    expect(parsed[0].timeline).toMatch(/^00:30\.0 "<.+>~" tts$/)
    expect(parsed[0].codeFight).toBe('Healerbook 导出')
  })

  it('空选时 timeline 字段为空字符串', () => {
    const timeline = makeTimeline({ gameZoneId: 1321 })
    const compressed = exportSoumaTimeline({
      timeline,
      playerId: 1,
      selectedActionIds: [],
      ttsEnabled: false,
    })
    const parsed = JSON.parse(LZString.decompressFromBase64(compressed)!)
    expect(parsed[0].timeline).toBe('')
  })
})
