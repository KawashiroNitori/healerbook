import { describe, it, expect } from 'vitest'
import {
  sortIntervals,
  mergeOverlapping,
  complement,
  intersect,
  subtractIntervals,
} from './intervals'

describe('intervals', () => {
  it('sortIntervals: 按 from 升序', () => {
    expect(
      sortIntervals([
        { from: 5, to: 10 },
        { from: 0, to: 3 },
      ])
    ).toEqual([
      { from: 0, to: 3 },
      { from: 5, to: 10 },
    ])
  })

  it('mergeOverlapping: 合并相邻/重叠', () => {
    expect(
      mergeOverlapping([
        { from: 0, to: 5 },
        { from: 3, to: 7 },
        { from: 7, to: 10 },
        { from: 20, to: 25 },
      ])
    ).toEqual([
      { from: 0, to: 10 },
      { from: 20, to: 25 },
    ])
  })

  it('complement: (-∞, +∞) 减去并集（支持负时间，覆盖 prepull 区段）', () => {
    const INF = Number.POSITIVE_INFINITY
    const NEG_INF = Number.NEGATIVE_INFINITY
    expect(
      complement([
        { from: 0, to: 5 },
        { from: 10, to: 15 },
      ])
    ).toEqual([
      { from: NEG_INF, to: 0 },
      { from: 5, to: 10 },
      { from: 15, to: INF },
    ])
    expect(complement([])).toEqual([{ from: NEG_INF, to: INF }])
  })

  it('intersect: 求交', () => {
    expect(
      intersect(
        [
          { from: 0, to: 10 },
          { from: 20, to: 30 },
        ],
        [{ from: 5, to: 25 }]
      )
    ).toEqual([
      { from: 5, to: 10 },
      { from: 20, to: 25 },
    ])
    expect(intersect([{ from: 0, to: 10 }], [])).toEqual([])
  })

  it('subtractIntervals: A - B 等价于 intersect(A, complement(B))', () => {
    expect(subtractIntervals([{ from: 0, to: 10 }], [{ from: 3, to: 7 }])).toEqual([
      { from: 0, to: 3 },
      { from: 7, to: 10 },
    ])
  })
})
