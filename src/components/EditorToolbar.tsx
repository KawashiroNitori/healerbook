/**
 * 编辑器工具栏组件
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ZoomIn, ZoomOut, Lock, Unlock, Play, Undo2, Redo2 } from 'lucide-react'
import { useStore } from 'zustand'
import { useTimelineStore } from '@/store/timelineStore'
import { useUIStore } from '@/store/uiStore'
import { useEditorReadOnly } from '@/hooks/useEditorReadOnly'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import CompositionPopover from './CompositionPopover'
import SharePopover from './SharePopover'
import ConflictDialog from './ConflictDialog'
import { fetchSharedTimeline, type ConflictError } from '@/api/timelineShareApi'
import { useAuthStore } from '@/store/authStore'

interface EditorToolbarProps {
  onCreateCopy?: () => void
  forceReadOnly?: boolean
}

export default function EditorToolbar({ onCreateCopy, forceReadOnly }: EditorToolbarProps) {
  const navigate = useNavigate()
  const {
    timeline,
    exitReplayMode,
    zoomLevel,
    setZoomLevel,
    setPendingScrollProgress,
    applyPublishResult,
    applyUpdateResult,
    applyServerTimeline,
    triggerAutoSave,
    selectEvent,
    selectCastEvent,
  } = useTimelineStore()
  const { toggleReadOnly } = useUIStore()
  const [showExitReplayConfirm, setShowExitReplayConfirm] = useState(false)
  const [conflict, setConflict] = useState<ConflictError | null>(null)

  const canUndo = useStore(useTimelineStore.temporal, s => s.pastStates.length > 0)
  const canRedo = useStore(useTimelineStore.temporal, s => s.futureStates.length > 0)

  const isReplayMode = timeline?.isReplayMode || false
  const isReadOnly = useEditorReadOnly()
  const accessToken = useAuthStore(s => s.accessToken)

  const handleExitReplayMode = () => {
    exitReplayMode()
    setShowExitReplayConfirm(false)
  }

  const handleUndo = () => {
    useTimelineStore.temporal.getState().undo()
    selectEvent(null)
    selectCastEvent(null)
    triggerAutoSave()
  }

  const handleRedo = () => {
    useTimelineStore.temporal.getState().redo()
    selectEvent(null)
    selectCastEvent(null)
    triggerAutoSave()
  }

  const handleZoomChange = (values: number[]) => {
    const newZoom = values[0]
    // 保存当前时间中心点以还原位置
    const state = useTimelineStore.getState()
    const timeAtCenter =
      (state.currentScrollLeft + state.currentViewportWidth / 2) / (state.zoomLevel || newZoom)
    setPendingScrollProgress(timeAtCenter)
    setZoomLevel(newZoom)
  }

  return (
    <>
      <TooltipProvider>
        <div className="h-12 border-b bg-background flex items-center px-4 gap-2">
          {/* Zoom Controls */}
          <div className="flex items-center gap-2">
            <ZoomOut className="w-4 h-4 text-muted-foreground shrink-0" />
            <Slider
              value={[zoomLevel]}
              onValueChange={handleZoomChange}
              min={10}
              max={100}
              className="w-24"
            />
            <ZoomIn className="w-4 h-4 text-muted-foreground shrink-0" />
          </div>

          <div className="w-px h-6 bg-border mx-1" />

          {/* Undo / Redo */}
          {!isReadOnly && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={handleUndo}
                    disabled={!canUndo}
                  >
                    <Undo2 className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">撤销</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={handleRedo}
                    disabled={!canRedo}
                  >
                    <Redo2 className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">重做</TooltipContent>
              </Tooltip>
              <div className="w-px h-6 bg-border mx-1" />
            </>
          )}

          {/* Replay Mode / Read-Only Toggle (mutually exclusive) */}
          {isReplayMode ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7 bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100 hover:text-blue-800"
                  onClick={() => setShowExitReplayConfirm(true)}
                  disabled={forceReadOnly}
                >
                  <Play className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">退出回放模式</TooltipContent>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-7 w-7 ${isReadOnly ? 'text-red-600 hover:text-red-700' : ''}`}
                  onClick={toggleReadOnly}
                  disabled={forceReadOnly}
                >
                  {isReadOnly ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {isReadOnly ? '切换为编辑模式' : '切换为只读模式'}
              </TooltipContent>
            </Tooltip>
          )}

          <div className="w-px h-6 bg-border mx-1" />

          {/* Party Composition */}
          <CompositionPopover />

          {/* 共享按钮 或 在本地创建副本 */}
          {timeline && (
            <>
              <div className="w-px h-6 bg-border mx-1" />
              {onCreateCopy ? (
                <Button variant="outline" size="sm" className="h-7" onClick={onCreateCopy}>
                  在本地创建副本
                </Button>
              ) : (
                <SharePopover
                  timeline={timeline}
                  onPublished={(newId, publishedAt, version) => {
                    applyPublishResult(newId, publishedAt, version)
                    navigate(`/timeline/${newId}`, { replace: true })
                  }}
                  onUpdated={(updatedAt, version) => applyUpdateResult(updatedAt, version)}
                  onConflict={c => setConflict(c)}
                />
              )}
            </>
          )}

          {/* Exit Replay Mode Confirmation */}
          <AlertDialog open={showExitReplayConfirm} onOpenChange={setShowExitReplayConfirm}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>解除回放模式</AlertDialogTitle>
                <AlertDialogDescription>此操作不可撤销，是否继续？</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleExitReplayMode}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  确认解除
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </TooltipProvider>

      {conflict && timeline && (
        <ConflictDialog
          open={true}
          localUpdatedAt={timeline.updatedAt}
          serverUpdatedAt={conflict.serverUpdatedAt}
          onKeepLocal={async () => {
            if (!accessToken) return
            const { updateTimeline } = await import('@/api/timelineShareApi')
            const result = await updateTimeline(timeline.id, timeline)
            if (!('type' in result)) {
              applyUpdateResult(result.updatedAt, result.version)
            }
            setConflict(null)
          }}
          onUseServer={async () => {
            if (!accessToken) return
            const server = await fetchSharedTimeline(timeline.id)
            applyServerTimeline(server)
            setConflict(null)
          }}
        />
      )}
    </>
  )
}
