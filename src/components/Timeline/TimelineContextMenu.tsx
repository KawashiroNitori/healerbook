/**
 * 时间轴右键上下文菜单
 */

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { DamageEvent } from '@/types/timeline'

export type ContextMenuState =
  | {
      x: number
      y: number
      time: number
      type: 'castEvent'
      castEventId: string
      actionId: number
    }
  | {
      x: number
      y: number
      time: number
      type: 'skillTrackEmpty'
      actionId: number
    }
  | {
      x: number
      y: number
      time: number
      type: 'damageEvent'
      eventId: string
    }
  | {
      x: number
      y: number
      time: number
      type: 'damageTrackEmpty'
    }

export type DamageEventClipboard = Omit<DamageEvent, 'id' | 'time'> | null

interface TimelineContextMenuProps {
  menu: ContextMenuState | null
  clipboard: DamageEventClipboard
  onClose: () => void
  onDeleteCast: (castEventId: string) => void
  onAddCast: (actionId: number, time: number) => void
  onEditDamageEvent: (eventId: string) => void
  onCopyDamageEvent: (eventId: string) => void
  onDeleteDamageEvent: (eventId: string) => void
  onAddDamageEvent: (time: number) => void
  onPasteDamageEvent: (time: number) => void
}

export default function TimelineContextMenu({
  menu,
  clipboard,
  onClose,
  onDeleteCast,
  onAddCast,
  onEditDamageEvent,
  onCopyDamageEvent,
  onDeleteDamageEvent,
  onAddDamageEvent,
  onPasteDamageEvent,
}: TimelineContextMenuProps) {
  if (!menu) return null

  const handleOpenChange = (open: boolean) => {
    if (!open) onClose()
  }

  return (
    <DropdownMenu open={true} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <div
          className="fixed pointer-events-none"
          style={{ left: menu.x, top: menu.y, width: 1, height: 1 }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="bottom" className="min-w-[140px]">
        {menu.type === 'castEvent' && (
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => {
              onDeleteCast(menu.castEventId)
              onClose()
            }}
          >
            删除
          </DropdownMenuItem>
        )}

        {menu.type === 'skillTrackEmpty' && (
          <DropdownMenuItem
            onClick={() => {
              onAddCast(menu.actionId, menu.time)
              onClose()
            }}
          >
            添加
          </DropdownMenuItem>
        )}

        {menu.type === 'damageEvent' && (
          <>
            <DropdownMenuItem
              onClick={() => {
                onEditDamageEvent(menu.eventId)
                onClose()
              }}
            >
              编辑属性
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                onCopyDamageEvent(menu.eventId)
                onClose()
              }}
            >
              复制
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => {
                onDeleteDamageEvent(menu.eventId)
                onClose()
              }}
            >
              删除
            </DropdownMenuItem>
          </>
        )}

        {menu.type === 'damageTrackEmpty' && (
          <>
            <DropdownMenuItem
              onClick={() => {
                onAddDamageEvent(menu.time)
                onClose()
              }}
            >
              添加伤害事件
            </DropdownMenuItem>
            {clipboard && (
              <DropdownMenuItem
                onClick={() => {
                  onPasteDamageEvent(menu.time)
                  onClose()
                }}
              >
                粘贴伤害事件
              </DropdownMenuItem>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
