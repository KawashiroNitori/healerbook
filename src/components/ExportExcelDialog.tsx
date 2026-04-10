/**
 * 导出 Excel 设置对话框
 */

import { useState, useEffect, useMemo } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { saveAs } from 'file-saver'
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalFooter } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { useTimelineStore } from '@/store/timelineStore'
import { useUIStore } from '@/store/uiStore'
import { useMitigationStore } from '@/store/mitigationStore'
import { useDamageCalculationResults } from '@/contexts/DamageCalculationContext'
import { deriveSkillTracks } from '@/utils/skillTracks'
import { sortJobsByOrder, getJobName } from '@/data/jobs'
import { exportTimelineToExcel } from '@/utils/exportExcel'
import JobIcon from './JobIcon'

interface ExportExcelDialogProps {
  open: boolean
  onClose: () => void
}

export default function ExportExcelDialog({ open, onClose }: ExportExcelDialogProps) {
  const timeline = useTimelineStore(s => s.timeline)
  const globalHiddenPlayerIds = useUIStore(s => s.hiddenPlayerIds)
  const globalShowOriginalDamage = useUIStore(s => s.showOriginalDamage)
  const globalShowActualDamage = useUIStore(s => s.showActualDamage)
  const actions = useMitigationStore(s => s.actions)
  const calculationResults = useDamageCalculationResults()

  const [fileName, setFileName] = useState('')
  const [hiddenPlayerIds, setHiddenPlayerIds] = useState<Set<number>>(new Set())
  const [showOriginalDamage, setShowOriginalDamage] = useState(false)
  const [showActualDamage, setShowActualDamage] = useState(true)
  const [isExporting, setIsExporting] = useState(false)

  // 每次 open 变为 true 时，从全局状态初始化本地设置
  useEffect(() => {
    if (open && timeline) {
      setFileName(timeline.name || '减伤表')
      setHiddenPlayerIds(new Set(globalHiddenPlayerIds))
      setShowOriginalDamage(globalShowOriginalDamage)
      setShowActualDamage(globalShowActualDamage)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // 按职业顺序排列的玩家列表
  const sortedPlayers = useMemo(() => {
    if (!timeline?.composition?.players) return []
    return sortJobsByOrder(timeline.composition.players, p => p.job)
  }, [timeline])

  const actionsById = useMemo(() => {
    const map = new Map()
    for (const action of actions) {
      map.set(action.id, action)
    }
    return map
  }, [actions])

  const togglePlayer = (playerId: number) => {
    setHiddenPlayerIds(prev => {
      const next = new Set(prev)
      if (next.has(playerId)) {
        next.delete(playerId)
      } else {
        next.add(playerId)
      }
      return next
    })
  }

  const handleExport = async () => {
    if (!timeline) return

    const skillTracks = deriveSkillTracks(timeline.composition, hiddenPlayerIds, actions)

    setIsExporting(true)
    try {
      const buffer = await exportTimelineToExcel({
        timeline,
        calculationResults,
        skillTracks,
        actionsById,
        showOriginalDamage,
        showActualDamage,
        fileName,
      })

      const blob = new Blob([buffer as BlobPart], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      saveAs(blob, `${fileName}.xlsx`)
      toast.success('导出成功')
      onClose()
    } catch (err) {
      console.error('导出失败', err)
      toast.error('导出失败，请重试')
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} disableBackdropClick={isExporting}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>导出 Excel</ModalTitle>
        </ModalHeader>

        <div className="space-y-5">
          {/* 文件名 */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">文件名</label>
            <input
              type="text"
              value={fileName}
              onChange={e => setFileName(e.target.value)}
              disabled={isExporting}
              className="flex-1 w-full px-3 py-1.5 text-sm border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              placeholder="减伤表"
            />
          </div>

          {/* 导出阵容 */}
          {sortedPlayers.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-sm font-medium">导出阵容</div>
              <div className="rounded-md border border-border overflow-hidden">
                {sortedPlayers.map(player => {
                  const isVisible = !hiddenPlayerIds.has(player.id)
                  return (
                    <label
                      key={player.id}
                      className={`flex items-center gap-2 px-2 py-1 rounded hover:bg-muted/50 cursor-pointer select-none ${
                        isVisible ? '' : 'text-muted-foreground'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isVisible}
                        onChange={() => togglePlayer(player.id)}
                        disabled={isExporting}
                        className="h-4 w-4 rounded border-border accent-primary"
                      />
                      <JobIcon job={player.job} size="sm" />
                      <span className="text-sm">{getJobName(player.job)}</span>
                    </label>
                  )
                })}
              </div>
            </div>
          )}

          {/* 显示列开关 */}
          <div className="space-y-1.5">
            <div className="text-sm font-medium">显示列</div>
            <div className="flex items-center gap-6 px-2 py-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <Switch
                  checked={showOriginalDamage}
                  onCheckedChange={setShowOriginalDamage}
                  disabled={isExporting}
                />
                <span className="text-sm">原始伤害</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Switch
                  checked={showActualDamage}
                  onCheckedChange={setShowActualDamage}
                  disabled={isExporting}
                />
                <span className="text-sm">实际伤害</span>
              </label>
            </div>
          </div>
        </div>

        <ModalFooter>
          <Button variant="outline" onClick={onClose} disabled={isExporting}>
            取消
          </Button>
          <Button onClick={handleExport} disabled={isExporting || !timeline}>
            {isExporting ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                导出中…
              </>
            ) : (
              <>
                <Download className="mr-1.5 h-4 w-4" />
                导出
              </>
            )}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
