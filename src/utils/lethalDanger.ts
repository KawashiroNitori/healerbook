import type { HpSimulationSnapshot } from './mitigationCalculator'

/** 致死/危险阈值：剩余血量 < 5% 视为危险；坦专 fallback 同步用 1 - 5% = 95% */
const DANGER_HP_PCT = 0.05

export interface LethalDangerous {
  isLethal: boolean
  isDangerous: boolean
}

/**
 * 致死/危险判定（HP 累积视角 + 坦专 fallback）。
 *
 * 三视图（PropertyPanel / 卡片 / 表格）共用一处，避免阈值/公式漂移。
 *
 * 分流：
 *   - hasOverkill=true  → 全部不触发（让回放路径用真实 💀 标志）
 *   - hpSim 存在        → 累积视角；致死 = 打到 0 且 overkill > 0；危险 = 剩余 < 5%
 *   - hpSim 缺失 + refHP→ 坦专 fallback；致死 = damage >= refHP；危险 = damage >= refHP * 95%
 *   - 都缺失            → 都不触发
 */
export function deriveLethalDangerous(
  hpSim: HpSimulationSnapshot | undefined,
  finalDamage: number,
  referenceMaxHP: number | undefined,
  hasOverkill: boolean
): LethalDangerous {
  if (hasOverkill) return { isLethal: false, isDangerous: false }

  if (hpSim) {
    const isLethal = hpSim.hpAfter === 0 && (hpSim.overkill ?? 0) > 0
    const isDangerous =
      !isLethal && hpSim.hpAfter > 0 && hpSim.hpAfter / hpSim.hpMax < DANGER_HP_PCT
    return { isLethal, isDangerous }
  }

  if (referenceMaxHP != null && referenceMaxHP > 0) {
    const isLethal = finalDamage >= referenceMaxHP
    const isDangerous = !isLethal && finalDamage >= referenceMaxHP * (1 - DANGER_HP_PCT)
    return { isLethal, isDangerous }
  }

  return { isLethal: false, isDangerous: false }
}
