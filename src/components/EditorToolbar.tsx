/**
 * 编辑器工具栏组件
 */

import { useState, lazy, Suspense } from 'react'
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
  Download,
} from 'lucide-react'
import { useTimelineStore } from '@/store/timelineStore'
import { useUIStore } from '@/store/uiStore'
import { useEditorReadOnly } from '@/hooks/useEditorReadOnly'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { modKeyLabel, shiftKeyLabel } from '@/utils/platform'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuItem,
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
import FilterMenu from './FilterMenu/FilterMenu'
import SharePopover from './SharePopover'
import StatDataDialog from './StatDataDialog'
const ExportExcelDialog = lazy(() => import('./ExportExcelDialog'))
const ExportSoumaDialog = lazy(() => import('./ExportSoumaDialog'))
import { useEncounterStatistics } from '@/hooks/useEncounterStatistics'
import { track } from '@/utils/analytics'

interface ShareRole {
  role: 'editor' | 'viewer'
  isAuthor: boolean
  allowEditRequests: boolean
  hasPendingRequest: boolean
}

interface EditorToolbarProps {
  onCreateCopy: () => void
  onPublished?: (newId: string) => void
  forceReadOnly?: boolean
  viewMode: 'timeline' | 'table'
  onViewModeChange: (mode: 'timeline' | 'table') => void
  shareRole: ShareRole
}

