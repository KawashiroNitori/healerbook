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
import type { AnnotationAnchor } from '@/types/timeline'
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
  | {
      x: number
      y: number
      time: number
      type: 'multiSelection'
      count: number
    }

interface TimelineContextMenuProps {
  menu: ContextMenuState | null
  isReadOnly: boolean
  onClose: () => void
  onDeleteCast: (castEventId: string) => void
  onAddCast: (actionId: number, playerId: number, time: number) => void
  onCopyDamageEventText: (eventId: string) => void
  onCopyDamageEvent: (eventId: string) => void
  onDeleteDamageEvent: (eventId: string) => void
  onAddDamageEvent: (time: number) => void
  onAddAnnotation: (time: number, anchor: AnnotationAnchor) => void
  onEditAnnotation: (annotationId: string) => void
  onDeleteAnnotation: (annotationId: string) => void
  onCopySelection?: () => void
  onDeleteSelection: () => void
  /** 粘贴可用性：'checking' | true | false；控制空白菜单粘贴项 */
  pasteAvailable?: 'checking' | boolean
  onPasteSelection?: (time: number) => void
  /** 全选时间轴所有对象（空白处菜单项） */
  onSelectAll?: () => void
  /** 全选当前过滤器下可见的所有伤害事件（伤害区菜单项） */
  onSelectAllDamageEvents?: () => void
  /** 全选当前过滤器下可见的所有技能 cast（技能区菜单项） */
  onSelectAllCasts?: () => void
}

export default function TimelineContextMenu({
  menu,
  isReadOnly,
  onClose,
  onDeleteCast,
  onAddCast,
  onCopyDamageEventText,
  onCopyDamageEvent,
  onDeleteDamageEvent,
  onAddDamageEvent,
  onAddAnnotation,
  onEditAnnotation,
  onDeleteAnnotation,
  onCopySelection,
  onDeleteSelection,
  pasteAvailable,
  onPasteSelection,
  onSelectAll,
  onSelectAllDamageEvents,
  onSelectAllCasts,
}: TimelineContextMenuProps) {
  if (!menu) return null

  // 只读模式下仅保留可读操作的菜单：伤害事件（复制文本/复制）与多选（复制）
  if (isReadOnly && menu.type !== 'damageEvent' && menu.type !== 'multiSelection') return null

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
          <>
            <DropdownMenuItem
              onClick={() => {
                onAddAnnotation(menu.time, { type: 'cast', castId: menu.castEventId })
                onClose()
              }}
            >
              在此技能上添加备注
            </DropdownMenuItem>
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
          </>
        )}

        {menu.type === 'multiSelection' && (
          <>
            <DropdownMenuItem
              onClick={() => {
                onCopySelection?.()
                onClose()
              }}
            >
              复制全部
              <DropdownMenuShortcut>{modKey}C</DropdownMenuShortcut>
            </DropdownMenuItem>
            {!isReadOnly && (
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => {
                  onDeleteSelection()
                  onClose()
                }}
              >
                删除全部
                <DropdownMenuShortcut>{deleteKeyLabel}</DropdownMenuShortcut>
              </DropdownMenuItem>
            )}
          </>
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
              添加备注
            </DropdownMenuItem>
            {onPasteSelection && (
              <DropdownMenuItem
                disabled={pasteAvailable !== true}
                onClick={() => {
                  onPasteSelection(menu.time)
                  onClose()
                }}
              >
                粘贴{pasteAvailable === 'checking' ? '…' : ''}
                <DropdownMenuShortcut>{modKey}V</DropdownMenuShortcut>
              </DropdownMenuItem>
            )}
            {onSelectAll && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    onSelectAll()
                    onClose()
                  }}
                >
                  全选
                  <DropdownMenuShortcut>{modKey}A</DropdownMenuShortcut>
                </DropdownMenuItem>
                {onSelectAllCasts && (
                  <DropdownMenuItem
                    onClick={() => {
                      onSelectAllCasts()
                      onClose()
                    }}
                  >
                    全选技能
                  </DropdownMenuItem>
                )}
              </>
            )}
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
            <DropdownMenuItem
              onClick={() => {
                onAddAnnotation(menu.time, { type: 'damageTrack' })
                onClose()
              }}
            >
              添加备注
            </DropdownMenuItem>
            {onPasteSelection && (
              <DropdownMenuItem
                disabled={pasteAvailable !== true}
                onClick={() => {
                  onPasteSelection(menu.time)
                  onClose()
                }}
              >
                粘贴{pasteAvailable === 'checking' ? '…' : ''}
                <DropdownMenuShortcut>{modKey}V</DropdownMenuShortcut>
              </DropdownMenuItem>
            )}
            {onSelectAll && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    onSelectAll()
                    onClose()
                  }}
                >
                  全选
                  <DropdownMenuShortcut>{modKey}A</DropdownMenuShortcut>
                </DropdownMenuItem>
                {onSelectAllDamageEvents && (
                  <DropdownMenuItem
                    onClick={() => {
                      onSelectAllDamageEvents()
                      onClose()
                    }}
                  >
                    全选伤害事件
                  </DropdownMenuItem>
                )}
              </>
            )}
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
