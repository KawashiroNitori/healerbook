/**
 * 编辑器工具栏组件
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ZoomIn, ZoomOut, Plus, Lock, Unlock, Play } from 'lucide-react'
import { useTimelineStore } from '@/store/timelineStore'
import { useUIStore } from '@/store/uiStore'
import { useEditorReadOnly } from '@/hooks/useEditorReadOnly'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
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
import AddEventDialog from './AddEventDialog'
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
  } = useTimelineStore()
  const { toggleReadOnly } = useUIStore()
  const [showAddEventDialog, setShowAddEventDialog] = useState(false)
  const [showExitReplayConfirm, setShowExitReplayConfirm] = useState(false)
  const [conflict, setConflict] = useState<ConflictError | null>(null)

  const isReplayMode = timeline?.isReplayMode || false
  const isReadOnly = useEditorReadOnly()
  const accessToken = useAuthStore(s => s.accessToken)

  const handleExitReplayMode = () => {
    exitReplayMode()
    setShowExitReplayConfirm(false)
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
      <div className="h-12 border-b bg-background flex items-center px-4 gap-4">
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

        <div className="w-px h-6 bg-border" />

        {/* Replay Mode Indicator */}
        {isReplayMode && (
          <>
            <Button
              variant="outline"
              size="sm"
              className="gap-2 h-9 text-sm bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100 hover:text-blue-800"
              onClick={() => setShowExitReplayConfirm(true)}
            >
              <Play className="w-4 h-4" />
              回放
            </Button>
            <div className="w-px h-6 bg-border" />
          </>
        )}

        {/* Read-Only Toggle */}
        <div className="flex items-center gap-2">
          {isReadOnly ? (
            <Lock className="w-4 h-4 text-muted-foreground" />
          ) : (
            <Unlock className="w-4 h-4 text-muted-foreground" />
          )}
          <span className="text-sm text-muted-foreground">只读</span>
          <Switch
            checked={isReadOnly}
            onCheckedChange={toggleReadOnly}
            disabled={isReplayMode || forceReadOnly}
          />
        </div>

        <div className="w-px h-6 bg-border" />

        {/* Party Composition */}
        <CompositionPopover />

        <div className="w-px h-6 bg-border" />
        <button
          onClick={() => setShowAddEventDialog(true)}
          disabled={isReadOnly}
          className="flex items-center gap-2 h-9 px-3 py-2 text-sm border rounded hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
        >
          <Plus className="w-4 h-4" />
          添加事件
        </button>

        {/* 右侧：分享按钮 或 在本地创建副本 */}
        {timeline && !isReplayMode && !isReadOnly && (
          <>
            <div className="flex-1" />
            <SharePopover
              timeline={timeline}
              onPublished={(newId, publishedAt, version) => {
                applyPublishResult(newId, publishedAt, version)
                navigate(`/timeline/${newId}`, { replace: true })
              }}
              onUpdated={(updatedAt, version) => applyUpdateResult(updatedAt, version)}
              onConflict={c => setConflict(c)}
            />
          </>
        )}
        {timeline && !isReplayMode && isReadOnly && onCreateCopy && (
          <>
            <div className="flex-1" />
            <Button variant="outline" size="sm" onClick={onCreateCopy}>
              在本地创建副本
            </Button>
          </>
        )}

        {/* Add Event Dialog */}
        {showAddEventDialog && (
          <AddEventDialog open={showAddEventDialog} onClose={() => setShowAddEventDialog(false)} />
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
