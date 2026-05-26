/**
 * Peer 光标 / 拖动补间的纯逻辑：帧率无关指数逼近 + 吸附 / 收敛判定。
 * 不依赖 React / requestAnimationFrame，便于单测；由 useSmoothedPeers 驱动。
 *
 * 只平滑两个时间标量：peer.cursorTime 与 peer.dragging.time；其余字段原样透传。
 */
import type { PeerState } from '@/collab/awarenessTypes'

/** 时间常数（ms）：越小越跟手，越大越顺滑 */
export const SMOOTH_TAU_MS = 80
/** 收敛阈值（像素）：显示值与目标差小于此值即吸附并判定 settled */
export const SETTLE_EPSILON_PX = 0.5
/** 超大跳变阈值（像素）：超过则直接吸附，避免长时间滑行 */
export const SNAP_THRESHOLD_PX = 400

/** 单个 peer 的平滑显示态（按 clientId 索引）。null 表示当前无该元素。 */
export interface PeerSmoothState {
  cursorTime: number | null
  dragging: { id: string; time: number } | null
}

export type SmoothStateMap = Map<number, PeerSmoothState>

export interface AdvanceConfig {
  tauMs?: number
  settleEpsilonPx?: number
  snapThresholdPx?: number
}

export interface AdvanceResult {
  /** 平滑后的 peers（形状同 PeerState[]，仅时间标量被替换） */
  smoothed: PeerState[]
  /** 新的平滑态，作为下一帧的 prev */
  state: SmoothStateMap
  /** 是否仍有 peer 未收敛（用于决定是否继续 rAF） */
  animating: boolean
}

/** 帧率无关指数逼近：cur 向 target 逼近，dt/tau 单位需一致（此处均为 ms）。 */
export function stepValue(cur: number, target: number, dtMs: number, tauMs: number): number {
  const factor = 1 - Math.exp(-dtMs / tauMs)
  return cur + (target - cur) * factor
}

/**
 * 推进一帧：给定当前 store peers、上一帧平滑态、帧间隔与缩放，
 * 产出平滑后的 peers、新平滑态、是否仍在动。
 */
export function advancePeerSmoothing(
  peers: PeerState[],
  prev: SmoothStateMap,
  dtMs: number,
  zoomLevel: number,
  config: AdvanceConfig = {}
): AdvanceResult {
  const tau = config.tauMs ?? SMOOTH_TAU_MS
  const epsilonPx = config.settleEpsilonPx ?? SETTLE_EPSILON_PX
  const snapPx = config.snapThresholdPx ?? SNAP_THRESHOLD_PX

  const nextState: SmoothStateMap = new Map()
  const smoothed: PeerState[] = []
  let animating = false

  for (const peer of peers) {
    const prevState = prev.get(peer.clientId)

    // ── cursorTime ──
    let displayedCursor: number | null = null
    const targetCursor = peer.cursorTime
    if (targetCursor != null) {
      const prevCursor = prevState?.cursorTime ?? null
      if (prevCursor == null) {
        // null → 有值：吸附
        displayedCursor = targetCursor
      } else if (Math.abs(targetCursor - prevCursor) * zoomLevel > snapPx) {
        // 超大跳变：吸附
        displayedCursor = targetCursor
      } else {
        const next = stepValue(prevCursor, targetCursor, dtMs, tau)
        if (Math.abs(targetCursor - next) * zoomLevel < epsilonPx) {
          displayedCursor = targetCursor // 收敛吸附
        } else {
          displayedCursor = next
          animating = true
        }
      }
    }

    // ── dragging.time ──
    let displayedDragging: { id: string; time: number } | null = null
    const targetDrag = peer.dragging
    if (targetDrag != null) {
      const prevDrag = prevState?.dragging ?? null
      let displayedTime: number
      if (prevDrag == null || prevDrag.id !== targetDrag.id) {
        // null → 有值，或换了拖动对象：吸附
        displayedTime = targetDrag.time
      } else if (Math.abs(targetDrag.time - prevDrag.time) * zoomLevel > snapPx) {
        displayedTime = targetDrag.time
      } else {
        const next = stepValue(prevDrag.time, targetDrag.time, dtMs, tau)
        if (Math.abs(targetDrag.time - next) * zoomLevel < epsilonPx) {
          displayedTime = targetDrag.time
        } else {
          displayedTime = next
          animating = true
        }
      }
      displayedDragging = { id: targetDrag.id, time: displayedTime }
    }

    nextState.set(peer.clientId, {
      cursorTime: displayedCursor,
      dragging: displayedDragging,
    })

    smoothed.push({
      ...peer,
      cursorTime: displayedCursor,
      dragging:
        peer.dragging && displayedDragging
          ? { ...peer.dragging, time: displayedDragging.time }
          : null,
    })
  }

  return { smoothed, state: nextState, animating }
}
