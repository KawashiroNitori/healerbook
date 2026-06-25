/**
 * 编辑器工具栏组件
 */

import { useState, lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
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
  FileInput,
  FileOutput,
  Hand,
  BoxSelect,
  MoreHorizontal,
  Copy,
  Wand2,
  Loader2,
} from 'lucide-react'
import { useTimelineStore } from '@/store/timelineStore'
import { useUIStore } from '@/store/uiStore'
import { useEditorReadOnly } from '@/hooks/useEditorReadOnly'
import { useEditLock } from '@/hooks/useEditLock'
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
const ImportIntoTimelineDialog = lazy(() => import('./ImportIntoTimelineDialog'))
import { useEncounterStatistics } from '@/hooks/useEncounterStatistics'
import { useAutoMitigate } from '@/hooks/useAutoMitigate'
import { AutoMitigateProgressModal } from '@/components/AutoMitigateProgressModal'
import { AutoMitigateDisclaimerModal } from '@/components/AutoMitigateDisclaimerModal'
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
  viewMode: 'timeline' | 'table'
  onViewModeChange: (mode: 'timeline' | 'table') => void
  shareRole: ShareRole
}

export default function EditorToolbar({
  onCreateCopy,
  onPublished,
  viewMode,
  onViewModeChange,
  shareRole,
}: EditorToolbarProps) {
  const { t } = useTranslation(['editor', 'common'])
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
    canvasTool,
    setCanvasTool,
  } = useUIStore()
  const [showExitReplayConfirm, setShowExitReplayConfirm] = useState(false)
  const [showStatDataDialog, setShowStatDataDialog] = useState(false)
  const [showExportDialog, setShowExportDialog] = useState(false)
  const [showSoumaDialog, setShowSoumaDialog] = useState(false)
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [showAutoMitigateDisclaimer, setShowAutoMitigateDisclaimer] = useState(false)
  const [viewMenuOpen, setViewMenuOpen] = useState(false)
  const [viewTooltipOpen, setViewTooltipOpen] = useState(false)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [exportTooltipOpen, setExportTooltipOpen] = useState(false)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [moreTooltipOpen, setMoreTooltipOpen] = useState(false)

  const canUndo = useTimelineStore(s => s.canUndo)
  const canRedo = useTimelineStore(s => s.canRedo)
  const isPublished = useTimelineStore(s => s.isPublished)
  const sessionRole = useTimelineStore(s => s.sessionRole)

  const isReplayMode = timeline?.isReplayMode || false
  const isReadOnly = useEditorReadOnly()
  const editLock = useEditLock()
  const contentReason = editLock.reasonOf('content')
  /** 系统强制只读（非用户手动锁）时，锁按钮不可由用户切换 */
  const lockForced = contentReason !== null && contentReason !== 'manual'

  const {
    isOptimizing,
    progress: optimizeProgress,
    run: runAutoMitigate,
    cancel: cancelAutoMitigate,
  } = useAutoMitigate()

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
      <AutoMitigateDisclaimerModal
        open={showAutoMitigateDisclaimer}
        onOpenChange={setShowAutoMitigateDisclaimer}
        onConfirm={() => {
          setShowAutoMitigateDisclaimer(false)
          runAutoMitigate()
        }}
      />
      <AutoMitigateProgressModal
        open={isOptimizing}
        progress={optimizeProgress}
        onCancel={cancelAutoMitigate}
      />
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

            {/* 更多操作菜单（对所有身份可用，不与已有同功能按钮做互斥） */}
            <DropdownMenu open={moreMenuOpen} onOpenChange={setMoreMenuOpen}>
              <Tooltip
                open={moreMenuOpen ? false : moreTooltipOpen}
                onOpenChange={setMoreTooltipOpen}
              >
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7">
                      <MoreHorizontal className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t('editor:editorToolbar.more')}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="start" onCloseAutoFocus={e => e.preventDefault()}>
                <DropdownMenuItem onSelect={() => onCreateCopy()}>
                  <Copy className="w-4 h-4" />
                  {t('editor:editorToolbar.createCopy')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* 平移 / 框选 工具切换（仅时间轴视图；只读/回放也可切换以便选中、复制） */}
            {viewMode !== 'table' && (
              <div className="flex items-center gap-0.5 rounded-md border border-border bg-muted/40 p-0.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={canvasTool === 'pan' ? 'default' : 'ghost'}
                      size="icon"
                      className="h-6 w-6"
                      aria-pressed={canvasTool === 'pan'}
                      aria-label={t('editor:editorToolbar.panTool')}
                      onClick={() => setCanvasTool('pan')}
                    >
                      <Hand className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{t('editor:editorToolbar.panTool')}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={canvasTool === 'select' ? 'default' : 'ghost'}
                      size="icon"
                      className="h-6 w-6"
                      aria-pressed={canvasTool === 'select'}
                      aria-label={t('editor:editorToolbar.selectTool')}
                      onClick={() => setCanvasTool('select')}
                    >
                      <BoxSelect className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {t('editor:editorToolbar.selectTool')}
                  </TooltipContent>
                </Tooltip>
              </div>
            )}

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
                    {t('editor:editorToolbar.undo')}
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
                    {t('editor:editorToolbar.redo')}
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
                    disabled={!editLock.can('exitReplay')}
                  >
                    <BugPlay className="w-4 h-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent side="bottom" align="start" className="w-80">
                  <div className="space-y-3">
                    <p className="font-semibold text-sm">
                      {t('editor:editorToolbar.replayModeTitle')}
                    </p>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {t('editor:editorToolbar.replayModeDescPrefix')}
                      <br />
                      {t('editor:editorToolbar.replayModeDescBefore')}
                      <b>{t('editor:editorToolbar.exitReplayMode')}</b>
                      {t('editor:editorToolbar.replayModeDescAfter')}
                    </p>
                    <div className="flex justify-end">
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setShowExitReplayConfirm(true)}
                      >
                        {t('editor:editorToolbar.exitReplayMode')}
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
                    disabled={lockForced}
                  >
                    {isReadOnly ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {lockForced
                    ? contentReason === 'viewer'
                      ? t('editor:editorToolbar.readOnlyViewer')
                      : contentReason === 'offline'
                        ? t('editor:editorToolbar.readOnlyOffline')
                        : t('editor:editorToolbar.readOnly')
                    : isReadOnly
                      ? t('editor:editorToolbar.switchToEdit')
                      : t('editor:editorToolbar.switchToReadOnly')}
                </TooltipContent>
              </Tooltip>
            )}

            {/* 视图菜单 */}
            <DropdownMenu open={viewMenuOpen} onOpenChange={setViewMenuOpen}>
              <Tooltip
                open={viewMenuOpen ? false : viewTooltipOpen}
                onOpenChange={setViewTooltipOpen}
              >
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7">
                      <Eye className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t('editor:editorToolbar.view')}</TooltipContent>
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
                  <DropdownMenuRadioItem value="timeline">
                    {t('editor:editorToolbar.timelineView')}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="table">
                    {t('editor:editorToolbar.tableView')}
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    {t('editor:editorToolbar.damageEvents')}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuCheckboxItem
                      checked={showActualDamage}
                      onCheckedChange={checked => {
                        track('view-toggle-actual-damage', { checked })
                        toggleShowActualDamage()
                      }}
                    >
                      {t('editor:editorToolbar.actualDamage')}
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                      checked={showOriginalDamage}
                      onCheckedChange={checked => {
                        track('view-toggle-original-damage', { checked })
                        toggleShowOriginalDamage()
                      }}
                    >
                      {t('editor:editorToolbar.originalDamage')}
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
                  {t('editor:editorToolbar.hpSimulation')}
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
              <TooltipContent side="bottom">{t('editor:editorToolbar.statData')}</TooltipContent>
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

            {/* 导入 */}
            {!isReplayMode && sessionRole !== 'viewer' && (
              <>
                <div className="w-px h-6 bg-border mx-1" />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      disabled={!editLock.can('content') || isOptimizing}
                      onClick={() => setShowAutoMitigateDisclaimer(true)}
                      aria-label="自动减伤"
                    >
                      {isOptimizing ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Wand2 className="h-4 w-4" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">自动减伤规划（实验性）</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setShowImportDialog(true)}
                        disabled={!editLock.can('content')}
                      >
                        <FileInput className="w-4 h-4" />
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {editLock.can('content')
                      ? t('editor:editorToolbar.import')
                      : contentReason === 'viewer'
                        ? t('editor:editorToolbar.readOnlyViewer')
                        : contentReason === 'offline'
                          ? t('editor:editorToolbar.readOnlyOffline')
                          : t('editor:editorToolbar.readOnly')}
                  </TooltipContent>
                </Tooltip>
              </>
            )}

            {/* 导出 */}
            {timeline && (
              <>
                {/* 导入隐藏时（回放 / viewer），由导出补上与「共享」隔开的分割线 */}
                {(isReplayMode || sessionRole === 'viewer') && (
                  <div className="w-px h-6 bg-border mx-1" />
                )}
                <DropdownMenu open={exportMenuOpen} onOpenChange={setExportMenuOpen}>
                  <Tooltip
                    open={exportMenuOpen ? false : exportTooltipOpen}
                    onOpenChange={setExportTooltipOpen}
                  >
                    <TooltipTrigger asChild>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7">
                          <FileOutput className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      {t('editor:editorToolbar.export')}
                    </TooltipContent>
                  </Tooltip>
                  <DropdownMenuContent align="start" onCloseAutoFocus={e => e.preventDefault()}>
                    <DropdownMenuItem
                      onSelect={() => {
                        track('souma-export-start')
                        setShowSoumaDialog(true)
                      }}
                    >
                      {t('editor:editorToolbar.exportSoumaItem')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => {
                        track('excel-export-start')
                        setShowExportDialog(true)
                      }}
                    >
                      {t('editor:editorToolbar.exportExcelItem')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}

            {/* Exit Replay Mode Confirmation */}
            <AlertDialog open={showExitReplayConfirm} onOpenChange={setShowExitReplayConfirm}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('editor:editorToolbar.exitReplayMode')}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t('editor:editorToolbar.exitReplayConfirmDesc')}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('common:cancel')}</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleExitReplayMode}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {t('editor:editorToolbar.exitReplayConfirm')}
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
          <span>{t('editor:editorToolbar.unsupportedEncounter')}</span>
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
        {showImportDialog && (
          <ImportIntoTimelineDialog
            open={showImportDialog}
            onClose={() => setShowImportDialog(false)}
          />
        )}
      </Suspense>
    </>
  )
}
