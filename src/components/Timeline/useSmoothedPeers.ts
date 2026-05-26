import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTimelineStore } from '@/store/timelineStore'
import type { PeerState } from '@/collab/awarenessTypes'
import { advancePeerSmoothing, type SmoothStateMap } from '@/utils/peerCursorSmoothing'

/**
 * 返回平滑后的 peers：cursorTime / dragging.time 经帧率无关指数逼近。
 * 单个 rAF 循环，所有 peer 收敛后自动停止；新数据到达再唤醒。
 *
 * @param zoomLevel 当前缩放（px/秒），用于像素域的吸附 / 收敛判定
 */
export function useSmoothedPeers(zoomLevel: number): PeerState[] {
  const peers = useTimelineStore(s => s.peers)
  const [smoothed, setSmoothed] = useState<PeerState[]>(peers)

  // 平滑态、上一帧时间戳、rAF 句柄、最新输入（避免闭包过期）
  const stateRef = useRef<SmoothStateMap>(new Map())
  const rafRef = useRef<number | null>(null)
  const lastTsRef = useRef<number | null>(null)
  const peersRef = useRef(peers)
  const zoomRef = useRef(zoomLevel)

  // 在 layout effect 中同步 refs，避免在渲染阶段直接写 ref.current（react-hooks/refs）
  useLayoutEffect(() => {
    peersRef.current = peers
    zoomRef.current = zoomLevel
  })

  useEffect(() => {
    const tick = (ts: number) => {
      const last = lastTsRef.current
      const dtMs = last == null ? 16 : Math.min(ts - last, 100) // 钳制长帧（切后台）
      lastTsRef.current = ts

      const {
        smoothed: next,
        state,
        animating,
      } = advancePeerSmoothing(peersRef.current, stateRef.current, dtMs, zoomRef.current)
      stateRef.current = state
      setSmoothed(next)

      if (animating) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        rafRef.current = null
        lastTsRef.current = null
      }
    }

    // peers 变化即唤醒循环（若已在跑则不重复调度）
    if (rafRef.current == null) {
      lastTsRef.current = null
      rafRef.current = requestAnimationFrame(tick)
    }

    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      lastTsRef.current = null
    }
  }, [peers])

  return smoothed
}
