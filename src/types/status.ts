/**
 * 状态类型定义
 */

import type {
  Keigenn,
  KeigennType,
  PerformanceType as ExternalPerformanceType,
} from '../../3rdparty/ff14-overlay-vue/src/types/keigennRecord2'
import type { MitigationCategory } from './mitigation'
import type { DamageEvent } from './timeline'
import type { PartyState } from './partyState'
import type { TimelineStatData } from './statData'

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
 * fullIcon 与 3rd party 的 keigenns 数组声明一致，做成可选。
 *
 * `type` 也做成可选：缺省视为"不参与 % 减伤、不算盾"，calculator Phase 1 与所有
 * `type === 'absorbed'` 的二分点都会安全跳过——适合纯靠 executor 起作用的状态
 * （如延迟治疗 / 标记类 buff）。
 */
export interface MitigationStatusMetadata extends Omit<
  Keigenn,
  'performance' | 'fullIcon' | 'type'
> {
  performance: PerformanceType
  fullIcon?: string
  type?: KeigennType
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
  /**
   * 运行时生成的唯一 ID。**整个 instance 的生命周期内必须保持稳定**——
   * simulator 的 captureTransition 用 instanceId 集合 diff 判定 buff 的 attach / persist /
   * consume，并由此驱动绿条长度、status interval 区间记录等 UI 数据。
   *
   * ─── 修改既有 status 的执行器写法 ───────────────────────────────
   *
   * ✅ 正确：保持 instanceId，只改字段
   *   // 延长 30s
   *   statuses.map(s => s.instanceId === target.instanceId
   *     ? { ...s, endTime: s.endTime + 30 } : s)
   *
   *   // 变身（statusId 改、instanceId 不变）
   *   statuses.map(s => s.instanceId === target.instanceId
   *     ? { ...s, statusId: NEW_ID, endTime: ... } : s)
   *
   *   // 立即结束 / 引爆
   *   statuses.filter(s => s.instanceId !== target.instanceId)
   *
   * 推荐使用 `src/executors/statusHelpers.ts` 的 `updateStatus` / `removeStatus`
   * 以避免手写 map/filter 时遗漏字段。
   *
   * ❌ 错误：filter 掉再 push 新 instanceId
   *   const filtered = statuses.filter(s => s.instanceId !== target.instanceId)
   *   return [...filtered, { ...target, instanceId: generateId(), endTime: ... }]
   *   // 后果：原 cast 的 interval 在此刻被收束，新 instance 被错误归属到当前 cast
   *   //      —— 原 cast 的绿条会"断开 + 另起一条"，而不是延长。
   *
   * ─── 真的"换主人"了的例外 ───────────────────────────────────────
   *
   * 极少数场景（buff 转给另一个 cast 接管），新建 instanceId 是正确语义——
   * 这条 interval 归新 cast，原 cast 的绿条收束在转移时刻。绝大多数
   * extension / transformation / detonation 都不属于这种情况。
   */
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
  /** 时间轴内部统计数据（healByAbility / shieldByAbility / referenceMaxHP 等），可选 */
  statistics?: TimelineStatData
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
  /** 时间轴内部统计数据，可选 */
  statistics?: TimelineStatData
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
  /** 时间轴内部统计数据，可选 */
  statistics?: TimelineStatData
}

/**
 * onExpire 上下文（状态自然到期）
 */
export interface StatusExpireContext {
  /** 即将过期的状态实例 */
  status: MitigationStatus
  /**
   * 状态实际过期的时刻——即 `status.endTime`，与 simulator 处理这次过期的"墙上时刻"
   * 解耦。executor 在此基础上派生新 status 的时间戳（addStatus 的 eventTime / 自变身后
   * 的 endTime 等）即可保证逻辑时间正确锚定。
   */
  expireTime: number
  partyState: PartyState
  /** 时间轴内部统计数据，可选 */
  statistics?: TimelineStatData
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
  /** 时间轴内部统计数据，可选 */
  statistics?: TimelineStatData
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
   * driver 在 advanceToTime 内按时间顺序处理所有 tick 与 expire——onExpire 的触发
   * 时刻 = `status.endTime`（不是下一个事件的 time）。这意味着 executor 在 onExpire
   * 里添加的新 status 即使 endTime 仍 < cur 也能在同一次 advance 内被发现并触发自
   * 己的 onExpire（按 endTime 升序、与剩余 tick 交错）。
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
