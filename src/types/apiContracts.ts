/**
 * 前后端共享的 API 契约类型 —— 各端点请求/响应形状的唯一来源。
 *
 * Workers 路由构造响应时显式标注这些类型，前端 api 客户端以同一类型解析，
 * 使两端字段漂移在编译期暴露。D1 行影子类型（snake_case）与 KV 持久化结构
 * 不属于契约，留在各自模块内部。
 */

import type { Composition, DamageEvent, Timeline } from './timeline'

/** GET /api/my/timelines 的列表项 */
export interface MyTimelineListItem {
  id: string
  name: string
  publishedAt: number
  updatedAt: number
  /** 服务端已对旧格式 content.c 做归一化 */
  composition: Composition | null
}

/** GET /api/timelines/:id 的角色子集（EditorPage/EditorToolbar 透传用） */
export interface ShareRoleInfo {
  role: 'editor' | 'viewer'
  isAuthor: boolean
  allowEditRequests: boolean
  hasPendingRequest: boolean
}

/** GET /api/timelines/:id 的完整角色化响应 */
export interface SharedTimelineResponse extends ShareRoleInfo {
  authorName: string
  /** 作者视角:当前待处理的申请数;非作者恒 0 */
  pendingRequestCount: number
  /** KV snapshot;三角色通用。editor/author 用于首屏兜底渲染,KV miss 时为 undefined */
  snapshot?: Timeline
}

/**
 * 排行榜单条目
 */
export interface RankingEntry {
  rank: number
  characterName: string
  jobClass: string
  characterNameTwo: string
  jobClassTwo: string
  /** 合计 DPS（healercombineddps） */
  amount: number
  /** 战斗时长（毫秒） */
  duration: number
  reportCode: string
  fightID: number
  startTime: number
  serverName: string
  serverRegion: string
  serverNameTwo: string
  /** 按标准职业顺序排列的完整阵容职业代码列表 */
  composition: string[]
}

/** KV 中存储的 TOP100 数据结构 */
export interface Top100Data {
  encounterId: number
  encounterName: string
  entries: RankingEntry[]
  /** ISO 8601 时间戳 */
  updatedAt: string
}

/** GET /api/top100 的响应体：encounterId → 数据；KV 未同步时为 null。
 *  JSON 序列化后对象 key 实为字符串，Record<number, ...> 是语义标注，结构兼容。 */
export type Top100AllResponse = Record<number, Top100Data | null>

/** GET /api/encounter-templates/:encounterId 的响应体（不含 encounterId，由调用方自行持有） */
export interface EncounterTemplateResponse {
  events: DamageEvent[]
  updatedAt: string | null
  /** 模板来源战斗的时长（毫秒），即当前进度最长那次；无模板时为 null */
  templateSourceDurationMs: number | null
  /** 模板来源战斗是否为击杀；为 true 时前端显示"已更新完成"而非时长进度条 */
  kill: boolean
}
