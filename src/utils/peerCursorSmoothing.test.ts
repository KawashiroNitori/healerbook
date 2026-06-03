import { describe, it, expect } from 'vitest'
import { stepValue, advancePeerSmoothing, type SmoothStateMap } from './peerCursorSmoothing'
import type { PeerState } from '@/collab/awarenessTypes'

// 构造 peer 的辅助函数
function makePeer(over: Partial<PeerState> = {}): PeerState {
  return {
    clientId: 1,
    user: { id: 'u1', name: 'Alice', color: '#f00' },
    selection: { eventIds: [], castEventIds: [], annotationIds: [] },
    cursorTime: null,
    dragging: null,
    ...over,
  }
}

describe('stepValue（帧率无关指数逼近）', () => {
  it('单调逼近目标且不超调', () => {
    const tau = 80
    let cur = 0
    const target = 10
    let prev = cur
    for (let i = 0; i < 50; i++) {
      cur = stepValue(cur, target, 16, tau)
      expect(cur).toBeGreaterThanOrEqual(prev) // 单调
      expect(cur).toBeLessThanOrEqual(target) // 不超调
      prev = cur
    }
    expect(cur).toBeCloseTo(target, 1)
  })

  it('帧率无关：一帧 dt=32 与两帧 dt=16 累积结果一致', () => {
    const tau = 80
    const oneStep = stepValue(0, 10, 32, tau)
    const twoStep = stepValue(stepValue(0, 10, 16, tau), 10, 16, tau)
    expect(oneStep).toBeCloseTo(twoStep, 6)
  })
})

describe('advancePeerSmoothing', () => {
  const ZOOM = 50 // px/秒
  const empty: SmoothStateMap = new Map()

  it('cursorTime 从 null→有值：首帧直接吸附到目标', () => {
    const peers = [makePeer({ cursorTime: 4 })]
    const { smoothed } = advancePeerSmoothing(peers, empty, 16, ZOOM)
    expect(smoothed[0].cursorTime).toBe(4)
  })

  it('cursorTime 小幅移动：介于旧值与目标之间', () => {
    const prev: SmoothStateMap = new Map([[1, { cursorTime: 4, dragging: null }]])
    const peers = [makePeer({ cursorTime: 5 })]
    const { smoothed, animating } = advancePeerSmoothing(peers, prev, 16, ZOOM)
    expect(smoothed[0].cursorTime!).toBeGreaterThan(4)
    expect(smoothed[0].cursorTime!).toBeLessThan(5)
    expect(animating).toBe(true)
  })

  it('cursorTime 从有值→null：显示态清除', () => {
    const prev: SmoothStateMap = new Map([[1, { cursorTime: 4, dragging: null }]])
    const peers = [makePeer({ cursorTime: null })]
    const { smoothed } = advancePeerSmoothing(peers, prev, 16, ZOOM)
    expect(smoothed[0].cursorTime).toBeNull()
  })

  it('超大跳变（像素距离超阈值）：直接吸附', () => {
    const prev: SmoothStateMap = new Map([[1, { cursorTime: 0, dragging: null }]])
    // 100 秒 × 50 px = 5000px，远超阈值
    const peers = [makePeer({ cursorTime: 100 })]
    const { smoothed } = advancePeerSmoothing(peers, prev, 16, ZOOM)
    expect(smoothed[0].cursorTime).toBe(100)
  })

  it('收敛：差值小于 epsilon 时吸附到目标且不再 animating', () => {
    // 显示值与目标仅差 0.001 秒 × 50px = 0.05px < epsilon
    const prev: SmoothStateMap = new Map([[1, { cursorTime: 4.999, dragging: null }]])
    const peers = [makePeer({ cursorTime: 5 })]
    const { smoothed, animating } = advancePeerSmoothing(peers, prev, 16, ZOOM)
    expect(smoothed[0].cursorTime).toBe(5)
    expect(animating).toBe(false)
  })

  it('dragging 从 null→有值：吸附到起始位置', () => {
    const peers = [makePeer({ dragging: { id: 'd1', kind: 'damage', time: 8, playerId: null } })]
    const { smoothed } = advancePeerSmoothing(peers, empty, 16, ZOOM)
    expect(smoothed[0].dragging!.time).toBe(8)
  })

  it('dragging.id 切换：吸附到新对象起始位置而非滑入', () => {
    const prev: SmoothStateMap = new Map([
      [1, { cursorTime: null, dragging: { id: 'd1', time: 2 } }],
    ])
    const peers = [makePeer({ dragging: { id: 'd2', kind: 'cast', time: 9, playerId: 3 } })]
    const { smoothed } = advancePeerSmoothing(peers, prev, 16, ZOOM)
    expect(smoothed[0].dragging!.time).toBe(9)
    expect(smoothed[0].dragging!.id).toBe('d2')
    expect(smoothed[0].dragging!.kind).toBe('cast')
    expect(smoothed[0].dragging!.playerId).toBe(3)
  })

  it('dragging 同 id 平移：time 介于旧值与目标之间', () => {
    const prev: SmoothStateMap = new Map([
      [1, { cursorTime: null, dragging: { id: 'd1', time: 2 } }],
    ])
    const peers = [makePeer({ dragging: { id: 'd1', kind: 'damage', time: 3, playerId: null } })]
    const { smoothed, animating } = advancePeerSmoothing(peers, prev, 16, ZOOM)
    expect(smoothed[0].dragging!.time).toBeGreaterThan(2)
    expect(smoothed[0].dragging!.time).toBeLessThan(3)
    expect(animating).toBe(true)
  })

  it('新平滑态只保留当前 peers 的 clientId', () => {
    const prev: SmoothStateMap = new Map([
      [1, { cursorTime: 4, dragging: null }],
      [99, { cursorTime: 7, dragging: null }], // 已离开的 peer
    ])
    const peers = [makePeer({ clientId: 1, cursorTime: 4 })]
    const { state } = advancePeerSmoothing(peers, prev, 16, ZOOM)
    expect(state.has(1)).toBe(true)
    expect(state.has(99)).toBe(false)
  })

  it('其余字段（user / selection / clientId）原样透传', () => {
    const peers = [
      makePeer({
        cursorTime: 4,
        selection: { eventIds: ['e1'], castEventIds: [], annotationIds: [] },
      }),
    ]
    const { smoothed } = advancePeerSmoothing(peers, empty, 16, ZOOM)
    expect(smoothed[0].clientId).toBe(1)
    expect(smoothed[0].user.name).toBe('Alice')
    expect(smoothed[0].selection.eventIds).toEqual(['e1'])
  })

  it('dragging 从有值→null：立即清除，不残留', () => {
    const prev: SmoothStateMap = new Map([
      [1, { cursorTime: null, dragging: { id: 'd1', time: 5 } }],
    ])
    const peers = [makePeer({ dragging: null })]
    const { smoothed, animating } = advancePeerSmoothing(peers, prev, 16, ZOOM)
    expect(smoothed[0].dragging).toBeNull()
    expect(animating).toBe(false)
  })

  it('peers 为空时：smoothed 为空且不再 animating', () => {
    const { smoothed, animating } = advancePeerSmoothing([], empty, 16, ZOOM)
    expect(smoothed).toHaveLength(0)
    expect(animating).toBe(false)
  })
})
