/**
 * 添加伤害事件对话框
 */

import { useState } from 'react'
import { DAMAGE_EVENT_NAME_MAX_LENGTH } from '@/constants/limits'
import { useTimelineStore } from '@/store/timelineStore'
import { toast } from 'sonner'
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalFooter } from '@/components/ui/modal'
import { TimeInput } from '@/components/ui/time-input'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DAMAGE_EVENT_TYPES,
  DAMAGE_EVENT_TYPE_LABELS,
  type DamageType,
  type DamageEventType,
} from '@/types/timeline'

interface AddEventDialogProps {
  open: boolean
  onClose: () => void
  defaultTime?: number
}

export default function AddEventDialog({ open, onClose, defaultTime = 0 }: AddEventDialogProps) {
  const { addDamageEvent } = useTimelineStore()
  const [name, setName] = useState('')
  const [time, setTime] = useState(defaultTime)
  const [damage, setDamage] = useState(100000)
  const [type, setType] = useState<DamageEventType>('aoe')
  const [damageType, setDamageType] = useState<DamageType>('magical')
  const [isDot, setIsDot] = useState(false)
  const [snapshotTime, setSnapshotTime] = useState(defaultTime)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!name.trim()) {
      toast.error('请输入事件名称')
      return
    }

    addDamageEvent({
      id: `event-${Date.now()}`,
      name: name.trim(),
      time,
      damage,
      type,
      damageType,
      snapshotTime: isDot ? snapshotTime : undefined,
    })

    toast.success('事件已添加')
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>添加伤害事件</ModalTitle>
        </ModalHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              事件名称 <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={DAMAGE_EVENT_NAME_MAX_LENGTH}
              placeholder="例如: 全屏 AOE"
              className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">时间</label>
            <TimeInput value={time} onChange={setTime} min={-30} />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">伤害值</label>
            <input
              type="number"
              value={damage}
              onChange={e => setDamage(parseInt(e.target.value) || 0)}
              className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground"
              min="0"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">攻击类型</label>
            <Select value={type} onValueChange={v => setType(v as DamageEventType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="item-aligned">
                {DAMAGE_EVENT_TYPES.map(t => (
                  <SelectItem key={t} value={t}>
                    {DAMAGE_EVENT_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">伤害类型</label>
            <Select value={damageType} onValueChange={v => setDamageType(v as DamageType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="item-aligned">
                <SelectItem value="physical">物理</SelectItem>
                <SelectItem value="magical">魔法</SelectItem>
                <SelectItem value="darkness">特殊</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2 h-8">
            <Switch
              checked={isDot}
              onCheckedChange={checked => {
                setIsDot(checked)
                if (checked) setSnapshotTime(time)
              }}
            />
            <span className="text-sm">DoT</span>
            {isDot && (
              <>
                <span className="text-xs text-muted-foreground shrink-0 ml-auto">快照时刻</span>
                <TimeInput
                  value={snapshotTime}
                  onChange={setSnapshotTime}
                  min={-30}
                  className="w-[calc(50%-6px)]"
                />
              </>
            )}
          </div>

          <ModalFooter>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border rounded-md hover:bg-accent transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
            >
              添加
            </button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  )
}
