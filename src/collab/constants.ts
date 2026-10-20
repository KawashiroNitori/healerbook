/** Y.Doc 顶层 Map 名 —— 见设计文档 §4 */
export const Y_MAP = {
  meta: 'meta',
  damageEvents: 'damageEvents',
  castEvents: 'castEvents',
  annotations: 'annotations',
  phases: 'phases',
  composition: 'composition',
  statData: 'statData',
} as const

/** 本地 Y.Doc 事务 origin 标记 */
export const LOCAL_ORIGIN = 'local'

/**
 * 远端(DO)来的 Y.Doc 事务 origin。
 * 与 `LOCAL_ORIGIN` 区分:`UndoManager` 不跟踪它(不能撤销协作者的编辑),
 * 但引擎仍把它落本地 IndexedDB(离线缓存)。
 */
export const REMOTE_ORIGIN = 'remote'

/**
 * 解除回放模式专用事务 origin。
 * 与 `LOCAL_ORIGIN` 区分,使 `UndoManager` 不跟踪——解除回放不可撤销。
 */
export const EXIT_REPLAY_ORIGIN = 'exit-replay'

/** 初始化/维护类写入的 Y.Doc 事务 origin —— 不被 UndoManager 跟踪 */
export const HOUSEKEEPING_ORIGIN = 'housekeeping'

/** IndexedDB 数据库名与对象仓库名 */
export const IDB_NAME = 'healerbook_collab'
export const IDB_VERSION = 2
export const IDB_STORE_SNAPSHOTS = 'snapshots'
export const IDB_STORE_UPDATES = 'updates'
export const IDB_STORE_META = 'meta'

/** 客户端惰性 squash 阈值:updates 条数超过即合并 */
export const CLIENT_SQUASH_THRESHOLD = 100
