/**
 * 导入到当前时间轴 —— 2 步 wizard
 *
 * Step 1: 选择来源（FFLogs 战斗 / 副本模板）+ 输入数据 + 解析
 * Step 2: 配置导入（数据类型 / 时间范围 / 实时预览 / 确认导入）
 *
 * 详见 design/superpowers/specs/2026-05-29-editor-import-design.md
 */

import { Modal, ModalHeader, ModalTitle, ModalFooter } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'

interface ImportIntoTimelineDialogProps {
  open: boolean
  onClose: () => void
}

export default function ImportIntoTimelineDialog({ open, onClose }: ImportIntoTimelineDialogProps) {
  return (
    <Modal open={open} onClose={onClose}>
      <div className="px-6 pt-6 pb-4">
        <ModalHeader className="mb-0">
          <ModalTitle>导入到当前时间轴</ModalTitle>
        </ModalHeader>
      </div>

      <div className="px-6 py-3 border-b text-sm text-muted-foreground">
        ① 选择来源 → ② 配置导入
      </div>

      <div className="px-6 py-8 min-h-[200px]">
        <p className="text-sm text-muted-foreground">（占位：后续任务填充）</p>
      </div>

      <div className="px-6 pb-6">
        <ModalFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
        </ModalFooter>
      </div>
    </Modal>
  )
}
