/**
 * 编辑器工具栏组件
 */

import { useState } from 'react'
import { ZoomIn, ZoomOut, Plus, Lock, Unlock, Play } from 'lucide-react'
import { useTimelineStore } from '@/store/timelineStore'
import { useUIStore } from '@/store/uiStore'
import { useEditorReadOnly } from '@/hooks/useEditorReadOnly'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
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

export default function EditorToolbar() {
  const { zoomLevel, setZoomLevel, timeline, exitReplayMode } = useTimelineStore()
  const { toggleReadOnly } = useUIStore()
  const [showAddEventDialog, setShowAddEventDialog] = useState(false)
  const [showExitReplayConfirm, setShowExitReplayConfirm] = useState(false)

  const isReplayMode = timeline?.isReplayMode || false
  const isReadOnly = useEditorReadOnly()

  const handleExitReplayMode = () => {
    exitReplayMode()
    setShowExitReplayConfirm(false)
  }

  const handleZoomIn = () => {
    setZoomLevel(zoomLevel + 10)
  }

  const handleZoomOut = () => {
    setZoomLevel(zoomLevel - 10)
  }

  return (
    <div className="h-12 border-b bg-background flex items-center px-4 gap-4">
      {/* Zoom Controls */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleZoomOut}
          className="p-2 hover:bg-accent rounded transition-colors"
          title="缩小"
        >
          <ZoomOut className="w-4 h-4" />
        </button>

        <button
          onClick={handleZoomIn}
          className="p-2 hover:bg-accent rounded transition-colors"
          title="放大"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
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
          disabled={isReplayMode}
        />
      </div>

      <div className="w-px h-6 bg-border" />

      {/* Add Event Button */}
      <button
        onClick={() => setShowAddEventDialog(true)}
        disabled={isReadOnly}
        className="flex items-center gap-2 h-9 px-3 py-2 text-sm border rounded hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
      >
        <Plus className="w-4 h-4" />
        添加事件
      </button>

      {/* Add Event Dialog */}
      {showAddEventDialog && (
        <AddEventDialog
          open={showAddEventDialog}
          onClose={() => setShowAddEventDialog(false)}
        />
      )}

      {/* Exit Replay Mode Confirmation */}
      <AlertDialog open={showExitReplayConfirm} onOpenChange={setShowExitReplayConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>解除回放模式</AlertDialogTitle>
            <AlertDialogDescription>
              此操作不可撤销，是否继续？
            </AlertDialogDescription>
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
  )
}
