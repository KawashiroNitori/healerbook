import { describe, it, expect } from 'vitest'
import { mergeAndSortRows } from './tableRows'
import type { DamageEvent, Annotation, TimelinePhase } from '@/types/timeline'

const phase = (id: string, time: number): TimelinePhase => ({ id, name: id, time })

const dmg = (id: string, time: number): DamageEvent =>
  ({ id, name: `d-${id}`, time, damage: 0, type: 'aoe', damageType: 'magical' }) as DamageEvent

const ann = (id: string, time: number, text = 'note'): Annotation => ({
  id,
  text,
  time,
  anchor: { type: 'damageTrack' },
})

describe('mergeAndSortRows', () => {
  it('只有伤害事件时按 time 升序', () => {
    const rows = mergeAndSortRows([dmg('a', 10), dmg('b', 5), dmg('c', 20)], [])
    expect(rows.map(r => r.kind + ':' + r.id)).toEqual(['damage:b', 'damage:a', 'damage:c'])
  })

  it('只有备注时按 time 升序', () => {
    const rows = mergeAndSortRows([], [ann('x', 10), ann('y', 5)])
    expect(rows.map(r => r.kind + ':' + r.id)).toEqual(['annotation:y', 'annotation:x'])
  })

  it('同时有两类时按 time 归并排序', () => {
    const rows = mergeAndSortRows([dmg('a', 10), dmg('b', 30)], [ann('x', 5), ann('y', 20)])
    expect(rows.map(r => r.kind + ':' + r.id)).toEqual([
      'annotation:x',
      'damage:a',
      'annotation:y',
      'damage:b',
    ])
  })

  it('相同 time 时备注行排在伤害事件之前', () => {
    const rows = mergeAndSortRows([dmg('a', 10)], [ann('x', 10)])
    expect(rows.map(r => r.kind)).toEqual(['annotation', 'damage'])
  })

  it('阶段行插在开始时间 ≥ 其时间的第一条行之前，同一时刻排最前', () => {
    const rows = mergeAndSortRows(
      [dmg('a', 5), dmg('b', 10), dmg('c', 30)],
      [ann('x', 10)],
      [phase('p2', 10), phase('p1', 0)]
    )
    expect(rows.map(r => r.kind + ':' + r.id)).toEqual([
      'phase:p1',
      'damage:a',
      'phase:p2',
      'annotation:x',
      'damage:b',
      'damage:c',
    ])
  })

  it('阶段行带排序后位置的颜色下标', () => {
    const rows = mergeAndSortRows([], [], [phase('p2', 10), phase('p1', 0)])
    expect(rows.map(r => (r.kind === 'phase' ? r.colorIndex : -1))).toEqual([0, 1])
  })

  it('不传阶段时行为不变', () => {
    expect(mergeAndSortRows([dmg('a', 1)], [])).toEqual(mergeAndSortRows([dmg('a', 1)], [], []))
  })

  it('多个相同 time 时所有备注在前、伤害事件在后，组内保持输入顺序', () => {
    const rows = mergeAndSortRows([dmg('a', 10), dmg('b', 10)], [ann('x', 10), ann('y', 10)])
    expect(rows.map(r => r.id)).toEqual(['x', 'y', 'a', 'b'])
  })

  it('空输入返回空数组', () => {
    expect(mergeAndSortRows([], [])).toEqual([])
  })

  it('mergeAndSortRows 收到的备注若含 cast 锚定也会成行（过滤由调用方负责）', () => {
    // 契约说明：mergeAndSortRows 不认识 anchor 类型，cast 过滤在 TimelineTableView 完成
    const rows = mergeAndSortRows(
      [],
      [{ id: 'a1', text: 'x', time: 1, anchor: { type: 'cast', castId: 'c1' } }]
    )
    expect(rows).toHaveLength(1)
  })
})
