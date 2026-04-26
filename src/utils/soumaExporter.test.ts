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

  it('勾父 ID 时同 trackGroup 的变体 cast 一并导出（用变体自己的名字）', () => {
    // 37013 意气轩昂之策（父）/ 37016 降临之章（变体，trackGroup: 37013）
    const timeline = makeTimeline({
      composition: { players: [{ id: 1, job: 'SCH' }] },
      castEvents: [
        makeCast({ actionId: 37013, timestamp: 10, playerId: 1, job: 'SCH' }),
        makeCast({ actionId: 37016, timestamp: 20, playerId: 1, job: 'SCH' }),
      ],
    })
    const text = buildSoumaTimelineText(timeline, 1, [37013], false)
    const lines = text.split('\n')
    expect(lines).toEqual(['00:10.0 "<意气轩昂之策>~"', '00:20.0 "<降临之章>~"'])
  })

  it('未勾父时变体 cast 不导出', () => {
    const timeline = makeTimeline({
      composition: { players: [{ id: 1, job: 'SCH' }] },
      castEvents: [makeCast({ actionId: 37016, timestamp: 20, playerId: 1, job: 'SCH' })],
    })
    // 勾的是其他无关技能，不勾 37013
    const text = buildSoumaTimelineText(timeline, 1, [16536], false)
    expect(text).toBe('')
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

  it('注释输出为 # 前缀行带时间标签，按时间合并到技能之间', () => {
    const timeline = makeTimeline({
      castEvents: [
        makeCast({ actionId: 16536, timestamp: 10 }),
        makeCast({ actionId: 7433, timestamp: 30 }),
      ],
      annotations: [
        { id: 'a1', text: '开场减伤', time: 10, anchor: { type: 'damageTrack' } },
        { id: 'a2', text: '接 2 连爆', time: 20, anchor: { type: 'damageTrack' } },
      ],
    })
    const lines = buildSoumaTimelineText(timeline, 1, [16536, 7433], false).split('\n')
    expect(lines).toEqual([
      '# 00:10.0 开场减伤',
      '00:10.0 "<节制>~"',
      '# 00:20.0 接 2 连爆',
      '00:30.0 "<全大赦>~"',
    ])
  })

  it('同一时间点注释排在技能之前', () => {
    const timeline = makeTimeline({
      castEvents: [makeCast({ actionId: 16536, timestamp: 20 })],
      annotations: [{ id: 'a1', text: '提示', time: 20, anchor: { type: 'damageTrack' } }],
    })
    const lines = buildSoumaTimelineText(timeline, 1, [16536], false).split('\n')
    expect(lines[0]).toBe('# 00:20.0 提示')
    expect(lines[1]).toMatch(/^00:20\.0 "<.+>~"$/)
  })

  it('多行注释每行独立前缀 # 且都带时间标签', () => {
    const timeline = makeTimeline({
      annotations: [
        { id: 'a1', text: '第一行\n第二行\n第三行', time: 5, anchor: { type: 'damageTrack' } },
      ],
    })
    const lines = buildSoumaTimelineText(timeline, 1, [], false).split('\n')
    expect(lines).toEqual(['# 00:05.0 第一行', '# 00:05.0 第二行', '# 00:05.0 第三行'])
  })

  it('没有技能但有注释时仍输出注释', () => {
    const timeline = makeTimeline({
      annotations: [{ id: 'a1', text: '单独注释', time: 0, anchor: { type: 'damageTrack' } }],
    })
    expect(buildSoumaTimelineText(timeline, 1, [], false)).toBe('# 00:00.0 单独注释')
  })

  it('skillTrack anchor 的注释前缀加上技能 icon 语法', () => {
    const timeline = makeTimeline({
      annotations: [
        {
          id: 'a1',
          text: '绑定技能注释',
          time: 5,
          anchor: { type: 'skillTrack', playerId: 1, actionId: 16536 },
        },
      ],
    })
    expect(buildSoumaTimelineText(timeline, 1, [], false)).toBe('# 00:05.0 <节制>绑定技能注释')
  })

  it('skillTrack 多行注释每行都带 icon 前缀', () => {
    const timeline = makeTimeline({
      annotations: [
        {
          id: 'a1',
          text: '第一行\n第二行',
          time: 5,
          anchor: { type: 'skillTrack', playerId: 1, actionId: 16536 },
        },
      ],
    })
    const lines = buildSoumaTimelineText(timeline, 1, [], false).split('\n')
    expect(lines).toEqual(['# 00:05.0 <节制>第一行', '# 00:05.0 <节制>第二行'])
  })

  it('syncEvents 输出 cactbot 风格 sync 行', () => {
    const timeline = makeTimeline({
      syncEvents: [
        {
          time: 24.3,
          type: 'begincast',
          actionId: 0xa3da,
          actionName: '空间斩',
          window: [10, 10],
          syncOnce: false,
        },
      ],
    })
    const text = buildSoumaTimelineText(timeline, 1, [], false)
    expect(text).toBe('00:24.3 "空间斩" StartsUsing { id: "A3DA" } window 10,10')
  })

  it('cast 类型 sync 行使用 Ability', () => {
    const timeline = makeTimeline({
      syncEvents: [
        {
          time: 10,
          type: 'cast',
          actionId: 0xa770,
          actionName: '在这停顿！',
          window: [30, 30],
          syncOnce: false,
        },
      ],
    })
    const text = buildSoumaTimelineText(timeline, 1, [], false)
    expect(text).toBe('00:10.0 "在这停顿！" Ability { id: "A770" } window 30,30')
  })

  it('syncOnce=true 追加 once 关键字', () => {
    const timeline = makeTimeline({
      syncEvents: [
        {
          time: 45,
          type: 'begincast',
          actionId: 0xa3f1,
          actionName: '空间灭斩',
          window: [20, 20],
          syncOnce: true,
        },
      ],
    })
    const text = buildSoumaTimelineText(timeline, 1, [], false)
    expect(text).toBe('00:45.0 "空间灭斩" StartsUsing { id: "A3F1" } window 20,20 once')
  })

  it('sync 行与技能行按时间穿插排序', () => {
    const timeline = makeTimeline({
      castEvents: [
        makeCast({ actionId: 16536, timestamp: 15 }),
        makeCast({ actionId: 7433, timestamp: 35 }),
      ],
      syncEvents: [
        {
          time: 10,
          type: 'begincast',
          actionId: 0xa3da,
          actionName: '空间斩',
          window: [10, 10],
          syncOnce: false,
        },
        {
          time: 25,
          type: 'cast',
          actionId: 0xa770,
          actionName: '在这停顿',
          window: [30, 30],
          syncOnce: false,
        },
      ],
    })
    const lines = buildSoumaTimelineText(timeline, 1, [16536, 7433], false).split('\n')
    expect(lines).toHaveLength(4)
    expect(lines[0]).toContain('00:10.0') // sync
    expect(lines[0]).toContain('StartsUsing')
    expect(lines[1]).toMatch(/^00:15\.0 "<.+>~"$/) // 技能
    expect(lines[2]).toContain('00:25.0') // sync
    expect(lines[2]).toContain('Ability')
    expect(lines[3]).toMatch(/^00:35\.0 "<.+>~"$/) // 技能
  })

  it('同秒撞车时 sync 排在注释和技能之后', () => {
    const timeline = makeTimeline({
      castEvents: [makeCast({ actionId: 16536, timestamp: 20 })],
      annotations: [{ id: 'a1', text: '提示', time: 20, anchor: { type: 'damageTrack' } }],
      syncEvents: [
        {
          time: 20,
          type: 'begincast',
          actionId: 0xa3da,
          actionName: '空间斩',
          window: [10, 10],
          syncOnce: false,
        },
      ],
    })
    const lines = buildSoumaTimelineText(timeline, 1, [16536], false).split('\n')
    expect(lines[0]).toBe('# 00:20.0 提示')
    expect(lines[1]).toMatch(/^00:20\.0 "<.+>~"$/)
    expect(lines[2]).toContain('StartsUsing')
  })

  it('syncEvents 为空时不产出任何 sync 行', () => {
    const timeline = makeTimeline({
      castEvents: [makeCast({ actionId: 16536, timestamp: 10 })],
      syncEvents: [],
    })
    const text = buildSoumaTimelineText(timeline, 1, [16536], false)
    expect(text.split('\n')).toHaveLength(1)
    expect(text).not.toContain('StartsUsing')
    expect(text).not.toContain('Ability')
  })

  it('syncEvents 未定义（存量 timeline）时不产出任何 sync 行', () => {
    const timeline = makeTimeline({
      castEvents: [makeCast({ actionId: 16536, timestamp: 10 })],
      // syncEvents 故意不设置
    })
    const text = buildSoumaTimelineText(timeline, 1, [16536], false)
    expect(text.split('\n')).toHaveLength(1)
  })

  it('负时间 sync 行用 formatSoumaTime 的 -X.X 格式', () => {
    const timeline = makeTimeline({
      syncEvents: [
        {
          time: -2.3,
          type: 'begincast',
          actionId: 0xa3da,
          actionName: '空间斩',
          window: [10, 10],
          syncOnce: false,
        },
      ],
    })
    const text = buildSoumaTimelineText(timeline, 1, [], false)
    expect(text).toBe('-2.3 "空间斩" StartsUsing { id: "A3DA" } window 10,10')
  })
})

import { wrapAsSoumaITimeline } from './soumaExporter'

describe('wrapAsSoumaITimeline', () => {
  it('name 拼接职业名称', () => {
    const timeline = makeTimeline({ name: 'M9S 规划' })
    const wrapped = wrapAsSoumaITimeline(timeline, 1, 'text')
    expect(wrapped.name).toBe('M9S 规划 - 白魔法师')
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
    expect(parsed[0].name).toBe('测试 - 白魔法师')
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
