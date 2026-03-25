/**
 * 时间轴分享 API 客户端
 */

import { HTTPError } from 'ky'
import { apiClient } from './apiClient'
import type { Timeline } from '@/types/timeline'

// 上传时排除的字段
type UploadPayload = Omit<
  Timeline,
  'statusEvents' | 'isShared' | 'hasLocalChanges' | 'serverVersion' | 'isReplayMode'
>

export interface PublicSharedTimeline extends UploadPayload {
  authorName: string
  publishedAt: number
  updatedAt: number
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

function buildPayload(timeline: Timeline): UploadPayload {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { statusEvents, isShared, hasLocalChanges, serverVersion, isReplayMode, ...rest } = timeline
  return rest
}

/**
 * 首次发布时间轴
 */
export async function publishTimeline(timeline: Timeline): Promise<PublishResult> {
  try {
    return await apiClient.post('timelines', { json: buildPayload(timeline) }).json<PublishResult>()
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
    ...buildPayload(timeline),
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

/**
 * 获取分享的时间轴（公开）
 * 若已登录，Worker 会根据 Authorization 头计算 isAuthor
 */
export async function fetchSharedTimeline(id: string): Promise<PublicSharedTimeline> {
  try {
    return await apiClient.get(`timelines/${id}`).json<PublicSharedTimeline>()
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
