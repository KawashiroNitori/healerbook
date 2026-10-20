/**
 * 阶段删除确认（时间轴 / 表格 / 工具栏下拉共用）。
 *
 * 锚定在触发元素的屏幕矩形下方、右对齐；样式沿用过滤预设的删除确认。
 * 焦点默认在「删除」，Enter 确认、Esc 或点外部取消。
 */

import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'

export interface PhaseDeleteRequest {
  phaseId: string
  phaseName: string
  /** 触发元素的视口矩形 */
  anchor: DOMRect
}

interface PhaseDeleteConfirmProps {
  request: PhaseDeleteRequest | null
  onConfirm: (phaseId: string) => void
  onClose: () => void
}

export default function PhaseDeleteConfirm({
  request,
  onConfirm,
  onClose,
}: PhaseDeleteConfirmProps) {
  const { t } = useTranslation(['editor', 'common'])
  const deleteRef = useRef<HTMLButtonElement>(null)
  if (!request) return null
  const { anchor } = request

  return (
    <Popover open onOpenChange={open => !open && onClose()}>
      <PopoverAnchor asChild>
        <div
          className="fixed pointer-events-none"
          style={{
            left: anchor.left,
            top: anchor.top,
            width: Math.max(1, anchor.width),
            height: Math.max(1, anchor.height),
          }}
        />
      </PopoverAnchor>
      <PopoverContent
        side="bottom"
        align="end"
        className="w-auto p-3 space-y-2"
        // 供下拉菜单识别「点在确认框里」而不收起（删除后菜单保持展开）
        data-phase-delete-confirm=""
        onOpenAutoFocus={e => {
          e.preventDefault()
          deleteRef.current?.focus()
        }}
        // 焦点被宿主（如下拉菜单的悬停聚焦）移走时不关闭；Esc 与点击外部仍会关闭
        onFocusOutside={e => e.preventDefault()}
        // 阻止冒泡到时间轴容器：避免触发框选 / 取消选中
        onPointerDown={e => e.stopPropagation()}
        onClick={e => e.stopPropagation()}
      >
        <div>
          <p className="text-sm">{t('editor:phase.confirmDelete')}</p>
          <p className="mt-0.5 max-w-[220px] truncate text-xs text-muted-foreground">
            {request.phaseName}
          </p>
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>
            {t('common:cancel')}
          </Button>
          <Button
            ref={deleteRef}
            variant="destructive"
            size="sm"
            onClick={() => {
              onConfirm(request.phaseId)
              onClose()
            }}
          >
            {t('editor:contextMenu.delete')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
