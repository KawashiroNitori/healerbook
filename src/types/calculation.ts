/**
 * 计算引擎的输入/输出契约类型；实现见 utils/mitigationCalculator。
 */

import type { PartyState } from './partyState'
import type { MitigationStatus, StatusInterval } from './status'
import type { CastEvent, DamageEvent } from './timeline'
import type { TimelineStatData } from './statData'
import type { HealSnapshot } from './healSnapshot'
import type { HpTimelinePoint } from './hpTimeline'

/**
 * 多坦路径单坦克的计算结果
 */
export interface PerTankResult {
  /** 该坦克玩家 ID */
  playerId: number
  finalDamage: number
  mitigationPercentage: number
  appliedStatuses: MitigationStatus[]
  /** 该分支个性化后的参考 HP（叠乘 maxHP 倍率） */
  referenceMaxHP: number
  /** 盾前伤害（含临时百分比、不含临时盾）；供减伤构成色块切分盾/百分比 */
  candidateDamage: number
}

/**
 * HP 池模拟快照（编辑模式非坦事件填充）
 *
 * 坦专事件（tankbuster / auto）走 perVictim 多坦分支，hpSimulation 为 undefined。
 * 回放模式与 hp 池未初始化时同样为 undefined。
 */
export interface HpSimulationSnapshot {
  /** 事件前 HP（cast / HoT 已结算） */
  hpBefore: number
  /** 事件后 HP（已扣段增量 / aoe 全额，clamp 到 [0, max]） */
  hpAfter: number
  /** 当前 HP 上限（含 maxHP buff） */
  hpMax: number
  /** 段内 max（partial 事件填充；非 partial 事件不填） */
  segMax?: number
  /**
   * 段进入本事件前的最大 event.damage（原始空间，partial 事件填充；**不含本事件**）。
   * 段刚开（本事件是首个 partial）时为 0。
   * 仅供 UI 展示（PropertyPanel 的"部分 AOE 伤害详情"），不参与扣血 / 扣盾；
   * partyState.segment.segOriginalMax 仍维护含本事件的最大值给下一事件用。
   */
  segOriginalMax?: number
  /**
   * 段内盾前增量（partial 事件填充）= max(0, candidateDamage - 段进入本事件前的 segCandidateMax)。
   * 与 hpSnap.dealt（盾后增量 = hpBefore - hpAfter + overkill）成对：
   *   pctMit_settlement   = raw_settlement - preShieldDealt
   *   shield_settlement   = preShieldDealt - preClampDealt
   *   finalDamage_settlement = preClampDealt
   * 让 PropertyPanel 减伤构成与 HP 条扣血量保持一致。
   */
  preShieldDealt?: number
  /** 溢出伤害 = max(0, 应扣量 - hpBefore)（应扣量：partial = delta、aoe = finalDamage） */
  overkill?: number
}

/**
 * 计算结果
 */
export interface CalculationResult {
  /** 原始伤害 */
  originalDamage: number
  /** 最终伤害（中位数） */
  finalDamage: number
  /** 最大伤害 */
  maxDamage: number
  /** 减伤百分比 */
  mitigationPercentage: number
  /** 应用的状态列表 */
  appliedStatuses: MitigationStatus[]
  /** 更新后的小队状态（盾值消耗后，回放模式下为 undefined） */
  updatedPartyState?: PartyState
  /** 非坦中位血量参考值（编辑模式填充） */
  referenceMaxHP?: number
  /**
   * 多坦路径产出；单路径（aoe / 无坦克）为 undefined。
   * 顶层 finalDamage / appliedStatuses / updatedPartyState 取 perVictim[0]；
   * maxDamage 取 max(perVictim.finalDamage)。
   */
  perVictim?: PerTankResult[]
  /** HP 池模拟快照；编辑模式下非坦事件填充；坦专 / 回放模式 / hp 缺失时为 undefined */
  hpSimulation?: HpSimulationSnapshot
  /** 盾前伤害（phase 1 % 减伤后、phase 2/3 盾扣前）；phase 5 钩子需要它。 */
  candidateDamage?: number
}

/**
 * 计算选项
 */
