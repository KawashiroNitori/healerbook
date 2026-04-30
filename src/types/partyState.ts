/**
 * 小队状态类型定义（编辑模式专用）
 */

import type { MitigationStatus } from './status'

/**
 * 非坦聚合 HP 池（编辑模式专用）
 *
 * 仅模拟非坦克玩家共享的最低参考血量；坦专事件（tankbuster / auto）
 * 不入池，继续走 mitigationCalculator 的多坦分支孤立判定。
 *
 * 由 MitigationCalculator.simulate 在入口按 baseReferenceMaxHPForAoe 初始化，
 * 后续随 cast / damage / tick / expire 演化。回放模式不参与。
 *
 * 段累积状态（segMax / inSegment / segCandidateMax）独立放在 PartyState.segment，
 * 不再混在 HpPool 里——skipHpPipeline 模式下 hp 为 undefined 但 segment 仍需维护
 * 以驱动延迟扣盾。
 */
export interface HpPool {
  /** 当前 HP，clamp 到 [0, max] */
  current: number
  /** 当前上限 = base × ∏(active 非坦专 maxHP buff) */
  max: number
  /** 基线上限（不含 maxHP buff）；buff attach/expire 时按比例伸缩 current */
  base: number
}

/**
 * partial AOE 段累积状态。
 *
 * 与 HpPool 解耦——skipHpPipeline 模式下 hp 为 undefined，但 segment 仍需维护
 * 才能让延迟扣盾在 PlacementEngine 等轻量调用下行为一致。
 *
 * 由 simulate 主循环初始化为零值，applyDamageToHp 内部读写。
 */
export interface SegmentState {
  /** 是否处于 partial 段内（aoe / partial_final_aoe 收尾或时间轴起始时为 false） */
  inSegment: boolean
  /** 段内已观察到的最大 finalDamage（盾后），驱动 HP 池扣血增量 */
  segMax: number
  /**
   * 段内已观察到的最大 candidateDamage（盾前），驱动 partial_final_aoe 结算扣盾量。
   * 与 segMax 区分：partial_aoe 走 Phase 3 read-only 路径时 finalDamage 已被盾减过，
   * max(finalDamage) 在盾够大时恒为 0，无法反映"段内最坏一次对盾的消耗"。
   */
  segCandidateMax: number
}

/**
 * 小队状态（编辑模式）
 * 所有状态统一存放在 PartyState.statuses 中，不再区分友方/敌方。
 */
export interface PartyState {
  /** 所有状态列表（包含友方 Buff 和原敌方 Debuff） */
  statuses: MitigationStatus[]
  /** 当前时间戳（秒） */
  timestamp: number
  /**
   * 非坦聚合 HP 池。回放模式 / hp 未初始化时为 undefined。
   * timelineStore.partyState 不直接持有 hp；hp 由 simulate 内部合成进 state，
   * 不污染外部 store 的 partyState 对象。
   */
  hp?: HpPool
  /**
   * partial 段累积状态。simulate 主循环初始化为
   * `{ inSegment: false, segMax: 0, segCandidateMax: 0 }`。
   * 单事件 calculate 入口（PropertyPanel）可不传，runSingleBranch 兜底为段外语义。
   */
  segment?: SegmentState
}