export default function EditorToolbar({
  onCreateCopy,
  onPublished,
  forceReadOnly,
  viewMode,
  onViewModeChange,
  shareRole,
}: EditorToolbarProps) {
  const {
    timeline,
    exitReplayMode,
    zoomLevel,
    setZoomLevel,
    setPendingScrollProgress,
    selectEvent,
    selectCastEvent,
    undo,
    redo,
  } = useTimelineStore()
  const {
    toggleManualLock,
    showActualDamage,
    showOriginalDamage,
    toggleShowActualDamage,
    toggleShowOriginalDamage,
    enableHpSimulation,
    toggleEnableHpSimulation,
  } = useUIStore()
  const [showExitReplayConfirm, setShowExitReplayConfirm] = useState(false)
  const [showStatDataDialog, setShowStatDataDialog] = useState(false)
  const [showExportDialog, setShowExportDialog] = useState(false)
  const [showSoumaDialog, setShowSoumaDialog] = useState(false)
  const [viewMenuOpen, setViewMenuOpen] = useState(false)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)

  const canUndo = useTimelineStore(s => s.canUndo)
  const canRedo = useTimelineStore(s => s.canRedo)
  const isPublished = useTimelineStore(s => s.isPublished)

  const isReplayMode = timeline?.isReplayMode || false
  const isReadOnly = useEditorReadOnly()

  const encounterId = timeline?.encounter?.id
  const statisticsQuery = useEncounterStatistics(encounterId)
  // /api/statistics 命中 404 时 getEncounterStatistics 返回 null；以此作为「副本暂未支持」的判定
  const isUnsupportedEncounter =
    !!encounterId && statisticsQuery.isSuccess && statisticsQuery.data === null

  const handleExitReplayMode = () => {
    exitReplayMode()
    setShowExitReplayConfirm(false)
  }

  const handleUndo = () => {
    undo()
    selectEvent(null)
    selectCastEvent(null)
  }

  const handleRedo = () => {
    redo()
    selectEvent(null)
    selectCastEvent(null)
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
        <div className="h-12 border-b bg-background overflow-x-auto scrollbar-hide">
          <div className="h-full w-max flex items-center px-4 gap-2">
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

            {/* Undo / Redo（回放模式下不展示） */}
            {!isReplayMode && (
              <>
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
                  <TooltipContent side="bottom" className="flex items-center gap-1.5">
                    撤销
                    <KbdGroup>
                      <Kbd>{modKeyLabel}</Kbd>
                      <Kbd>Z</Kbd>
                    </KbdGroup>
                  </TooltipContent>
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
                  <TooltipContent side="bottom" className="flex items-center gap-1.5">
                    重做
                    <KbdGroup>
                      <Kbd>{modKeyLabel}</Kbd>
                      <Kbd>{shiftKeyLabel}</Kbd>
                      <Kbd>Z</Kbd>
                    </KbdGroup>
                  </TooltipContent>
                </Tooltip>

                <div className="w-px h-6 bg-border mx-1" />
              </>
            )}

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
                    onClick={toggleManualLock}
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

            {/* 视图菜单 */}
            <DropdownMenu open={viewMenuOpen} onOpenChange={setViewMenuOpen}>
              <Tooltip open={viewMenuOpen ? false : undefined}>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7">
                      <Eye className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">视图</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="start" onCloseAutoFocus={e => e.preventDefault()}>
                <DropdownMenuRadioGroup
                  value={viewMode}
                  onValueChange={v => {
                    const mode = v as 'timeline' | 'table'
                    track('view-mode-change', { mode })
                    onViewModeChange(mode)
                  }}
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
                      onCheckedChange={checked => {
                        track('view-toggle-actual-damage', { checked })
                        toggleShowActualDamage()
                      }}
                    >
                      实际伤害
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                      checked={showOriginalDamage}
                      onCheckedChange={checked => {
                        track('view-toggle-original-damage', { checked })
                        toggleShowOriginalDamage()
                      }}
                    >
                      原始伤害
                    </DropdownMenuCheckboxItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                  checked={enableHpSimulation}
                  onCheckedChange={checked => {
                    track('view-toggle-hp-simulation', { checked })
                    toggleEnableHpSimulation()
                  }}
                >
                  HP 模拟
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* 过滤菜单 */}
            <FilterMenu />

            <div className="w-px h-6 bg-border mx-1" />

            {/* Party Composition */}
            <CompositionPopover />

            {/* 数值设置：只读下也可打开查看，对话框内写入控件由只读态控制 */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setShowStatDataDialog(true)}
                  disabled={!timeline?.statData}
                >
                  <Settings className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">数值设置</TooltipContent>
            </Tooltip>

            {/* 共享 */}
            {timeline && (
              <>
                <div className="w-px h-6 bg-border mx-1" />
                <SharePopover
                  timeline={timeline}
                  isPublished={isPublished}
                  viewMode={viewMode}
                  onPublished={newId => onPublished?.(newId)}
                  onCreateCopy={onCreateCopy}
                  role={shareRole.role}
                  isAuthor={shareRole.isAuthor}
                  allowEditRequests={shareRole.allowEditRequests}
                  hasPendingRequest={shareRole.hasPendingRequest}
                />
              </>
            )}

            {/* 导出 */}
            {timeline && (
              <>
                <div className="w-px h-6 bg-border mx-1" />
                <DropdownMenu open={exportMenuOpen} onOpenChange={setExportMenuOpen}>
                  <Tooltip open={exportMenuOpen ? false : undefined}>
                    <TooltipTrigger asChild>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7">
                          <Download className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">导出</TooltipContent>
                  </Tooltip>
                  <DropdownMenuContent align="start" onCloseAutoFocus={e => e.preventDefault()}>
                    <DropdownMenuItem
                      onSelect={() => {
                        track('souma-export-start')
                        setShowSoumaDialog(true)
                      }}
                    >
                      Souma 时间轴...
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => {
                        track('excel-export-start')
                        setShowExportDialog(true)
                      }}
                    >
                      Excel 表格...
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
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
        </div>
      </TooltipProvider>

      {isUnsupportedEncounter && (
        <div className="flex items-center gap-1.5 border-b border-yellow-300 bg-yellow-50 px-4 py-1 text-xs text-yellow-800 dark:border-yellow-700 dark:bg-yellow-950 dark:text-yellow-300">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
          <span>该副本暂未支持，部分功能可能无法正常使用</span>
        </div>
      )}

      <StatDataDialog open={showStatDataDialog} onClose={() => setShowStatDataDialog(false)} />
      <Suspense fallback={null}>
        {showExportDialog && (
          <ExportExcelDialog open={showExportDialog} onClose={() => setShowExportDialog(false)} />
        )}
        {showSoumaDialog && (
          <ExportSoumaDialog open={showSoumaDialog} onClose={() => setShowSoumaDialog(false)} />
        )}
      </Suspense>
    </>
  )
}
