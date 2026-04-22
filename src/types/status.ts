/**
 * 状态类型定义
 */

import type {
  Keigenn,
  PerformanceType as ExternalPerformanceType,
} from '../../3rdparty/ff14-overlay-vue/src/types/keigennRecord2'
import type { MitigationCategory } from './mitigation'
import type { DamageEvent } from './timeline'
import type { PartyState } from './partyState'

/**
 * 减伤表现：在 3rd party 的 physics/magic/darkness 基础上新增 heal / maxHP
 * (1 = 无影响；< 1 减伤；此处复用同一套乘算口径)
 */
export type PerformanceType = ExternalPerformanceType & {
  /** 治疗增益倍率，缺省视为 1 */
  heal?: number
  /** 最大 HP 倍率（> 1 增益；例如 1.1 = +10% HP），缺省视为 1 */
  maxHP?: number
}

/**
 * 减伤状态元数据（在 Keigenn 基础上扩展本地字段）
 *
 * fullIcon 与 3rd party 的 keigenns 数组声明一致，做成可选
 */
export interface MitigationStatusMetadata extends Omit<Keigenn, 'performance' | 'fullIcon'> {
  performance: PerformanceType
  fullIcon?: string
  /** 是否仅对坦克生效 */
  isTankOnly: boolean
  /** 状态自身的副作用钩子（可选） */
  executor?: StatusExecutor
  /** 分类 tag，透传自 STATUS_EXTRAS.category；calculator 按 tank 过滤时消费 */
  category?: MitigationCategory[]
}

/**
 * 减伤状态实例（运行时）
 */
export interface MitigationStatus {
  /** 运行时生成的唯一 ID */
  instanceId: string
  /** 状态 ID（对应 Keigenn.id） */
  statusId: number
  /** 开始时间（秒） */
  startTime: number
  /** 结束时间（秒） */
  endTime: number
  /** 剩余盾值（仅盾值类型状态） */
  remainingBarrier?: number
  /** 初始盾值（用于多层盾重置，仅盾值类型状态） */
  initialBarrier?: number
  /**
   * barrier 归 0 时是否由 calculator 自动移除本实例；undefined / false = 保留。
   *
   * `createShieldExecutor` 产生的原生盾（barrier 就是它全部意义）应设为 true。
   * 非盾 buff 借 `onBeforeShield` 临时挂 barrier 的场景（如死斗 / 出死入生）不设，
   * 让 buff 本体按 duration 继续生效。行尸走肉这类触发后要消失的特殊 case，在
   * `onConsume` 里显式 `removeStatus` 自己。
   */
  removeOnBarrierBreak?: boolean
  /** 层数（默认为 1） */
  stack?: number
  /** 来源技能 ID */
  sourceActionId?: number
  /** 来源玩家 ID（对应 FFLogsActor.id） */
  sourcePlayerId?: number
  /** executor 自定义数据（tick 计数、累计值等）；框架不关心内容 */
  data?: Record<string, unknown>
  /**
   * 条件性减伤值快照；若存在优先于 metadata.performance。
   *
   * Snapshot-on-apply：由 ActionExecutor（通常是 createBuffExecutor 的 `performance`
   * option 直接注入）在 cast 时写入，事件间不会重算。calculator 优先读取：
   * `status.performance ?? meta.performance`。
   */
  performance?: PerformanceType
}

/**
 * onBeforeShield 上下文
 */
export interface StatusBeforeShieldContext {
  /** 触发本次钩子的状态实例 */
  status: MitigationStatus
  /** 当前伤害事件 */
  event: DamageEvent
  /** 本事件进入此钩子时的小队状态（含前序钩子已合并的修改） */
  partyState: PartyState
  /** % 减伤后的候选伤害（未扣盾) */
  candidateDamage: number
  /**
   * 事件对应的参考血量（坦专事件对应 tankReferenceMaxHP、aoe 对应 referenceMaxHP，
   * 已叠加活跃 buff 的 maxHP 倍率）。钩子只在编辑模式触发，由 calculator 注入。
   */
  referenceMaxHP: number
}

/**
 * onConsume 上下文
 */
export interface StatusConsumeContext {
  /** 刚被打穿的盾值状态实例（`remainingBarrier` 已归 0） */
  status: MitigationStatus
  event: DamageEvent
  partyState: PartyState
  /** 此盾值在本事件被吸收的量 */
  absorbedAmount: number
}

/**
 * onAfterDamage 上下文（盾吸收后）
 */
export interface StatusAfterDamageContext {
  status: MitigationStatus
  event: DamageEvent
  partyState: PartyState
  /** % 减伤后的候选伤害 */
  candidateDamage: number
  /** 盾吸收后的最终伤害 */
  finalDamage: number
}

/**
 * onExpire 上下文（状态自然到期）
 */
export interface StatusExpireContext {
  /** 即将过期的状态实例 */
  status: MitigationStatus
  /** 过期检查的时刻（通常是下一个事件的 time / snapshotTime） */
  expireTime: number
  partyState: PartyState
}

/**
 * onTick 上下文（周期性脉冲）
 *
 * driver 在 `t % 3 === 0` 的整秒时间点统一触发所有活跃状态的 onTick；
 * tickTime 是这次 tick 的绝对时间（秒）。
 */
export interface StatusTickContext {
  status: MitigationStatus
  tickTime: number
  partyState: PartyState
}

/**
 * 状态自身在减伤计算过程中的副作用钩子
 *
 * 每个钩子接收上下文，返回新的 PartyState（返回 void 表示不变）。
 * executor 应保持纯函数——只读 ctx、只返回新 state。
 */
export interface StatusExecutor {
  /** % 减伤后、盾值吸收前调用 */
  onBeforeShield?: (ctx: StatusBeforeShieldContext) => PartyState | void
  /** 盾值在本事件被完全打穿瞬间调用 */
  onConsume?: (ctx: StatusConsumeContext) => PartyState | void
  /** 盾值吸收后调用（无论这个状态自身是否参与了吸收） */
  onAfterDamage?: (ctx: StatusAfterDamageContext) => PartyState | void
  /**
   * 状态到达 endTime、即将被 driver 清理时调用。
   *
   * 注意：不要在 onExpire 中添加 `endTime <= ctx.expireTime` 的新状态——这类新状态
   * 会被本次 filter 静默清掉且不再触发自己的 onExpire；如需链式过期，请将新状态的
   * endTime 设得晚于 `ctx.expireTime`。
   */
  onExpire?: (ctx: StatusExpireContext) => PartyState | void
  /** 全局 3s tick 网格上、状态仍活跃时触发（DoT / HoT 等） */
  onTick?: (ctx: StatusTickContext) => PartyState | void
}

/**
 * 状态时间线区间（由 MitigationCalculator.simulate 产出）
 *
 * 半开区间 [from, to)。`sourcePlayerId` = 施放者；`sourceCastEventId` = 触发该状态
 * attach 的 cast event 的 id（Healerbook UUID）。同一个 status instance 可能因
 * executor consume 而提前结束，`to` 反映实际收束时刻；未 consume 的 interval 的
 * `to` 取 endTime。
 */
export interface StatusInterval {
  from: number
  to: number
  stacks: number
  sourcePlayerId: number
  sourceCastEventId: string
}
