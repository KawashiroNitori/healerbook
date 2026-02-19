/**
 * 减伤技能数据加载 API
 */

import { MITIGATION_DATA } from '@/data/mitigationActions'
import type { MitigationAction, Job } from '@/types/mitigation'

/**
 * 获取所有减伤技能
 */
export function getAllMitigationActions(): MitigationAction[] {
  return MITIGATION_DATA.actions
}

/**
 * 根据职业获取减伤技能
 */
export function getActionsByJob(job: Job): MitigationAction[] {
  return MITIGATION_DATA.actions.filter(action => action.jobs.includes(job))
}

/**
 * 根据 ID 获取减伤技能
 */
export function getActionById(id: number): MitigationAction | undefined {
  return MITIGATION_DATA.actions.find(action => action.id === id)
}

/**
 * 获取数据版本信息
 */
export function getDataVersion(): {
  version: string
  lastUpdated: string
  source: string
} {
  return {
    version: MITIGATION_DATA.version,
    lastUpdated: MITIGATION_DATA.lastUpdated,
    source: MITIGATION_DATA.source,
  }
}
