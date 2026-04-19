/**
 * 时间轴类型定义
 */

import type { Job } from '@/data/jobs'
import type { TimelineStatData } from './statData'

export type { Job } from '@/data/jobs'

/**
 * 最大队员数量
 */
export const MAX_PARTY_SIZE = 8

/**
 * 伤害类型
 */
export const DAMAGE_TYPES = ['physical', 'magical', 'darkness'] as const
export type DamageType = (typeof DAMAGE_TYPES)[number]

/**
 * 攻击类型
 */
export const DAMAGE_EVENT_TYPES = ['aoe', 'tankbuster', 'auto'] as const
export type DamageEventType = (typeof DAMAGE_EVENT_TYPES)[number]

/**
 * 时间轴
 */
export interface Timeline {
  /** 时间轴 ID */
  id: string
  /** 时间轴名称 */
  name: string
  /** 时间轴说明（可选） */
  description?: string
  /** FFLogs 导入来源（仅从 FFLogs 导入的时间轴存在） */
  fflogsSource?: {
    reportCode: string
    fightId: number
  }
  /** FFXIV 游戏内 ZoneID，用于 Souma 时间轴导出时的自动副本识别。
   *  FFLogs 导入时从 ReportFight.gameZone.id 取值；本地新建时从 raidEncounters.ts 静态表查表写入。
   *  存量时间轴可能无此字段，导出时将回退至静态表或 "0"。 */
  gameZoneId?: number
  /** Souma 导出用的 boss 关键技能 sync 锚点。
   *  FFLogs 导入时由 parseSyncEvents 生成，本地新建时间轴为 undefined。
   *  存量时间轴可能无此字段，导出时不产出 sync 行即可。 */
  syncEvents?: SyncEvent[]
  /** 副本信息 */
  encounter: Encounter
  /** 小队阵容 */
  composition: Composition
  /** 伤害事件列表 */
  damageEvents: DamageEvent[]
  /** 技能使用事件列表 */
  castEvents: CastEvent[]
  /** 状态事件列表（编辑模式专用） */
  statusEvents: StatusEvent[]
  /** 注释列表 */
  annotations: Annotation[]
  /** 时间轴内部统计数据（盾值、治疗量、安全血量） */
  statData?: TimelineStatData
  /** 是否为回放模式 */
  isReplayMode?: boolean
  /** 是否已发布到服务器 */
  isShared?: boolean
  /** 是否曾经发布过（只增不减，用于决定打开时是否请求服务器验证） */
  everPublished?: boolean
  /** 发布后是否有本地未发布的修改 */
  hasLocalChanges?: boolean
  /** 最后一次与服务器同步的版本号 */
  serverVersion?: number
  /** 创建时间（Unix timestamp，秒） */
  createdAt: number
  /** 更新时间（Unix timestamp，秒），由客户端时钟写入 */
  updatedAt: number
}

/**
 * 副本
 */
export interface Encounter {
  /** 副本 ID */
  id: number
  /** 副本名称 */
  name: string
  /** 副本显示名称 */
  displayName: string
  /** 区域名称 */
  zone: string
  /** 伤害事件列表 */
  damageEvents: DamageEvent[]
}

/**
 * 护盾信息
 */
export interface ShieldInfo {
  /** 护盾状态 ID */
  statusId: number
  /** 护盾抵消量 */
  amount: number
}

/**
 * 状态快照（用于伤害事件的状态记录）
 */
export interface StatusSnapshot {
  /** 状态 ID */
  statusId: number
  /** 盾值（仅盾值类型状态） */
  absorb?: number
}

/**
 * 单个玩家的伤害详情
 */
export interface PlayerDamageDetail {
  /** 时间戳（毫秒） */
  timestamp: number
  /** 玩家 ID */
  playerId: number
  /** 玩家职业（UI 展示 + fflogsImporter.detectDamageType 消费） */
  job: Job
  /** 可选：FFLogs 导入时写入并由 top100Sync.slimDamageEvents 消费；V2 hydrate 后为 undefined（该路径不被 top100Sync 消费） */
  abilityId?: number
  /** 原始伤害 */
  unmitigatedDamage: number
  /** 最终伤害 */
  finalDamage: number
  /** 溢出伤害（超出目标剩余 HP 的部分） */
  overkill?: number
  /** 伤害倍率 */
  multiplier?: number
  /** 生效的状态快照列表（包括百分比减伤和盾值） */
  statuses: StatusSnapshot[]
  /** 当前生命值（伤害后） */
  hitPoints?: number
  /** 最大生命值 */
  maxHitPoints?: number
}

