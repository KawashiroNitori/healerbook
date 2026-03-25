/**
 * 时间轴分享 API 客户端
 */

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

function authHeaders(accessToken: string): HeadersInit {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
  }
}

/**
 * 首次发布时间轴
 */
export async function publishTimeline(
  timeline: Timeline,
  accessToken: string
): Promise<PublishResult> {
  const res = await fetch('/api/timelines', {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify(buildPayload(timeline)),
  })

  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as {
      error?: string
    }
    throw new Error(err.error ?? `HTTP ${res.status}`)
  }

  return res.json() as Promise<PublishResult>
}

/**
 * 更新已发布的时间轴
 * @param expectedVersion 提供时启用乐观锁冲突检测；省略则强制覆写
 */
export async function updateTimeline(
  id: string,
  timeline: Timeline,
  accessToken: string,
  expectedVersion?: number
): Promise<UpdateResult | ConflictError> {
  const payload = {
    ...buildPayload(timeline),
    ...(expectedVersion !== undefined ? { expectedVersion } : {}),
  }

  const res = await fetch(`/api/timelines/${id}`, {
    method: 'PUT',
    headers: authHeaders(accessToken),
    body: JSON.stringify(payload),
  })

  if (res.status === 409) {
    const body = (await res.json()) as { serverVersion: number; serverUpdatedAt: number }
    return {
      type: 'conflict',
      serverVersion: body.serverVersion,
      serverUpdatedAt: body.serverUpdatedAt,
    }
  }

  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as {
      error?: string
    }
    throw new Error(err.error ?? `HTTP ${res.status}`)
  }

  return res.json() as Promise<UpdateResult>
}

/**
 * 获取分享的时间轴（公开）
 * @param accessToken 可选；提供时 Worker 会计算 isAuthor
 */
export async function fetchSharedTimeline(
  id: string,
  accessToken?: string | null
): Promise<PublicSharedTimeline> {
  const headers: HeadersInit = {}
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`
  }

  const res = await fetch(`/api/timelines/${id}`, { headers })

  if (res.status === 404) {
    throw new Error('NOT_FOUND')
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }

  return res.json() as Promise<PublicSharedTimeline>
}
