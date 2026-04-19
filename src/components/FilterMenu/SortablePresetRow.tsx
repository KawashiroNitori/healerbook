/**
 * 单条可拖拽的预设行。
 */

import { useState } from 'react'
import { GripVertical, Pencil, Trash2 } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { FilterPreset } from '@/types/filter'

interface Props {
  preset: FilterPreset
  onEdit: () => void
  onDelete: () => void
}

export default function SortablePresetRow({ preset, onEdit, onDelete }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: preset.id,
  })

  const [confirmOpen, setConfirmOpen] = useState(false)

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const handleConfirm = () => {
    setConfirmOpen(false)
    onDelete()
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 px-2 py-1.5 rounded-md border bg-background"
    >
      <button
        type="button"
        className="cursor-grab text-muted-foreground hover:text-foreground"
        {...attributes}
        {...listeners}
        aria-label="拖动"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="flex-1 text-sm truncate">{preset.name}</span>
      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onEdit} aria-label="编辑">
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      <Popover open={confirmOpen} onOpenChange={setConfirmOpen}>
        <PopoverTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
            aria-label="删除"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent side="bottom" align="end" className="w-auto p-3 space-y-2">
          <p className="text-sm">确认删除？</p>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => setConfirmOpen(false)}>
              取消
            </Button>
            <Button variant="destructive" size="sm" onClick={handleConfirm}>
              删除
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
