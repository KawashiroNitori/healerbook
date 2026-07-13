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
   * 可选：悬浮窗中该资源池指示灯 / 进度条的主色调（任意 CSS 颜色，hex / hsl 均可）。
   * 提亮、压暗、发光等派生色由 color-mix 自动推导（见 ResourceHover/resourceTint.ts）。
   * 省略时回退 DEFAULT_RESOURCE_TINT。仅 lights / lightsWithBar / progressBar 样式消费；
   * cooldown 样式（技能图标遮罩）不读此字段。
   */
  tint?: string
  /**
   * 充能回充配置。不声明 = 不随时间恢复（纯事件驱动资源）。
   * 语义（FF14 充能 / 顺序回充）：维护单一回充时钟——当 amount 从满被消耗跌破时启动，
   * 未满时每回一档（+amount，clamp 到 max）就把下一档计时 +interval 重置，回满即停摆。
   * 后续消耗不重置时钟（仅加深亏空）。NOT 每次消耗各自调度独立 refill，也 NOT 从 t=0 固定节拍。
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
  /**
   * 可选：该池不足时是否允许强制放置（默认 false）。
   * - false（默认）：不足即从 placement 合法区挖洞——双击无法添加、拖入被判非法且落在阴影区。
   * - true：不再挖洞，可强行添加 / 拖入原本的阴影区；但该 cast 仍被 validator 判为
   *   `resource_exhausted`（红框），提示超额使用。
   *
   * 与 `ResourceEffect.required === false` 的区别：后者完全不校验该消费（不拦截**也不**标红）；
   * 本字段只放开 placement 层的拦截，保留标红提示。
   *
   * 作用域仅限「本池不足」这一门：若某 action 同时受自身合成 `__cd__:` 池 gating（双门），
   * 合成池无此标记，仍会照常拦截。仅显式资源消费此字段；合成 `__cd__:` 池不读。
   */
  allowForcePlacement?: boolean
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