/**
 * 伤害事件
 */
export interface DamageEvent {
  /** 事件 ID */
  id: string
  /** 技能名称 */
  name: string
  /** 相对于阶段开始的时间（秒） */
  time: number
  /** 原始伤害（非坦克玩家平均值，如果只有坦克则为所有玩家平均值） */
  damage: number
  /** 攻击类型 */
  type: DamageEventType
  /** 伤害类型 */
  damageType: DamageType
  /** 每个玩家的伤害详情 */
  playerDamageDetails?: PlayerDamageDetail[]
  /** 伤害包 ID（top100Sync.slimDamageEvents 消费） */
  packetId?: number
  /** DOT 快照时间（秒）— 百分比减伤以此时刻为准而非 tick 时间 */
  snapshotTime?: number
}

/**
 * 小队阵容
 */
export interface Composition {
  /** 玩家列表 */
  players: Array<{
    id: number
    job: Job
  }>
}

/**
 * 技能使用事件
 */
export interface CastEvent {
  /** 事件 ID */
  id: string
  /** 技能 ID */
  actionId: number
  /** 使用时间（秒） */
  timestamp: number
  /** 使用者玩家 ID */
  playerId: number
}

/**
 * 注释锚定目标
 */
export type AnnotationAnchor =
  | { type: 'damageTrack' }
  | { type: 'skillTrack'; playerId: number; actionId: number }

/**
 * 注释
 */
export interface Annotation {
  /** 注释 ID */
  id: string
  /** 注释文本（最大 200 字符，允许换行） */
  text: string
  /** 锚定时间（秒） */
  time: number
  /** 锚定目标 */
  anchor: AnnotationAnchor
}

/**
 * Souma 时间轴 sync 锚点
 *
 * 来自 FFLogs 导入期对 ff14-overlay-vue 规则表（timelineSpecialRules.ts）的命中结果。
 * 导入时 battleOnce 去重已消解，这里存的都是"会渲染到 sync 行的"独立事件。
 * 导出时由 buildSoumaTimelineText 渲染为 cactbot netregex 风格的 sync 行。
 */
export interface SyncEvent {
  /** 相对战斗起点的秒，与 CastEvent.timestamp 口径一致，可为负 */
  time: number
  /** 'begincast' → StartsUsing；'cast' → Ability */
  type: 'begincast' | 'cast'
  /** FFXIV action id（十进制存储，导出时转十六进制） */
  actionId: number
  /** 中文名优先，回退 abilityMap 英文名，最后 fallback unknown_<hex> */
  actionName: string
  /** 来自规则表，[before, after] 秒 */
  window: [number, number]
  /** 来自规则表，控制输出行是否带 `once` 关键字 */
  syncOnce: boolean
}

/**
 * 时间轴摘要（用于列表显示）
 */
export interface TimelineSummary {
  /** 时间轴 ID */
  id: string
  /** 时间轴名称 */
  name: string
  /** 副本名称 */
  encounterName: string
  /** 更新时间 */
  updatedAt: string
  /** 减伤分配数量 */
  assignmentCount: number
}

/**
 * 状态事件（编辑模式由 executor 生成，回放模式从 FFLogs 导入）
 */
export interface StatusEvent {
  /** 状态 ID */
  statusId: number
  /** 开始时间（秒） */
  startTime: number
  /** 结束时间（秒） */
  endTime: number
  /** 来源玩家 ID */
  sourcePlayerId?: number
  /** 目标玩家 ID */
  targetPlayerId?: number
  /** 目标实例 */
  targetInstance?: number
  /** 盾值（仅盾值类型状态，从 FFLogs absorb 字段获取） */
  absorb?: number
  /** 伤害包 ID（回放模式，用于关联同一次技能对不同玩家的伤害） */
  packetId?: number
}
