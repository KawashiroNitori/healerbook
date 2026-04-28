/**
 * HP 池演化序列上的一个点。
 *
 * MitigationCalculator.simulate 在每次 hp.current 改变后 push 一条，
 * 出口前按 time 升序 sort（与 healSnapshots 一致）。
 *
 * - kind 区分触发原因：
 *   - init：simulate 入口 hp 池初始化后立即 push 一条
 *   - damage：applyDamageToHp 之后（aoe 或 partial 段增量）
 *   - heal：cast 一次性治疗（recordHeal 且 isHotTick=false）
 *   - tick：HoT tick 治疗（recordHeal 且 isHotTick=true）
 *   - maxhp-change：recomputeHpMax 后 hp.max 变化（含 hp.current 同步缩放）
 */
export type HpTimelineKind = 'init' | 'damage' | 'heal' | 'tick' | 'maxhp-change'

export interface HpTimelinePoint {
  /** 该点对应的时刻（秒） */
  time: number
  /** 该时刻 hp.current（已 clamp 到 [0, hp.max]） */
  hp: number
  /** 该时刻 hp.max（含 maxHP buff 累乘） */
  hpMax: number
  /** 触发原因 */
  kind: HpTimelineKind
  /** 关联源事件 id（damage = damage event id；heal/tick = cast event id；init/maxhp-change = undefined） */
  refEventId?: string
}
