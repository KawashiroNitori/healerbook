/** Y.Doc 顶层 Map 名 —— 见设计文档 §4 */
export const Y_MAP = {
  meta: 'meta',
  damageEvents: 'damageEvents',
  castEvents: 'castEvents',
  annotations: 'annotations',
  composition: 'composition',
  statData: 'statData',
} as const

/** 本地 Y.Doc 事务 origin 标记 */
export const LOCAL_ORIGIN = 'local'

/** IndexedDB 数据库名与对象仓库名 */
export const IDB_NAME = 'healerbook_collab'
export const IDB_STORE_SNAPSHOTS = 'snapshots'
export const IDB_STORE_UPDATES = 'updates'

/** 客户端惰性 squash 阈值:updates 条数超过即合并 */
export const CLIENT_SQUASH_THRESHOLD = 100

/** 客户端迁移完成标志位(localStorage key) */
export const MIGRATION_FLAG = 'healerbook_collab_migrated_v1'