export interface CalculateOptions {
  /**
   * 事件对应的参考血量（已叠加 maxHP 倍率的 tankReferenceMaxHP / referenceMaxHP）。
   * 用于编辑模式下向 StatusBeforeShieldContext 提供 tank 的理论血量——
   * 死斗等"将 HP 拉到 1"类钩子在 replay 缺字段时以此兜底。
   */
  referenceMaxHP?: number
  /**
   * 基线参考 HP（未叠加 maxHP 倍率）。提供此字段时，calculator 负责按活跃 buff 叠乘。
   */
  baseReferenceMaxHP?: number
  /**
   * 坦专事件的承伤者坦克列表，按 composition 顺序。
   * - 非空 + event.type ∈ {tankbuster, auto} → 多坦路径
   * - 否则 → 单路径（现有行为）
   */
  tankPlayerIds?: number[]
  /** 时间轴内部统计数据，可选；用于 Status*Context.statistics 注入 */
  statistics?: TimelineStatData
  /** simulator 注入的治疗 snapshot 收集器；钩子改 hp 时通过此回调记录 HealSnapshot */
  recordHeal?: (snap: HealSnapshot) => void
  /**
   * 已经过期但快照时刻仍可能 active 的状态（DOT 快照专用）。
   * 主循环按 event.time 单调推进，buff endTime < cur 会被剔除；DOT 的 snapshotTime
   * 落在某个已剔除 buff 的 [start, end] 内时需要靠这个补丁找回。仅参与 Phase 1 % 减伤
   * 计算（Phase 2-4 钩子继续走当前 partyState，避免对已消失的 buff 重复触发）。
   */
  historicalStatuses?: MitigationStatus[]
}

/**
 * 纯函数模拟输入
 */
export interface SimulateInput {
  castEvents: CastEvent[]
  damageEvents: DamageEvent[]
  initialState: PartyState
  statistics?: TimelineStatData
  /**
   * composition 中的坦克 playerId 列表，按 composition 自然序。
   * 提供时坦专事件走多坦路径；不提供时单路径。由 hook 从 timeline.composition 派生后传入。
   */
  tankPlayerIds?: number[]
  /**
   * 用于多坦路径的基线 max HP（tankReferenceMaxHP，来自 resolveStatData）；
   * 亦透传给 calculator.calculate 的 baseReferenceMaxHP。
   */
  baseReferenceMaxHPForTank?: number
  /**
   * 非坦事件的基线 max HP（referenceMaxHP，来自 resolveStatData），
   * 用于 calculator.calculate 的 baseReferenceMaxHP（单路径路径）。
   */
  baseReferenceMaxHPForAoe?: number
  /**
   * 跳过 HP 管线：不初始化 HP 池、不记录 heal snapshot / hpTimeline、不发治疗调试日志。
   * 仅用于 PlacementEngine 这类只消费 statusTimelineByPlayer 的轻量调用，
   * 避免 N 次 engine simulate 重复跑完整 HP 模拟（每跑一次刷一遍治疗日志）。
   *
   * status 推进逻辑（executor / advance / capture）完全保留，statusTimelineByPlayer
   * 输出与完整模式一致。HP 相关的 executor 行为（如死斗 hp.current = 1）会因 hp =
   * undefined 自然走早返回，不影响 status 列表。
   */
  skipHpPipeline?: boolean
}

/**
 * 纯函数模拟输出
 */
export interface SimulateOutput {
  damageResults: Map<string, CalculationResult>
  /** playerId → statusId → StatusInterval[]；task 5 才填充，本 task 返回空 Map */
  statusTimelineByPlayer: Map<number, Map<number, StatusInterval[]>>
  /**
   * castEvent.id → 该 cast 的绿条末端。优先取该 cast 附着的「主减伤」（percentage /
   * shield）instance 的实际收束 max；该 cast 不产生主减伤 status 时回退到全部 instance
   * 的 max。seeded buff（sourceCastEventId === ''）不进表。渲染层用此字段定位绿条末端，
   * miss 时回退到 cast.timestamp + action.duration。分类与聚合见 utils/castEffectiveEnd.ts。
   */
  castEffectiveEndByCastEventId: Map<string, number>
  /**
   * castEvent.id → 该 cast 运行时推导出的具体变体 actionId。父 id 存于 castEvent.actionId，
   * simulate 按时间顺序处理时用「截至该时刻 active 的 buff」推导 trackGroup 内应使用的变体。
   * 单成员组返回父本身。渲染 / 导出读此字段，自身不推导。
   */
  resolvedVariantByCastId: Map<string, number>
  /** 所有治疗事件（cast + HoT tick）的 snapshot，按 time 升序 */
  healSnapshots: HealSnapshot[]
  /** HP 池演化序列（time 升序）；回放模式 / hp 池未初始化时为空数组 */
  hpTimeline: HpTimelinePoint[]
}
