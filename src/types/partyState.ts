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
 */
export interface HpPool {
  /** 当前 HP，clamp 到 [0, max] */
  current: number
  /** 当前上限 = base × ∏(active 非坦专 maxHP buff) */
  max: number
  /** 基线上限（不含 maxHP buff）；buff attach/expire 时按比例伸缩 current */
  base: number
  /** partial 段累积器：段内已观察到的最大 finalDamage */
  segMax: number
  /** 是否处于 partial 段内（aoe / pfaoe 收尾或时间轴起始时为 false） */
  inSegment: boolean
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
}
