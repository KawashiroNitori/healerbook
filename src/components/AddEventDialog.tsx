/**
 * 添加伤害事件对话框
 */

import { useState } from 'react'
import { useTimelineStore } from '@/store/timelineStore'
import { toast } from 'sonner'
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalFooter } from '@/components/ui/modal'

interface AddEventDialogProps {
  open: boolean
  onClose: () => void
}

export default function AddEventDialog({ open, onClose }: AddEventDialogProps) {
  const { addDamageEvent } = useTimelineStore()
  const [name, setName] = useState('')
  const [time, setTime] = useState(0)
  const [damage, setDamage] = useState(100000)
  const [type, setType] = useState<'aoe' | 'tankbuster' | 'raidwide'>('raidwide')
  const [damageType, setDamageType] = useState<'physical' | 'magical' | 'special'>('magical')

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
      phaseId: '',
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
              onChange={(e) => setName(e.target.value)}
              placeholder="例如: 全屏 AOE"
              className="w-full px-3 py-2 border rounded-md"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">时间 (秒)</label>
            <input
              type="number"
              value={time}
              onChange={(e) => setTime(parseFloat(e.target.value) || 0)}
              className="w-full px-3 py-2 border rounded-md"
              step="0.1"
              min="0"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">伤害值</label>
            <input
              type="number"
              value={damage}
              onChange={(e) => setDamage(parseInt(e.target.value) || 0)}
              className="w-full px-3 py-2 border rounded-md"
              min="0"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">攻击类型</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as 'aoe' | 'tankbuster' | 'raidwide')}
              className="w-full px-3 py-2 border rounded-md"
            >
              <option value="raidwide">全团伤害</option>
              <option value="aoe">AOE</option>
              <option value="tankbuster">死刑</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">伤害类型</label>
            <select
              value={damageType}
              onChange={(e) => setDamageType(e.target.value as 'physical' | 'magical' | 'special')}
              className="w-full px-3 py-2 border rounded-md"
            >
              <option value="physical">物理</option>
              <option value="magical">魔法</option>
              <option value="special">特殊</option>
            </select>
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
