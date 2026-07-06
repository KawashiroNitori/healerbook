/**
 * TOP100 榜单 API 客户端
 */

import { apiClient } from './apiClient'
import type { Top100AllResponse } from '@/types/apiContracts'

/** 获取全部副本的 TOP100 榜单（公开端点） */
export async function fetchTop100All(): Promise<Top100AllResponse> {
  return apiClient.get('top100').json<Top100AllResponse>()
}
