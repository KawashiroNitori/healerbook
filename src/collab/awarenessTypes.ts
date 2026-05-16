/** 一个协作者的 awareness 临时态 —— 不进 Y.Doc、不持久化。见 awareness spec §2。 */
export interface AwarenessState {
  user: {
    /** 用户 id(FFLogs userId)—— header 头像按它去重 */
    id: string
    /** 昵称 */
    name: string
    /** 颜色(取自 COLOR_PALETTE) */
    color: string
  }
  /** 当前选中的事件;未选中各字段为 null */
  selection: { eventId: string | null; castEventId: string | null }
  /** 鼠标悬停对应的时间轴时间(秒);不在画布上为 null */
  cursorTime: number | null
  /** 正在拖动的对象 ghost;未拖动为 null */
  dragging: {
    id: string
    kind: 'damage' | 'cast' | 'annotation'
    /** ghost 当前时间(秒) */
    time: number
    /** cast 的目标轨道玩家;damage / annotation 恒为 null */
    playerId: number | null
  } | null
}

/** store 投影给 UI 的他人状态(附 Yjs clientID) */
export interface PeerState extends AwarenessState {
  clientId: number
}
