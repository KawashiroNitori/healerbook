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
