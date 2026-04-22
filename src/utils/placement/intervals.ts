import type { Interval } from './types'

export function sortIntervals(intervals: Interval[]): Interval[] {
  return [...intervals].sort((a, b) => a.from - b.from)
}

/** 合并重叠或相邻（含 to === from）的区间。输入无需预排序。 */
export function mergeOverlapping(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return []
  const sorted = sortIntervals(intervals)
  const out: Interval[] = [{ ...sorted[0] }]
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1]
    const cur = sorted[i]
    if (cur.from <= last.to) {
      last.to = Math.max(last.to, cur.to)
    } else {
      out.push({ ...cur })
    }
  }
  return out
}

/** [0, +∞) - union(intervals)。输入已排序/未合并都可。 */
export function complement(intervals: Interval[]): Interval[] {
  const INF = Number.POSITIVE_INFINITY
  const merged = mergeOverlapping(intervals)
  if (merged.length === 0) return [{ from: 0, to: INF }]
  const out: Interval[] = []
  if (merged[0].from > 0) out.push({ from: 0, to: merged[0].from })
  for (let i = 0; i < merged.length - 1; i++) {
    out.push({ from: merged[i].to, to: merged[i + 1].from })
  }
  const last = merged[merged.length - 1]
  if (last.to < INF) out.push({ from: last.to, to: INF })
  return out
}

/** 两个有序无重叠列表求交。O(n+m)。 */
export function intersect(a: Interval[], b: Interval[]): Interval[] {
  const aa = mergeOverlapping(a)
  const bb = mergeOverlapping(b)
  const out: Interval[] = []
  let i = 0
  let j = 0
  while (i < aa.length && j < bb.length) {
    const from = Math.max(aa[i].from, bb[j].from)
    const to = Math.min(aa[i].to, bb[j].to)
    if (from < to) out.push({ from, to })
    if (aa[i].to < bb[j].to) i++
    else j++
  }
  return out
}

export function subtractIntervals(a: Interval[], b: Interval[]): Interval[] {
  return intersect(a, complement(b))
}
