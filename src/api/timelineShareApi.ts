/**
 * 时间轴共享 API 客户端
 */

import { HTTPError } from 'ky'
import { apiClient } from './apiClient'
import type { Timeline, Composition } from '@/types/timeline'
import { parseFromAny, serializeForServer } from '@/utils/timelineFormat'

export interface SharedTimelineResponse {
  timeline: Timeline
  authorName: string
  publishedAt: number
  version: number
  isAuthor: boolean
}

export interface PublishResult {
  id: string
  publishedAt: number
  version: number
}

export interface UpdateResult {
  id: string
  updatedAt: number
  version: number
}

export interface ConflictError {
  type: 'conflict'
  serverVersion: number
  serverUpdatedAt: number
}

/**
 * 首次发布时间轴
 */
export async function publishTimeline(timeline: Timeline): Promise<PublishResult> {
  try {
    return await apiClient
      .post('timelines', { json: { timeline: serializeForServer(timeline) } })
      .json<PublishResult>()
  } catch (err) {
    if (err instanceof HTTPError) {
      const body = await err.response.json<{ error?: string }>().catch(() => ({ error: undefined }))
      throw new Error(body.error ?? `HTTP ${err.response.status}`)
    }
    throw err
  }
}

/**
 * 更新已发布的时间轴
 * @param expectedVersion 提供时启用乐观锁冲突检测；省略则强制覆写
 */
export async function updateTimeline(
  id: string,
  timeline: Timeline,
  expectedVersion?: number
): Promise<UpdateResult | ConflictError> {
  const payload = {
    timeline: serializeForServer(timeline),
    ...(expectedVersion !== undefined ? { expectedVersion } : {}),
  }

  try {
    return await apiClient.put(`timelines/${id}`, { json: payload }).json<UpdateResult>()
  } catch (err) {
    if (err instanceof HTTPError && err.response.status === 409) {
      const body = await err.response.json<{ serverVersion: number; serverUpdatedAt: number }>()
      return {
        type: 'conflict',
        serverVersion: body.serverVersion,
        serverUpdatedAt: body.serverUpdatedAt,
      }
    }
    if (err instanceof HTTPError) {
      const body = await err.response.json<{ error?: string }>().catch(() => ({ error: undefined }))
      throw new Error(body.error ?? `HTTP ${err.response.status}`)
    }
    throw err
  }
}

export interface MyTimelineItem {
  id: string
  name: string
  publishedAt: number
  updatedAt: number
  version: number
  composition: Composition | null
}

/**
 * 获取当前登录用户的已发布时间轴列表
 */
export async function fetchMyTimelines(): Promise<MyTimelineItem[]> {
  try {
    return await apiClient.get('my/timelines').json<MyTimelineItem[]>()
  } catch (err) {
    if (err instanceof HTTPError && err.response.status === 401) return []
    throw err
  }
}

/**
 * 删除已发布的时间轴（仅作者）
 */
export async function deleteSharedTimeline(id: string): Promise<void> {
  try {
    await apiClient.delete(`timelines/${id}`)
  } catch (err) {
    if (err instanceof HTTPError) {
      const body = await err.response.json<{ error?: string }>().catch(() => ({ error: undefined }))
      throw new Error(body.error ?? `HTTP ${err.response.status}`)
    }
    throw err
  }
}

interface RawSharedTimelineResponse {
  timeline: unknown // raw JSON — may be V1 or V2
  authorName: string
  publishedAt: number
  version: number
  isAuthor: boolean
}

/**
 * 获取共享的时间轴（公开）
 * 若已登录，Worker 会根据 Authorization 头计算 isAuthor
 */
export async function fetchSharedTimeline(id: string): Promise<SharedTimelineResponse> {
  try {
    const raw = await apiClient.get(`timelines/${id}`).json<RawSharedTimelineResponse>()
    return {
      timeline: parseFromAny(raw.timeline, { id }),
      authorName: raw.authorName,
      publishedAt: raw.publishedAt,
      version: raw.version,
      isAuthor: raw.isAuthor,
    }
  } catch (err) {
    if (err instanceof HTTPError && err.response.status === 404) {
      throw new Error('NOT_FOUND')
    }
    if (err instanceof HTTPError) {
      throw new Error(`HTTP ${err.response.status}`)
    }
    throw err
  }
}
