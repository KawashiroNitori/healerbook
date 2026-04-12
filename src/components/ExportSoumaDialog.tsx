/**
 * 导出 Souma 时间轴对话框
 *
 * 让用户选择玩家、勾选技能、切换 TTS，实时生成可被 ff14-overlay-vue
 * 时间轴模块直接导入的压缩字符串，一键复制。
 */

import { useMemo, useState } from 'react'
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalFooter } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import { useTimelineStore } from '@/store/timelineStore'
import { getJobName } from '@/data/jobs'
import { MITIGATION_DATA } from '@/data/mitigationActions'
import { getIconUrl } from '@/utils/iconUtils'
import { cn } from '@/lib/utils'

interface ExportSoumaDialogProps {
  open: boolean
  onClose: () => void
}

export default function ExportSoumaDialog({ open, onClose }: ExportSoumaDialogProps) {
  const timeline = useTimelineStore(s => s.timeline)

  // 玩家下拉选项：若同职业有多人，追加 #n 以区分
  const playerOptions = useMemo(() => {
    if (!timeline) return []
    const jobCounts = new Map<string, number>()
    timeline.composition.players.forEach(p => {
      jobCounts.set(p.job, (jobCounts.get(p.job) ?? 0) + 1)
    })
    const jobSeen = new Map<string, number>()
    return timeline.composition.players.map(p => {
      const total = jobCounts.get(p.job) ?? 1
      const index = (jobSeen.get(p.job) ?? 0) + 1
      jobSeen.set(p.job, index)
      const label = total > 1 ? `${getJobName(p.job)} #${index}` : getJobName(p.job)
      return { id: p.id, job: p.job, label }
    })
  }, [timeline])

  // 用户手动选择的玩家 ID（null 表示尚未手动选择，使用默认值）
  const [manualPlayerId, setManualPlayerId] = useState<number | null>(null)
  const [ttsEnabled, setTtsEnabled] = useState(false)

  // 默认选中第一个有 castEvents 的玩家
  const defaultPlayerId = useMemo(() => {
    if (!timeline || playerOptions.length === 0) return null
    const firstWithCasts = playerOptions.find(p =>
      timeline.castEvents.some(c => c.playerId === p.id)
    )
    return firstWithCasts?.id ?? playerOptions[0]?.id ?? null
  }, [timeline, playerOptions])

  const playerId = manualPlayerId ?? defaultPlayerId

  // 当前玩家用过的技能 ID 集合（用于初始化选中状态）
  const defaultSelectedActionIds = useMemo(() => {
    if (!timeline || playerId == null) return new Set<number>()
    return new Set(timeline.castEvents.filter(c => c.playerId === playerId).map(c => c.actionId))
  }, [timeline, playerId])

  // 用户手动调整的技能选中状态（null 表示使用默认值）
  const [manualSelectedActionIds, setManualSelectedActionIds] = useState<Set<number> | null>(null)

  // 玩家切换时重置手动选中状态
  const selectedActionIds = manualSelectedActionIds ?? defaultSelectedActionIds

  if (!timeline) return null

  const hasCasts = timeline.castEvents.length > 0

  return (
    <Modal open={open} onClose={onClose} maxWidth="lg">
      <ModalContent>
        <ModalHeader>
          <ModalTitle>导出 Souma 时间轴</ModalTitle>
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
                  setManualPlayerId(Number(v))
                  setManualSelectedActionIds(null)
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择玩家" />
                </SelectTrigger>
                <SelectContent>
                  {playerOptions.map(p => (
                    <SelectItem key={p.id} value={p.id.toString()}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* 技能图标网格（仅列出该玩家用过的技能） */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">技能</label>
              {(() => {
                if (playerId == null) return null
                const usedIds = Array.from(
                  new Set(
                    timeline.castEvents.filter(c => c.playerId === playerId).map(c => c.actionId)
                  )
                )
                const actions = usedIds
                  .map(id => MITIGATION_DATA.actions.find(a => a.id === id))
                  .filter((a): a is NonNullable<typeof a> => a != null)

                if (actions.length === 0) {
                  return <div className="text-xs text-muted-foreground">该玩家未使用任何技能</div>
                }

                return (
                  <div className="flex flex-wrap gap-2">
                    {actions.map(action => {
                      const selected = selectedActionIds.has(action.id)
                      return (
                        <button
                          key={action.id}
                          type="button"
                          onClick={() => {
                            setManualSelectedActionIds(prev => {
                              const base = prev ?? defaultSelectedActionIds
                              const next = new Set(base)
                              if (next.has(action.id)) next.delete(action.id)
                              else next.add(action.id)
                              return next
                            })
                          }}
                          className={cn(
                            'relative h-10 w-10 overflow-hidden rounded-md border transition',
                            selected
                              ? 'border-primary ring-1 ring-primary'
                              : 'border-border opacity-40 grayscale hover:opacity-70'
                          )}
                          title={action.name}
                        >
                          <img
                            src={getIconUrl(action.icon)}
                            alt={action.name}
                            className="h-full w-full object-cover"
                          />
                          {selected && (
                            <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-green-500 text-[10px] font-bold leading-none text-white shadow">
                              ✓
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )
              })()}
            </div>

            {/* TTS 开关 */}
            <div className="flex items-center justify-between pt-1">
              <label htmlFor="souma-tts-switch" className="text-sm font-medium">
                启用 TTS 播报
              </label>
              <Switch id="souma-tts-switch" checked={ttsEnabled} onCheckedChange={setTtsEnabled} />
            </div>
          </div>
        )}

        <ModalFooter>
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
