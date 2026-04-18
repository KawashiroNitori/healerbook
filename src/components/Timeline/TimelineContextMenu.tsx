/**
 * 时间轴右键上下文菜单
 */

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MousePointerClick } from 'lucide-react'
import type { DamageEvent, AnnotationAnchor } from '@/types/timeline'
import { modKey, deleteKeyLabel } from '@/utils/platform'

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
      playerId: number
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
  | {
      x: number
      y: number
      time: number
      type: 'annotation'
      annotationId: string
    }

export type DamageEventClipboard = Omit<DamageEvent, 'id' | 'time'> | null

interface TimelineContextMenuProps {
  menu: ContextMenuState | null
  clipboard: DamageEventClipboard
  isReadOnly: boolean
  onClose: () => void
  onDeleteCast: (castEventId: string) => void
  onAddCast: (actionId: number, playerId: number, time: number) => void
  onCopyDamageEventText: (eventId: string) => void
  onCopyDamageEvent: (eventId: string) => void
  onDeleteDamageEvent: (eventId: string) => void
  onAddDamageEvent: (time: number) => void
  onPasteDamageEvent: (time: number) => void
  onAddAnnotation: (time: number, anchor: AnnotationAnchor) => void
  onEditAnnotation: (annotationId: string) => void
  onDeleteAnnotation: (annotationId: string) => void
}

export default function TimelineContextMenu({
  menu,
  clipboard,
  isReadOnly,
  onClose,
  onDeleteCast,
  onAddCast,
  onCopyDamageEventText,
  onCopyDamageEvent,
  onDeleteDamageEvent,
  onAddDamageEvent,
  onPasteDamageEvent,
  onAddAnnotation,
  onEditAnnotation,
  onDeleteAnnotation,
}: TimelineContextMenuProps) {
  if (!menu) return null

  // 只读模式下，只有伤害事件有可用菜单项（复制文本、复制）
  if (isReadOnly && menu.type !== 'damageEvent') return null

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
      <DropdownMenuContent align="start" side="bottom" className="min-w-[120px] text-[11px]">
        {menu.type === 'castEvent' && (
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => {
              onDeleteCast(menu.castEventId)
              onClose()
            }}
          >
            删除
            <DropdownMenuShortcut>{deleteKeyLabel}</DropdownMenuShortcut>
          </DropdownMenuItem>
        )}

        {menu.type === 'skillTrackEmpty' && (
          <>
            <DropdownMenuItem
              onClick={() => {
                onAddCast(menu.actionId, menu.playerId, menu.time)
                onClose()
              }}
            >
              添加
              <DropdownMenuShortcut>
                <MousePointerClick className="size-3" />
              </DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                onAddAnnotation(menu.time, {
                  type: 'skillTrack',
                  playerId: menu.playerId,
                  actionId: menu.actionId,
                })
                onClose()
              }}
            >
              添加注释
            </DropdownMenuItem>
          </>
        )}

        {menu.type === 'damageEvent' && (
          <>
            <DropdownMenuItem
              onClick={() => {
                onCopyDamageEventText(menu.eventId)
                onClose()
              }}
            >
              复制文本
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                onCopyDamageEvent(menu.eventId)
                onClose()
              }}
            >
              复制
              <DropdownMenuShortcut>{modKey}C</DropdownMenuShortcut>
            </DropdownMenuItem>
            {!isReadOnly && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => {
                    onDeleteDamageEvent(menu.eventId)
                    onClose()
                  }}
                >
                  删除
                  <DropdownMenuShortcut>{deleteKeyLabel}</DropdownMenuShortcut>
                </DropdownMenuItem>
              </>
            )}
          </>
        )}

        {menu.type === 'damageTrackEmpty' && (
          <>
            <DropdownMenuItem
              disabled={menu.time < 0}
              onClick={() => {
                onAddDamageEvent(menu.time)
                onClose()
              }}
            >
              添加
              <DropdownMenuShortcut>
                <MousePointerClick className="size-3" />
              </DropdownMenuShortcut>
            </DropdownMenuItem>
            {clipboard && (
              <DropdownMenuItem
                onClick={() => {
                  onPasteDamageEvent(menu.time)
                  onClose()
                }}
              >
                粘贴
                <DropdownMenuShortcut>{modKey}V</DropdownMenuShortcut>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onClick={() => {
                onAddAnnotation(menu.time, { type: 'damageTrack' })
                onClose()
              }}
            >
              添加注释
            </DropdownMenuItem>
          </>
        )}
        {menu.type === 'annotation' && (
          <>
            {!isReadOnly && (
              <DropdownMenuItem
                onClick={() => {
                  onEditAnnotation(menu.annotationId)
                  onClose()
                }}
              >
                编辑
              </DropdownMenuItem>
            )}
            {!isReadOnly && (
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => {
                  onDeleteAnnotation(menu.annotationId)
                  onClose()
                }}
              >
                删除
                <DropdownMenuShortcut>{deleteKeyLabel}</DropdownMenuShortcut>
              </DropdownMenuItem>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
