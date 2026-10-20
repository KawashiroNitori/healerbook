import { describe, it, expect } from 'vitest'
import type { RawPhase, TimelinePhase } from '@/types/timeline'
import {
  PHASE_COLORS,
  clampPhaseTime,
  currentPhaseIndex,
  defaultPhaseName,
  normalizeRawPhases,
  phaseColor,
  rangesOverlap,
  shortPhaseLabel,
  sortPhases,
} from './timelinePhases'

const p = (id: string, time: number, name = id): TimelinePhase => ({ id, name, time })
const raw = (fflogsPhaseId: number, time: number): RawPhase => ({
  fflogsPhaseId,
  name: `P${fflogsPhaseId}`,
  time,
})

describe('sortPhases', () => {
  it('按 time 升序，同 time 按 id 排序，不修改入参', () => {
    const input = [p('c', 100), p('b', 0), p('a', 100)]
    const sorted = sortPhases(input)
    expect(sorted.map(x => x.id)).toEqual(['b', 'a', 'c'])
    expect(input.map(x => x.id)).toEqual(['c', 'b', 'a'])
  })
})

describe('phaseColor', () => {
  it('7 色循环，第 8 个回到灰', () => {
    expect([...PHASE_COLORS]).toEqual([
      '#6b7280',
      '#22c55e',
      '#3b82f6',
      '#a855f7',
      '#f97316',
      '#ec4899',
      '#ca8a04',
    ])
    expect(phaseColor(0)).toBe('#6b7280')
    expect(phaseColor(6)).toBe('#ca8a04')
    expect(phaseColor(7)).toBe('#6b7280')
  })
})

describe('shortPhaseLabel', () => {
  it('有冒号取冒号前部分', () => {
    expect(shortPhaseLabel('P3: Exdeath and Chaos')).toBe('P3')
    expect(shortPhaseLabel('P3：全角冒号')).toBe('P3')
  })

  it('无冒号取前 6 个字符，超出加省略号', () => {
    expect(shortPhaseLabel('Garuda')).toBe('Garuda')
    expect(shortPhaseLabel('Intermission')).toBe('Interm…')
  })

  it('冒号在首位按无冒号处理', () => {
    expect(shortPhaseLabel(': abc')).toBe(': abc')
    expect(shortPhaseLabel(':abcdefgh')).toBe(':abcde…')
  })

  it('按字符而非 UTF-16 单元截断', () => {
    expect(shortPhaseLabel('😀😀😀😀😀😀😀')).toBe('😀😀😀😀😀😀…')
  })
})

describe('currentPhaseIndex', () => {
  const sorted = [p('a', 0), p('b', 100), p('c', 200)]

  it('无阶段或早于第一阶段返回 -1', () => {
    expect(currentPhaseIndex([], 50)).toBe(-1)
    expect(currentPhaseIndex(sorted, -1)).toBe(-1)
  })

  it('恰等于开始时间属于该阶段', () => {
    expect(currentPhaseIndex(sorted, 100)).toBe(1)
  })

  it('两阶段之间属于前一个', () => {
    expect(currentPhaseIndex(sorted, 150)).toBe(1)
    expect(currentPhaseIndex(sorted, 999)).toBe(2)
  })
})

describe('clampPhaseTime', () => {
  const sorted = [p('a', 0), p('b', 100), p('c', 200)]

  it('移动已有阶段：不越过相邻阶段且至少相隔 1 秒', () => {
    expect(clampPhaseTime(sorted, 'b', 150)).toEqual({ time: 150, clamped: false })
    expect(clampPhaseTime(sorted, 'b', 0.5)).toEqual({ time: 1, clamped: true })
    expect(clampPhaseTime(sorted, 'b', 250)).toEqual({ time: 199, clamped: true })
  })

  it('第一阶段下限为时间轴起点，最后阶段无上限', () => {
    expect(clampPhaseTime(sorted, 'a', -100)).toEqual({ time: -30, clamped: true })
    expect(clampPhaseTime(sorted, 'c', 9999)).toEqual({ time: 9999, clamped: false })
  })

  it('结果四舍五入到 0.1 秒', () => {
    expect(clampPhaseTime(sorted, 'b', 123.456)).toEqual({ time: 123.5, clamped: false })
  })

  it('新增：落在某阶段之后 1 秒内（含相等）钳到该阶段 +1', () => {
    expect(clampPhaseTime(sorted, null, 100)).toEqual({ time: 101, clamped: true })
    expect(clampPhaseTime(sorted, null, 100.5)).toEqual({ time: 101, clamped: true })
  })

  it('新增：落在某阶段之前 1 秒内钳到该阶段 -1', () => {
    expect(clampPhaseTime(sorted, null, 99.5)).toEqual({ time: 99, clamped: true })
  })

  it('无合法位置返回 null', () => {
    const tight = [p('a', 0), p('b', 1), p('c', 1.8)]
    expect(clampPhaseTime(tight, 'b', 1)).toBeNull()
    expect(clampPhaseTime([p('a', 0), p('b', 1.5)], null, 0.8)).toBeNull()
  })
})

describe('defaultPhaseName', () => {
  it('按插入后的序号命名', () => {
    const sorted = [p('a', 0, 'P1'), p('b', 100, 'P2')]
    expect(defaultPhaseName(sorted, 50)).toBe('P2')
    expect(defaultPhaseName(sorted, 200)).toBe('P3')
    expect(defaultPhaseName([], 10)).toBe('P1')
  })
})

describe('normalizeRawPhases', () => {
  it('按时间排序', () => {
    expect(normalizeRawPhases([raw(2, 100), raw(1, 0)]).map(x => x.fflogsPhaseId)).toEqual([1, 2])
  })

  it('同一时刻（差 < 1 秒）只保留后一个', () => {
    expect(normalizeRawPhases([raw(1, 0), raw(2, 0), raw(3, 200)])).toEqual([
      raw(2, 0),
      raw(3, 200),
    ])
    expect(normalizeRawPhases([raw(1, 10), raw(2, 10.9)]).map(x => x.fflogsPhaseId)).toEqual([2])
  })

  it('早于时间轴起点的钳到起点（先钳制后去重）', () => {
    expect(normalizeRawPhases([raw(1, -100), raw(2, -40)])).toEqual([raw(2, -30)])
    expect(normalizeRawPhases([raw(1, -100), raw(2, 50)])).toEqual([raw(1, -30), raw(2, 50)])
  })

  it('空数组', () => {
    expect(normalizeRawPhases([])).toEqual([])
  })
})

describe('rangesOverlap', () => {
  it('端点相接不算重叠', () => {
    expect(rangesOverlap([0, 10], [10, 20])).toBe(false)
    expect(rangesOverlap([0, 10], [9, 20])).toBe(true)
    expect(rangesOverlap([5, 6], [0, 20])).toBe(true)
  })
})
