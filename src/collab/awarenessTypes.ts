/** 协作者身份。线上只传 id + name；color 在解码端用 colorForUser(id) 重算。 */
export interface UserIdentity {
  /** 用户 id(FFLogs userId)—— header 头像按它去重 */
  id: string
  /** 昵称 */
  name: string
  /** 颜色(取自 COLOR_PALETTE) */
  color: string
}

/** 一个协作者的 awareness 临时态 —— 不进 Y.Doc、不持久化。见 awareness spec §2。 */
export interface AwarenessState {
  /**
   * 本地态不含 user(节省上行字节);广播态由服务端按 JWT 身份注入,故对端解出的
   * peer 必有 user。见 syncProtocol 的 encode/inject。
   */
  user?: UserIdentity
  /** 当前选中的对象 id 列表；未选中为空数组 */
  selection: { eventIds: string[]; castEventIds: string[]; annotationIds: string[] }
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

/** store 投影给 UI 的他人状态(附 Yjs clientID);peer 必有 user(reprojectPeers 已过滤无 user 者) */
export interface PeerState extends AwarenessState {
  clientId: number
  user: UserIdentity
}
