/**
 * 单条可拖拽的预设行。
 */

import { GripVertical, Pencil, Trash2 } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button } from '@/components/ui/button'
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

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
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
      <Button
        size="sm"
        variant="ghost"
        className="h-7 w-7 p-0 text-destructive hover:text-destructive"
        onClick={onDelete}
        aria-label="删除"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}
