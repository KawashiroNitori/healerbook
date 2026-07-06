/**
 * 前后端共享的 API 契约类型 —— 各端点请求/响应形状的唯一来源。
 *
 * Workers 路由构造响应时显式标注这些类型，前端 api 客户端以同一类型解析，
 * 使两端字段漂移在编译期暴露。D1 行影子类型（snake_case）与 KV 持久化结构
 * 不属于契约，留在各自模块内部。
 */

import type { Composition, Timeline } from './timeline'

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
