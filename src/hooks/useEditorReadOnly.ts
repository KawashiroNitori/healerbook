/**
 * 获取编辑器的只读状态
 * 回放模式下强制只读
 */

import { useTimelineStore } from '@/store/timelineStore'
import { useUIStore } from '@/store/uiStore'

export function useEditorReadOnly(): boolean {
  const timeline = useTimelineStore(state => state.timeline)
  const manualLock = useUIStore(state => state.manualLock)
  const isReplayMode = timeline?.isReplayMode || false
  return isReplayMode || manualLock
}
