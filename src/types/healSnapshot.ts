/**
 * 治疗事件快照（一次性 cast / HoT tick 各产出一条）
 *
 * 由 MitigationCalculator.simulate 内部收集，写入 SimulateOutput.healSnapshots。
 * UI 后续消费（治疗 cast 详情面板 / 治疗效率统计），本期不直接渲染。
 */
export interface HealSnapshot {
  /** 触发治疗的 cast event id */
  castEventId: string
  /** 触发治疗的 actionId（一次性 cast = 自身 actionId；HoT tick = HoT status 的 sourceActionId） */
  actionId: number
  /** 触发玩家 ID（cast.sourcePlayerId） */
  sourcePlayerId: number
  /** 治疗发生时刻（cast 时刻 / tick 时刻），秒 */
  time: number
  /** 基础治疗量（statistics 或 fixedAmount） */
  baseAmount: number
  /** 应用 heal/selfHeal 倍率后的目标治疗量 */
  finalHeal: number
  /** 实际加进 hp 的量（受 hp.max - hp.current clamp 限制） */
  applied: number
  /** 溢出治疗量 = finalHeal - applied */
  overheal: number
  /** 是否 HoT tick（false = 一次性 cast） */
  isHotTick: boolean
}
