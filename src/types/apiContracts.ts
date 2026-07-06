/**
 * 前后端共享的 API 契约类型 —— 各端点请求/响应形状的唯一来源。
 *
 * Workers 路由构造响应时显式标注这些类型，前端 api 客户端以同一类型解析，
 * 使两端字段漂移在编译期暴露。D1 行影子类型（snake_case）与 KV 持久化结构
 * 不属于契约，留在各自模块内部。
 */

import type { Composition } from './timeline'

/** GET /api/my/timelines 的列表项 */
export interface MyTimelineListItem {
  id: string
  name: string
  publishedAt: number
  updatedAt: number
  /** 服务端已对旧格式 content.c 做归一化 */
  composition: Composition | null
}
