import type { Timeline } from '@/types/timeline'

/**
 * 进 Y.Doc 的协同内容 —— Timeline 去掉外部寻址 / 本地元数据 / 派生字段。
 * 见设计文档 §4、§10。
 */
export type TimelineContent = Omit<
  Timeline,
  | 'id'
  | 'isShared'
  | 'everPublished'
  | 'hasLocalChanges'
  | 'serverVersion'
  | 'statusEvents'
  | 'updatedAt'
>

/** 本地元数据 —— 不进 Y.Doc,由本地存储层管理 */
export interface LocalDocMeta {
  /** 时间轴 id(外部寻址键) */
  id: string
  /** 是否已发布(本阶段恒为 false) */
  published: boolean
  /** 本地最近修改时间(Unix 秒) */
  updatedAt: number
}
