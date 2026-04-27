// src/types/timelineV2.ts
/**
 * Timeline 持久化格式 V2 类型定义
 *
 * 本文件只包含纯类型，不含运行逻辑。所有转换函数位于
 * `src/utils/timelineFormat.ts`。
 *
 * 设计文档：design/superpowers/specs/2026-04-16-timeline-format-v2-design.md
 */

export interface V2FFLogsSource {
  /** reportCode */
  rc: string
  /** fightId */
  fi: number
}

export interface V2StatusSnapshot {
  /** statusId */
  s: number
  /** absorb（盾值类状态专用） */
  ab?: number
}

export interface V2PlayerDamageDetail {
  /** timestamp（毫秒） */
  ts: number
  /** playerId */
  p: number
  /** unmitigatedDamage */
  u: number
  /** finalDamage */
  f: number
  /** overkill */
  o?: number
  /** multiplier */
  m?: number
  /** hitPoints */
  hp?: number
  /** maxHitPoints */
  mhp?: number
  /** statuses */
  ss: V2StatusSnapshot[]
}

export interface V2DamageEvent {
  /** name */
  n: string
  /** time（秒） */
  t: number
  /** damage */
  d: number
  /** type: 0=aoe, 1=tankbuster, 2=auto, 3=partial_aoe, 4=partial_final_aoe */
  ty: 0 | 1 | 2 | 3 | 4
  /** damageType: 0=physical, 1=magical, 2=darkness */
  dt: 0 | 1 | 2
  /** snapshotTime（DOT 快照） */
  st?: number
  /** playerDamageDetails（replay 模式专用） */
  pdd?: V2PlayerDamageDetail[]
}

export interface V2CastEvents {
  /** actionId 列 */
  a: number[]
  /** timestamp 列 */
  t: number[]
  /** playerId 列 */
  p: number[]
}

/** Annotation anchor：0=damageTrack，[playerId, actionId]=skillTrack */
export type V2AnnotationAnchor = 0 | [number, number]

export interface V2Annotation {
  /** text */
  x: string
  /** time（秒） */
  t: number
  /** anchor */
  k: V2AnnotationAnchor
}

export interface V2SyncEvent {
  /** time */
  t: number
  /** type: 0=begincast, 1=cast */
  ty: 0 | 1
  /** actionId */
  a: number
  /** actionName；仅在 abilityMap 查不到时作为 fallback 存入 */
  nm?: string
  /** window [before, after] */
  w: [number, number]
  /** syncOnce；false 时字段缺席 */
  so?: 1
}

import type { TimelineStatData } from './statData'

export interface V2Timeline {
  v: 2
  /** name */
  n: string
  /** description */
  desc?: string
  /** fflogsSource */
  fs?: V2FFLogsSource
  /** gameZoneId */
  gz?: number
  /** encounterId（由 raidEncounters.ts 反查元数据） */
  e: number
  /** composition：固定 8 槽稀疏数组，下标 = playerId，空槽用 ""，允许尾部 truncate */
  c: string[]
  /** damageEvents */
  de: V2DamageEvent[]
  /** castEvents（列式） */
  ce: V2CastEvents
  /** annotations */
  an?: V2Annotation[]
  /** syncEvents */
  se?: V2SyncEvent[]
  /** isReplayMode；false 时字段缺席 */
  r?: 1
  /** statData（技能数值覆盖） */
  sd?: TimelineStatData
  /** createdAt */
  ca: number
  /** updatedAt */
  ua: number
}
