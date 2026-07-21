/**
 * FFLogs 导入 API 客户端 —— GET /api/fflogs/import 的唯一前端入口。
 * 供两个导入 Dialog 共用「请求 + 反序列化」段；拿到 Timeline 后的
 * 业务处理（新建独立时间轴 vs 合并到当前时间轴）留在各组件。
 */
import { apiClient } from './apiClient'
import { resolveApiError, type TFunc } from './parseApiError'
import { parseFromAny } from '@/utils/timelineFormat'
import { generateId } from '@/utils/id'
import type { Timeline } from '@/types/timeline'

export interface FFLogsImportTarget {
  reportCode: string
  fightId: number | null
  isLastFight: boolean
}

/**
 * 服务端一次性解析出完整 Timeline；120s 超时（FFLogs 事件抓取可能较慢）。
 * t 由调用方（组件）传入：Worker 只回稳定 errorCode，本地化在前端完成。
 */
export async function fetchFFLogsImport(target: FFLogsImportTarget, t: TFunc): Promise<Timeline> {
  const params = new URLSearchParams({ reportCode: target.reportCode })
  if (!target.isLastFight && target.fightId !== null) {
    params.set('fightId', String(target.fightId))
  }

  const response = await apiClient.get(`fflogs/import?${params}`, {
    timeout: 120000,
    throwHttpErrors: false,
  })

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as unknown
    throw new Error(resolveApiError(body, response.status, t))
  }

  const raw = await response.json()
  return parseFromAny(raw, { id: generateId() })
}
