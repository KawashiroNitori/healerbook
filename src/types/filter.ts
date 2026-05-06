/**
 * 时间轴过滤器类型定义
 */

import type { DamageEvent, DamageEventType } from '@/types/timeline'
import type { Job } from '@/data/jobs'
import type { MitigationAction } from '@/types/mitigation'

/**
 * 预置过滤器规则——两个独立谓词：
 *   damage(e)        → 是否保留该伤害事件
 *   action(a, job)   → 是否保留该 (action, 玩家 job) 二元组（cast / track）
 */
export interface BuiltinFilterRule {
  damage: (e: DamageEvent) => boolean
  action: (a: MitigationAction, playerJob: Job) => boolean
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
