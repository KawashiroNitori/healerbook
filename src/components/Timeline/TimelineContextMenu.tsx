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
import { useTranslation } from 'react-i18next'
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
  /**
   * castEvent 菜单：该 cast 已有的备注 id（一个 cast 至多一条）。
   * 有值时菜单项显示「编辑备注」走 onEditAnnotation，否则显示「给技能添加备注」走 onAddAnnotation。
   */
  castAnnotationId?: string | null
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
  castAnnotationId = null,
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
  const { t } = useTranslation(['editor', 'common'])
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
            {/* 一个 cast 只允许一条备注：已有则改为编辑（原地更新），无则新增 */}
            <DropdownMenuItem
              onClick={() => {
                if (castAnnotationId) {
                  onEditAnnotation(castAnnotationId)
                } else {
                  onAddAnnotation(menu.time, { type: 'cast', castId: menu.castEventId })
                }
                onClose()
              }}
            >
              {castAnnotationId
                ? t('editor:contextMenu.editAnnotation')
                : t('editor:contextMenu.addCastAnnotation')}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => {
                onDeleteCast(menu.castEventId)
                onClose()
              }}
            >
              {t('editor:contextMenu.delete')}
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
              {t('editor:contextMenu.copyAll')}
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
                {t('editor:contextMenu.deleteAll')}
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
              {t('editor:contextMenu.add')}
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
              {t('editor:contextMenu.addAnnotation')}
            </DropdownMenuItem>
            {onPasteSelection && (
              <DropdownMenuItem
                disabled={pasteAvailable !== true}
                onClick={() => {
                  onPasteSelection(menu.time)
                  onClose()
                }}
              >
                {t('editor:contextMenu.paste')}
                {pasteAvailable === 'checking' ? '…' : ''}
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
                  {t('editor:contextMenu.selectAll')}
                  <DropdownMenuShortcut>{modKey}A</DropdownMenuShortcut>
                </DropdownMenuItem>
                {onSelectAllCasts && (
                  <DropdownMenuItem
                    onClick={() => {
                      onSelectAllCasts()
                      onClose()
                    }}
                  >
                    {t('editor:contextMenu.selectAllCasts')}
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
              {t('editor:contextMenu.copyText')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                onCopyDamageEvent(menu.eventId)
                onClose()
              }}
            >
              {t('common:copy')}
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
                  {t('editor:contextMenu.delete')}
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
              {t('editor:contextMenu.add')}
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
              {t('editor:contextMenu.addAnnotation')}
            </DropdownMenuItem>
            {onPasteSelection && (
              <DropdownMenuItem
                disabled={pasteAvailable !== true}
                onClick={() => {
                  onPasteSelection(menu.time)
                  onClose()
                }}
              >
                {t('editor:contextMenu.paste')}
                {pasteAvailable === 'checking' ? '…' : ''}
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
                  {t('editor:contextMenu.selectAll')}
                  <DropdownMenuShortcut>{modKey}A</DropdownMenuShortcut>
                </DropdownMenuItem>
                {onSelectAllDamageEvents && (
                  <DropdownMenuItem
                    onClick={() => {
                      onSelectAllDamageEvents()
                      onClose()
                    }}
                  >
                    {t('editor:contextMenu.selectAllDamageEvents')}
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
                {t('editor:contextMenu.edit')}
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
                {t('editor:contextMenu.delete')}
                <DropdownMenuShortcut>{deleteKeyLabel}</DropdownMenuShortcut>
              </DropdownMenuItem>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
