/**
 * 资源池类型定义
 *
 * 设计文档：design/superpowers/specs/2026-04-24-resource-model-design.md
 */

import type { Job } from '@/data/jobs'

/** 资源在悬浮窗中的渲染样式 */
export type ResourceStyle =
  | 'cooldown' // 技能图标 + 时钟 sweep 遮罩 + 倒计时（+ 多充能层数角标）
  | 'progressBar' // 进度条 + current/max（连续型；当前 registry 无使用，保留扩展）
  | 'lights' // N 个指示灯，亮 amount 个
  | 'lightsWithBar' // N 个指示灯 + 下一充能积累进度条

/** 资源池静态声明 */
export interface ResourceDefinition {
  /** 资源 id，如 'sch:consolation' / 'drk:oblation'。显式 id 不得以 '__cd__:' 开头 */
  id: string
  name: string
  /** 所属职业。仅 registry 元数据 / 未来 UI 面板用；runtime compute 层不消费 */
  job: Job
  /** 战斗开始时的值 */
  initial: number
  /** 池子上限 */
  max: number
  /** 悬浮窗渲染样式（必填） */
  style: ResourceStyle
  /**
   * 充能回充配置。不声明 = 不随时间恢复（纯事件驱动资源）。
   * 语义：每个消耗事件调度一个 interval 秒后到点的独立 refill，到点时若 amount < max 则 +amount、满则忽略。
   * NOT 从战斗 t=0 固定节拍 tick。
   */
  regen?: {
    interval: number
    amount: number
  }
  /**
   * 可选：当 cast 因该资源不足被拦截时（双击轨道无法添加等），UI 弹出文案的 description。
   * 省略时调用方使用通用 fallback 文案。仅对显式声明的 resource 有意义；
   * compute 层合成的 `__cd__:` 资源不消费此字段（普通 cooldown 不足走通用文案）。
   */
  unmetMessage?: string
}

/** action 对资源的影响声明 */
export interface ResourceEffect {
  resourceId: string
  /** 正 = 产出，负 = 消耗；一次 cast 可对多个资源声明多个 effect */
  delta: number
  /**
   * 仅对 delta < 0 有意义：资源不足是否阻止使用（默认 true）。
   * compute 层实现必须忽略 delta >= 0 的 required 字段（即不因产出事件的 required 触发任何检查）。
   */
  required?: boolean
  /**
   * 仅对 delta < 0 有意义：当该 cast 时刻指定 status（statusId）激活时，本次消耗被豁免——
   * deriveResourceEvents 不为其派生消耗事件（这一发免费），既不扣量也不参与耗尽校验。
   *
   * 仅在 deriveResourceEvents 传入 statusTimelineByPlayer 时生效；未传入（如纯单元测试 / 不关心
   * 状态的调用方）则永不豁免，行为与不声明本字段一致。
   *
   * 激活判定用「闭上界」：消耗掉该 status 的那一发 cast 自身（其状态区间 `to` 恰好截断在本 cast
   * 时刻）也算激活而被豁免；后续 cast 因区间已收束则正常扣量。配合「消耗该 status 的 executor」
   * 即可得到精确的单技能豁免语义（例：秘策 1896 只豁免下一发不屈不挠之策）。
   */
  suppressedByStatus?: number
}

/** 从 castEvent 派生出的资源事件（不持久化） */
export interface ResourceEvent {
  /** `${playerId}:${resourceId}` */
  resourceKey: string
  timestamp: number
  delta: number
  castEventId: string
  actionId: number
  /** 便利冗余，等价于 resourceKey.split(':')[0] 解包；避免 compute 层频繁拆 key */
  playerId: number
  /** 便利冗余，等价于 resourceKey 去掉 `${playerId}:` 前缀；便于合成池查表 */
  resourceId: string
  required: boolean
  /**
   * 同 timestamp 多事件的稳定 tie-break：castEvents 原数组下标。
   * castEvents 数组本身按 timestamp 升序存储，orderIndex 仅在同 timestamp 冲突时兜底。
   */
  orderIndex: number
}

/** 事件处理前后 + pending refills 快照，供 validator / legalIntervals / cdBarEnd 共用 */
export interface ResourceSnapshot {
  /** 对应 events[index] */
  index: number
  /** 事件 apply 前的 amount（已触发 ≤ ev.timestamp 的所有 pending refill，但未应用 ev.delta） */
  amountBefore: number
  /** 事件 apply 后的 amount（已 clamp 上限，下限不 clamp） */
  amountAfter: number
  /** 此事件 apply 后仍挂着的 refill 时间列表（升序） */
  pendingAfter: number[]
}

/** validator 的非法 cast 记录 */
export interface ResourceExhaustion {
  castEventId: string
  resourceKey: string
  resourceId: string
  playerId: number
}
