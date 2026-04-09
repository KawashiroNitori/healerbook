import { describe, it, expect } from 'vitest'
import { mergeAndSortRows } from './tableRows'
import type { DamageEvent, Annotation } from '@/types/timeline'

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

  it('只有注释时按 time 升序', () => {
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

  it('相同 time 时注释行排在伤害事件之前', () => {
    const rows = mergeAndSortRows([dmg('a', 10)], [ann('x', 10)])
    expect(rows.map(r => r.kind)).toEqual(['annotation', 'damage'])
  })

  it('多个相同 time 时所有注释在前、伤害事件在后，组内保持输入顺序', () => {
    const rows = mergeAndSortRows([dmg('a', 10), dmg('b', 10)], [ann('x', 10), ann('y', 10)])
    expect(rows.map(r => r.id)).toEqual(['x', 'y', 'a', 'b'])
  })

  it('空输入返回空数组', () => {
    expect(mergeAndSortRows([], [])).toEqual([])
  })
})
