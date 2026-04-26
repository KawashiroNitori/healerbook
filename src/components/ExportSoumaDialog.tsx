/**
 * 导出 Souma 时间轴对话框
 *
 * 让用户选择玩家、勾选技能、切换 TTS，实时生成可被 ff14-overlay-vue
 * 时间轴模块直接导入的压缩字符串，一键复制。
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, HelpCircle, X } from 'lucide-react'
import { toast } from 'sonner'
import { Modal, ModalContent, ModalHeader, ModalTitle } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import { useTimelineStore } from '@/store/timelineStore'
import { useTooltipStore } from '@/store/tooltipStore'
import { useSoumaExportStore } from '@/store/soumaExportStore'
import { getJobName, sortJobsByOrder, type Job } from '@/data/jobs'
import JobIcon from './JobIcon'
import { MITIGATION_DATA } from '@/data/mitigationActions'
import { getIconUrl } from '@/utils/iconUtils'
import { exportSoumaTimeline } from '@/utils/soumaExporter'
import { track } from '@/utils/analytics'
import type { Timeline } from '@/types/timeline'
import { cn } from '@/lib/utils'

interface ExportSoumaDialogProps {
  open: boolean
  onClose: () => void
}

export default function ExportSoumaDialog({ open, onClose }: ExportSoumaDialogProps) {
  const timeline = useTimelineStore(s => s.timeline)
  const lastJob = useSoumaExportStore(s => s.lastJob)
  const setLastJob = useSoumaExportStore(s => s.setLastJob)

  // 玩家下拉选项：按职业顺序（MT/ST/H1/H2/D1-D4）排序，同职业多人追加 #n
  const playerOptions = useMemo(() => {
    if (!timeline) return []
    const jobCounts = new Map<string, number>()
    timeline.composition.players.forEach(p => {
      jobCounts.set(p.job, (jobCounts.get(p.job) ?? 0) + 1)
    })
    const sorted = sortJobsByOrder(timeline.composition.players, p => p.job)
    const jobSeen = new Map<string, number>()
    return sorted.map(p => {
      const total = jobCounts.get(p.job) ?? 1
      const index = (jobSeen.get(p.job) ?? 0) + 1
      jobSeen.set(p.job, index)
      const label = total > 1 ? `${getJobName(p.job)} #${index}` : getJobName(p.job)
      return { id: p.id, job: p.job, label }
    })
  }, [timeline])

  // 用户当前会话内手动选择的玩家 ID（null 表示使用默认值）
  const [manualPlayerId, setManualPlayerId] = useState<number | null>(null)

  // 默认玩家：优先匹配持久化的 lastJob 下的第一个玩家，其次第一个有 castEvents 的玩家，最后第一个玩家
  const defaultPlayerId = useMemo(() => {
    if (!timeline || playerOptions.length === 0) return null
    if (lastJob) {
      const matched = playerOptions.find(p => p.job === lastJob)
      if (matched) return matched.id
    }
    const firstWithCasts = playerOptions.find(p =>
      timeline.castEvents.some(c => c.playerId === p.id)
    )
    return firstWithCasts?.id ?? playerOptions[0]?.id ?? null
  }, [timeline, playerOptions, lastJob])

  const playerId = manualPlayerId ?? defaultPlayerId
  const currentJob = useMemo(
    () => playerOptions.find(p => p.id === playerId)?.job ?? null,
    [playerOptions, playerId]
  )

  // 当前玩家在时间轴中用过的"主轨道"ID 集合：变体 cast（如 37016 trackGroup=37013）
  // 折算到父，列表里只展示父 action；勾父时由 soumaExporter 在 trackGroup 层面回收变体 cast
  const usedActionIds = useMemo(() => {
    if (!timeline || playerId == null) return new Set<number>()
    const ids = new Set<number>()
    for (const c of timeline.castEvents) {
      if (c.playerId !== playerId) continue
      const action = MITIGATION_DATA.actions.find(a => a.id === c.actionId)
      if (!action) continue
      ids.add(action.trackGroup ?? action.id)
    }
    return ids
  }, [timeline, playerId])

  if (!timeline) return null

  const hasCasts = timeline.castEvents.length > 0

  return (
    <Modal open={open} onClose={onClose} maxWidth="lg">
      <ModalContent className="relative">
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
        <ModalHeader>
          <ModalTitle className="flex items-center gap-1.5">
            导出 Souma 时间轴
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="关于 Souma 时间轴"
                  className="inline-flex items-center justify-center rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <HelpCircle className="h-4 w-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-80 text-xs leading-relaxed">
                <p>
                  Souma 治疗/减伤时间轴是由 Souma 制作的 ACT
                  悬浮窗，可以根据自定义的时间轴在副本进程中对技能进行实时提醒。
                </p>
                <p className="mt-2">
                  <a
                    href="https://souma.diemoe.net/ff14-overlay-vue/#/timelineSettings"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline underline-offset-2 hover:opacity-80"
                  >
                    点击这里
                  </a>{' '}
                  将导出的数据导入到悬浮窗中进行使用。
                </p>
              </PopoverContent>
            </Popover>
          </ModalTitle>
        </ModalHeader>

        {!hasCasts ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            当前时间轴无可导出的技能使用事件
          </div>
        ) : (
          <div className="space-y-4 py-2">
            {/* 玩家选择 */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">玩家</label>
              <Select
                value={playerId?.toString() ?? ''}
                onValueChange={v => {
                  const newId = Number(v)
                  setManualPlayerId(newId)
                  const newJob = playerOptions.find(p => p.id === newId)?.job
                  if (newJob) setLastJob(newJob)
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择玩家" />
                </SelectTrigger>
                <SelectContent position="item-aligned">
                  {playerOptions.map(p => (
                    <SelectItem key={p.id} value={p.id.toString()}>
                      <span className="flex items-center gap-2">
                        <JobIcon job={p.job} size="sm" />
                        {p.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 技能 + TTS + 预览：每次 player/job 变化都重新挂载，state 从 store 重新取一次交集作初值 */}
            {playerId != null && currentJob && (
              <SkillSection
                key={`${playerId}-${currentJob}`}
                timeline={timeline}
                playerId={playerId}
                currentJob={currentJob}
                usedActionIds={usedActionIds}
              />
            )}
          </div>
        )}
      </ModalContent>
    </Modal>
  )
}

interface SkillSectionProps {
  timeline: Timeline
  playerId: number
  currentJob: Job
  usedActionIds: Set<number>
}

/**
 * 技能网格 + TTS + 预览 + 复制。
 * 使用 `key={playerId-currentJob}` 挂载，`selected` 本地 state 只在首次 render 时
 * 从 store 读取一次并与 usedActionIds 取交集；后续 toggle 直接更新本地 state 并写回 store。
 */
function SkillSection({ timeline, playerId, currentJob, usedActionIds }: SkillSectionProps) {
  const showTooltip = useTooltipStore(s => s.showTooltip)
  const hideTooltip = useTooltipStore(s => s.hideTooltip)
  const ttsEnabled = useSoumaExportStore(s => s.ttsEnabled)
  const setTtsEnabled = useSoumaExportStore(s => s.setTtsEnabled)
  const setActionIdsForJob = useSoumaExportStore(s => s.setActionIdsForJob)

  const [selected, setSelected] = useState<Set<number>>(() => {
    const persisted = useSoumaExportStore.getState().actionIdsByJob[currentJob]
    if (!persisted) return new Set(usedActionIds)
    return new Set(persisted.filter(id => usedActionIds.has(id)))
  })

  const hasSelection = selected.size > 0

  const exportString = useMemo(() => {
    if (!hasSelection) return '请至少选择一个技能'
    return exportSoumaTimeline({
      timeline,
      playerId,
      selectedActionIds: Array.from(selected),
      ttsEnabled,
    })
  }, [timeline, playerId, selected, ttsEnabled, hasSelection])

  const toggleAction = (actionId: number) => {
    const next = new Set(selected)
    if (next.has(actionId)) next.delete(actionId)
    else next.add(actionId)
    setSelected(next)
    setActionIdsForJob(currentJob, Array.from(next))
  }

  const allSelected = selected.size === usedActionIds.size && usedActionIds.size > 0
  const toggleSelectAll = () => {
    const next = allSelected ? new Set<number>() : new Set(usedActionIds)
    setSelected(next)
    setActionIdsForJob(currentJob, Array.from(next))
  }

  const [copied, setCopied] = useState(false)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    }
  }, [])

  const handleCopy = async () => {
    if (!hasSelection) return
    try {
      await navigator.clipboard.writeText(exportString)
      setCopied(true)
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
      copiedTimerRef.current = setTimeout(() => setCopied(false), 2000)
      track('souma-export-copy', {
        job: currentJob,
        skillCount: selected.size,
        ttsEnabled,
      })
    } catch {
      toast.error('复制失败，请手动选中文本')
    }
  }

  const actions = MITIGATION_DATA.actions.filter(a => usedActionIds.has(a.id))

  return (
    <>
      {/* 技能图标网格 */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium leading-none">技能</label>
            {actions.length > 0 && (
              <span className="text-xs leading-none text-muted-foreground">
                已选 {selected.size} / {actions.length}
              </span>
            )}
          </div>
          {actions.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={toggleSelectAll}
            >
              {allSelected ? '取消全选' : '全选'}
            </Button>
          )}
        </div>
        {actions.length === 0 ? (
          <div className="text-xs text-muted-foreground">该玩家未使用任何技能</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {actions.map(action => {
              const isSelected = selected.has(action.id)
              return (
                <button
                  key={action.id}
                  type="button"
                  onClick={() => toggleAction(action.id)}
                  onMouseEnter={e =>
                    showTooltip(action, e.currentTarget.getBoundingClientRect(), [
                      'b',
                      't',
                      'r',
                      'l',
                    ])
                  }
                  onMouseLeave={hideTooltip}
                  className={cn(
                    'relative h-10 w-10 overflow-hidden rounded-md border transition',
                    isSelected
                      ? 'border-primary ring-1 ring-primary'
                      : 'border-border opacity-60 saturate-50 hover:opacity-90 hover:saturate-100'
                  )}
                >
                  <img
                    src={getIconUrl(action.icon)}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                  {isSelected && (
                    <span className="absolute right-0 top-0 flex h-4 w-4 items-center justify-center rounded-tr-md rounded-bl-md bg-green-500 text-[10px] font-bold leading-none text-white shadow">
                      ✓
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* TTS 开关 */}
      <div className="flex items-center justify-between pt-1">
        <label htmlFor="souma-tts-switch" className="text-sm font-medium">
          TTS 播报
        </label>
        <Switch id="souma-tts-switch" checked={ttsEnabled} onCheckedChange={setTtsEnabled} />
      </div>

      {/* 实时预览 + 复制 */}
      <div className="space-y-1.5 pt-1">
        <label className="text-sm font-medium">导出结果</label>
        <ButtonGroup className="w-full">
          <Input
            type="text"
            readOnly
            value={exportString}
            onFocus={e => e.currentTarget.select()}
            onClick={e => e.currentTarget.select()}
            className="font-mono text-xs"
          />
          <Button
            variant="outline"
            size="icon"
            aria-label="复制"
            onClick={handleCopy}
            disabled={!hasSelection}
          >
            {copied ? <Check /> : <Copy />}
          </Button>
        </ButtonGroup>
      </div>
    </>
  )
}
