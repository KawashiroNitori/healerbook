/**
 * 时间轴共享 API 客户端
 */

import { apiClient } from './apiClient'
import { unwrapApiError } from './unwrapApiError'
import type { MyTimelineListItem, SharedTimelineResponse } from '@/types/apiContracts'

export type { SharedTimelineResponse }

export interface PublishResult {
  id: string
  publishedAt: number
}

/**
 * 发布:把一条本地时间轴注册为云端时间轴。
 * 服务端可能清洗 id(敏感词),返回(可能变更过的)id。
 */
export async function publishTimeline(
  id: string,
  name: string,
  content?: string
): Promise<PublishResult> {
  return unwrapApiError(() =>
    apiClient
      .post('timelines', { json: content ? { id, name, content } : { id, name } })
      .json<PublishResult>()
  )
}

/** 获取当前登录用户的已发布时间轴列表 */
export async function fetchMyTimelines(): Promise<MyTimelineListItem[]> {
  return unwrapApiError(() => apiClient.get('my/timelines').json<MyTimelineListItem[]>(), {
    onStatus: { 401: () => [] },
  })
}

/** 删除已发布的时间轴(仅作者) */
export async function deleteSharedTimeline(id: string): Promise<void> {
  return unwrapApiError(async () => {
    await apiClient.delete(`timelines/${id}`)
  })
}

/**
 * 获取共享时间轴的角色与 KV snapshot。
 * snapshot 三角色通用:viewer 用于只读渲染,editor/author 用于首屏兜底,KV miss 时为 undefined。
 * 已登录时 Worker 据 Authorization 头判定 editor / viewer。
 */
export async function fetchSharedTimeline(id: string): Promise<SharedTimelineResponse> {
  return unwrapApiError(
    async () => {
      const raw = await apiClient.get(`timelines/${id}`).json<SharedTimelineResponse>()
      const result: SharedTimelineResponse = {
        role: raw.role,
        authorName: raw.authorName,
        isAuthor: raw.isAuthor,
        allowEditRequests: raw.allowEditRequests,
        hasPendingRequest: raw.hasPendingRequest,
        pendingRequestCount: raw.pendingRequestCount ?? 0,
      }
      if (raw.snapshot) {
        result.snapshot = {
          ...raw.snapshot,
          id,
          statusEvents: [],
          annotations: raw.snapshot.annotations ?? [],
        }
      }
      return result
    },
    {
      mapMessage: err =>
        err.response.status === 404 ? 'NOT_FOUND' : `HTTP ${err.response.status}`,
    }
  )
}

/** 作者面板数据:申请开关 + 编辑者列表 + 申请者列表 */
export interface ShareState {
  allowEditRequests: boolean
  editors: { userId: string; userName: string }[]
  applicants: { userId: string; userName: string; createdAt: number }[]
}

/** 作者读共享管理面板数据 */
export async function fetchShareState(id: string): Promise<ShareState> {
  return unwrapApiError(() => apiClient.get(`timelines/${id}/share`).json<ShareState>())
}

/** 作者设置申请开关 */
export async function setAllowEditRequests(id: string, value: boolean): Promise<void> {
  return unwrapApiError(async () => {
    await apiClient.patch(`timelines/${id}/share`, { json: { allowEditRequests: value } })
  })
}

/** 用户发起编辑权限申请 */
export async function requestEditPermission(id: string): Promise<void> {
  return unwrapApiError(async () => {
    await apiClient.post(`timelines/${id}/edit-requests`)
  })
}

/** 作者通过申请 */
export async function approveEditRequest(id: string, userId: string): Promise<void> {
  return unwrapApiError(async () => {
    await apiClient.post(`timelines/${id}/edit-requests/${userId}/approve`)
  })
}

/** 作者拒绝申请 */
export async function rejectEditRequest(id: string, userId: string): Promise<void> {
  return unwrapApiError(async () => {
    await apiClient.post(`timelines/${id}/edit-requests/${userId}/reject`)
  })
}

/** 作者移除编辑者 */
export async function removeEditor(id: string, userId: string): Promise<void> {
  return unwrapApiError(async () => {
    await apiClient.delete(`timelines/${id}/editors/${userId}`)
  })
}
