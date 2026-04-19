/**
 * 预设管理对话框：列表 + 拖拽排序 + 新建 / 编辑 / 删除入口。
 */

import { useState } from 'react'
import { Plus } from 'lucide-react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalFooter } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { useFilterStore } from '@/store/filterStore'
import SortablePresetRow from './SortablePresetRow'
import EditPresetDialog from './EditPresetDialog'
import type { FilterPreset } from '@/types/filter'

interface Props {
  open: boolean
  onClose: () => void
}

export default function ManagePresetsDialog({ open, onClose }: Props) {
  const customPresets = useFilterStore(s => s.customPresets)
  const reorderPresets = useFilterStore(s => s.reorderPresets)
  const deletePreset = useFilterStore(s => s.deletePreset)

  const [editingPreset, setEditingPreset] = useState<FilterPreset | undefined>(undefined)
  const [editDialogOpen, setEditDialogOpen] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = customPresets.findIndex(p => p.id === active.id)
    const to = customPresets.findIndex(p => p.id === over.id)
    if (from < 0 || to < 0) return
    reorderPresets(from, to)
  }

  const openNew = () => {
    setEditingPreset(undefined)
    setEditDialogOpen(true)
  }

  const openEdit = (preset: FilterPreset) => {
    setEditingPreset(preset)
    setEditDialogOpen(true)
  }

  return (
    <>
      <Modal open={open} onClose={onClose}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>管理预设</ModalTitle>
          </ModalHeader>

          <div className="space-y-2 py-2">
            {customPresets.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">暂无自定义预设</div>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={customPresets.map(p => p.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-1.5">
                    {customPresets.map(preset => (
                      <SortablePresetRow
                        key={preset.id}
                        preset={preset}
                        onEdit={() => openEdit(preset)}
                        onDelete={() => deletePreset(preset.id)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </div>

          <ModalFooter>
            <Button variant="outline" onClick={onClose}>
              关闭
            </Button>
            <Button onClick={openNew}>
              <Plus className="w-4 h-4 mr-1" />
              新增预设
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {editDialogOpen && (
        <EditPresetDialog
          open={editDialogOpen}
          onClose={() => setEditDialogOpen(false)}
          preset={editingPreset}
        />
      )}
    </>
  )
}
