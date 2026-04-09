/**
 * 编辑器工具栏组件
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ZoomIn,
  ZoomOut,
  Lock,
  Unlock,
  BugPlay,
  Undo2,
  Redo2,
  TriangleAlert,
  Settings,
  Eye,
  Copy,
} from 'lucide-react'
import { useStore } from 'zustand'
import { useTimelineStore } from '@/store/timelineStore'
import { useUIStore } from '@/store/uiStore'
import { useEditorReadOnly } from '@/hooks/useEditorReadOnly'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
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
import StatDataDialog from './StatDataDialog'
import { fetchSharedTimeline, type ConflictError } from '@/api/timelineShareApi'
import { useAuthStore } from '@/store/authStore'
import { getEncounterById } from '@/data/raidEncounters'

interface EditorToolbarProps {
  onCreateCopy?: () => void
  forceReadOnly?: boolean
  viewMode: 'timeline' | 'table'
  onViewModeChange: (mode: 'timeline' | 'table') => void
}

export default function EditorToolbar({
  onCreateCopy,
  forceReadOnly,
  viewMode,
  onViewModeChange,
}: EditorToolbarProps) {
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
  const {
    toggleReadOnly,
    showActualDamage,
    showOriginalDamage,
    toggleShowActualDamage,
    toggleShowOriginalDamage,
  } = useUIStore()
  const [showExitReplayConfirm, setShowExitReplayConfirm] = useState(false)
  const [conflict, setConflict] = useState<ConflictError | null>(null)
  const [showStatDataDialog, setShowStatDataDialog] = useState(false)

  const canUndo = useStore(useTimelineStore.temporal, s => s.pastStates.length > 0)
  const canRedo = useStore(useTimelineStore.temporal, s => s.futureStates.length > 0)

  const isReplayMode = timeline?.isReplayMode || false
  const isReadOnly = useEditorReadOnly()
  const accessToken = useAuthStore(s => s.accessToken)

  const encounterId = timeline?.encounter?.id
  const isUnsupportedEncounter =
    !!encounterId && encounterId !== 0 && !getEncounterById(encounterId)

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
              disabled={viewMode === 'table'}
            />
            <ZoomIn className="w-4 h-4 text-muted-foreground shrink-0" />
          </div>

          <div className="w-px h-6 bg-border mx-1" />

          {/* Undo / Redo */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={handleUndo}
                disabled={isReadOnly || !canUndo}
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
                disabled={isReadOnly || !canRedo}
              >
                <Redo2 className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">重做</TooltipContent>
          </Tooltip>

          <div className="w-px h-6 bg-border mx-1" />

          {/* Replay Mode / Read-Only Toggle (mutually exclusive) */}
          {isReplayMode ? (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7 bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100 hover:text-blue-800 dark:bg-blue-950 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-900 dark:hover:text-blue-200"
                  disabled={forceReadOnly}
                >
                  <BugPlay className="w-4 h-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent side="bottom" align="start" className="w-80">
                <div className="space-y-3">
                  <p className="font-semibold text-sm">回放模式</p>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    当前正处于 FFLogs
                    回放模式下，记录并再现了本次战斗中玩家所受到的所有伤害与当时的减伤情况。你可以快速寻找并分析某处的减伤是否欠缺，并检查队友的减伤执行情况。
                    <br />
                    在该模式下，时间轴不可被修改。若要在此基础上修改时间轴，请点击
                    <b>解除回放模式</b>。
                  </p>
                  <div className="flex justify-end">
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setShowExitReplayConfirm(true)}
                    >
                      解除回放模式
                    </Button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
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

          {/* 视图菜单 */}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7">
                    <Eye className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom">视图</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="start">
              <DropdownMenuRadioGroup
                value={viewMode}
                onValueChange={v => onViewModeChange(v as 'timeline' | 'table')}
              >
                <DropdownMenuRadioItem value="timeline">时间轴视图</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="table">表格视图</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>伤害事件</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuCheckboxItem
                    checked={showActualDamage}
                    onCheckedChange={toggleShowActualDamage}
                  >
                    实际伤害
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={showOriginalDamage}
                    onCheckedChange={toggleShowOriginalDamage}
                  >
                    原始伤害
                  </DropdownMenuCheckboxItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="w-px h-6 bg-border mx-1" />

          {/* Party Composition */}
          <CompositionPopover />

          {/* 数值设置 */}
          {!isReplayMode && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setShowStatDataDialog(true)}
                  disabled={isReadOnly || !timeline?.statData}
                >
                  <Settings className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">数值设置</TooltipContent>
            </Tooltip>
          )}

          {/* 共享按钮 或 在本地创建副本 */}
          {timeline && (
            <>
              <div className="w-px h-6 bg-border mx-1" />
              {onCreateCopy ? (
                <Button variant="outline" size="sm" className="h-7" onClick={onCreateCopy}>
                  <Copy className="w-4 h-4" />
                  在本地创建副本
                </Button>
              ) : (
                <SharePopover
                  timeline={timeline}
                  viewMode={viewMode}
                  onPublished={(newId, publishedAt, version) => {
                    applyPublishResult(newId, publishedAt, version)
                    const query = viewMode === 'table' ? '?view=table' : ''
                    navigate(`/timeline/${newId}${query}`, { replace: true })
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

      {isUnsupportedEncounter && (
        <div className="flex items-center gap-1.5 border-b border-yellow-300 bg-yellow-50 px-4 py-1 text-xs text-yellow-800 dark:border-yellow-700 dark:bg-yellow-950 dark:text-yellow-300">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
          <span>该副本暂未支持，部分功能可能无法正常使用</span>
        </div>
      )}

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
      <StatDataDialog open={showStatDataDialog} onClose={() => setShowStatDataDialog(false)} />
    </>
  )
}
