/**
 * Konva 事件类型定义
 */

export interface KonvaMouseEvent {
  target: unknown
  evt: MouseEvent
}

export interface KonvaNode {
  attrs?: {
    draggable?: boolean
    draggableBackground?: boolean
  }
  parent?: unknown
  getClassName?: () => string
}

export interface KonvaStage {
  container: () => HTMLDivElement
  on: (event: string, handler: (e: KonvaMouseEvent) => void) => void
  off: (event: string, handler: (e: KonvaMouseEvent) => void) => void
}

export interface KonvaContextMenuEvent {
  evt: MouseEvent
}
