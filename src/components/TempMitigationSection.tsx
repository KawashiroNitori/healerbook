/**
 * 临时减伤 section（仅编辑模式）
 * 在伤害事件属性面板「预估减伤效果」下方，允许为单个事件临时附加盾/百分比减伤。
 */

import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { generateObjectId } from '@/utils/shortId'
import { useTimelineStore } from '@/store/timelineStore'
import { useEditorReadOnly } from '@/hooks/useEditorReadOnly'
import type { DamageEvent, TempMitigation, TempMitigationType } from '@/types/timeline'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface TempMitigationSectionProps {
  event: DamageEvent
}

export default function TempMitigationSection({ event }: TempMitigationSectionProps) {
  const updateDamageEvent = useTimelineStore(s => s.updateDamageEvent)
  const isReadOnly = useEditorReadOnly()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState<TempMitigationType>('percent')
  const [value, setValue] = useState('')

  if (isReadOnly) return null

  const items = event.tempMitigations ?? []

  const resetForm = () => {
    setName('')
    setType('percent')
    setValue('')
  }

  const handleAdd = () => {
    const trimmed = name.trim()
    if (!trimmed || value.trim() === '') return
    const num = Number(value)
    if (!Number.isFinite(num)) return
    const clamped =
      type === 'percent' ? Math.min(100, Math.max(0, num)) : Math.max(0, Math.round(num))
    const item: TempMitigation = { id: generateObjectId(), name: trimmed, type, value: clamped }
    updateDamageEvent(event.id, { tempMitigations: [...items, item] })
    resetForm()
    setDialogOpen(false)
  }

  const handleDelete = (id: string) => {
    updateDamageEvent(event.id, {
      tempMitigations: items.filter(t => t.id !== id),
    })
  }

  const formatAmount = (t: TempMitigation) =>
    t.type === 'percent' ? `-${t.value}%` : `盾 ${t.value.toLocaleString()}`

  return (
    <div className="pt-3 border-t space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">临时减伤</h3>
        <button
          onClick={() => setDialogOpen(true)}
          className="p-1 hover:bg-accent rounded transition-colors"
          aria-label="添加临时减伤"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">暂无临时减伤</p>
      ) : (
        <div className="space-y-1">
          {items.map(t => (
            <div key={t.id} className="flex items-center gap-2 text-xs">
              <span className="flex-1 truncate">{t.name}</span>
              <span className="tabular-nums text-green-500 font-medium">{formatAmount(t)}</span>
              <button
                onClick={() => handleDelete(t.id)}
                className="p-1 hover:bg-destructive/10 hover:text-destructive rounded transition-colors"
                aria-label={`删除 ${t.name}`}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <Dialog
        open={dialogOpen}
        onOpenChange={open => {
          if (!open) resetForm()
          setDialogOpen(open)
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>添加临时减伤</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">名称</label>
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="临时减伤名称"
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">减伤类型</label>
              <Select value={type} onValueChange={v => setType(v as TempMitigationType)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percent">百分比</SelectItem>
                  <SelectItem value="shield">盾</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">
                {type === 'percent' ? '减伤效果（百分比）' : '减伤效果（盾量）'}
              </label>
              <div className="relative">
                <Input
                  type="number"
                  min={0}
                  max={type === 'percent' ? 100 : undefined}
                  step={1}
                  value={value}
                  onChange={e => setValue(e.target.value)}
                  placeholder={type === 'percent' ? '如 20' : '如 30000'}
                  className={type === 'percent' ? 'pr-7' : undefined}
                />
                {type === 'percent' && (
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    %
                  </span>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <button
              onClick={handleAdd}
              className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              添加
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
