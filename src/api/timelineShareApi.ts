/**
 * 时间轴共享 API 客户端
 */

import { HTTPError } from 'ky'
import { apiClient } from './apiClient'
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
  try {
    return await apiClient
      .post('timelines', { json: content ? { id, name, content } : { id, name } })
      .json<PublishResult>()
  } catch (err) {
    if (err instanceof HTTPError) throw new Error(err.message)
    throw err
  }
}

/** 获取当前登录用户的已发布时间轴列表 */
export async function fetchMyTimelines(): Promise<MyTimelineListItem[]> {
  try {
    return await apiClient.get('my/timelines').json<MyTimelineListItem[]>()
  } catch (err) {
    if (err instanceof HTTPError && err.response.status === 401) return []
    throw err
  }
}

/** 删除已发布的时间轴(仅作者) */
export async function deleteSharedTimeline(id: string): Promise<void> {
  try {
    await apiClient.delete(`timelines/${id}`)
  } catch (err) {
    if (err instanceof HTTPError) throw new Error(err.message)
    throw err
  }
}

/**
 * 获取共享时间轴的角色与 KV snapshot。
 * snapshot 三角色通用:viewer 用于只读渲染,editor/author 用于首屏兜底,KV miss 时为 undefined。
 * 已登录时 Worker 据 Authorization 头判定 editor / viewer。
 */
export async function fetchSharedTimeline(id: string): Promise<SharedTimelineResponse> {
  try {
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

/** 作者面板数据:申请开关 + 编辑者列表 + 申请者列表 */
export interface ShareState {
  allowEditRequests: boolean
  editors: { userId: string; userName: string }[]
  applicants: { userId: string; userName: string; createdAt: number }[]
}

/** 作者读共享管理面板数据 */
export async function fetchShareState(id: string): Promise<ShareState> {
  try {
    return await apiClient.get(`timelines/${id}/share`).json<ShareState>()
  } catch (err) {
    if (err instanceof HTTPError) throw new Error(err.message)
    throw err
  }
}

/** 作者设置申请开关 */
export async function setAllowEditRequests(id: string, value: boolean): Promise<void> {
  try {
    await apiClient.patch(`timelines/${id}/share`, { json: { allowEditRequests: value } })
  } catch (err) {
    if (err instanceof HTTPError) throw new Error(err.message)
    throw err
  }
}

/** 用户发起编辑权限申请 */
export async function requestEditPermission(id: string): Promise<void> {
  try {
    await apiClient.post(`timelines/${id}/edit-requests`)
  } catch (err) {
    if (err instanceof HTTPError) throw new Error(err.message)
    throw err
  }
}

/** 作者通过申请 */
export async function approveEditRequest(id: string, userId: string): Promise<void> {
  try {
    await apiClient.post(`timelines/${id}/edit-requests/${userId}/approve`)
  } catch (err) {
    if (err instanceof HTTPError) throw new Error(err.message)
    throw err
  }
}

/** 作者拒绝申请 */
export async function rejectEditRequest(id: string, userId: string): Promise<void> {
  try {
    await apiClient.post(`timelines/${id}/edit-requests/${userId}/reject`)
  } catch (err) {
    if (err instanceof HTTPError) throw new Error(err.message)
    throw err
  }
}

/** 作者移除编辑者 */
export async function removeEditor(id: string, userId: string): Promise<void> {
  try {
    await apiClient.delete(`timelines/${id}/editors/${userId}`)
  } catch (err) {
    if (err instanceof HTTPError) throw new Error(err.message)
    throw err
  }
}
