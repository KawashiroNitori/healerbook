/**
 * 时间轴过滤器类型定义
 */

import type { DamageEventType } from '@/types/timeline'
import type { Job, JobRole } from '@/data/jobs'
import type { MitigationCategory } from '@/types/mitigation'

/** 预置过滤器规则（声明式）。三个筛选字段均可省略，省略或空数组视为不限（全部匹配）。 */
export interface BuiltinFilterRule {
  damageTypes?: DamageEventType[]
  jobRoles?: JobRole[]
  categories?: MitigationCategory[]
}

/** 自定义预设规则（按 job 分桶的 action 白名单）；damageTypes 省略或空数组视为不限 */
export interface CustomFilterRule {
  damageTypes?: DamageEventType[]
  /** 按职业分桶的 action ID 白名单；key 缺失或空数组都视为"该职业无技能被选中" */
  selectedActionsByJob: Partial<Record<Job, number[]>>
}

export type FilterPreset =
  | { kind: 'builtin'; id: string; name: string; rule: BuiltinFilterRule }
  | { kind: 'custom'; id: string; name: string; rule: CustomFilterRule }
