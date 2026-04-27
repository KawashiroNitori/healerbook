/**
 * HP 模拟相关的纯函数计算工具
 *
 * 共两组：
 *   - computeFinalHeal：基础治疗量 → 应用 heal / selfHeal buff 倍率后的目标治疗量
 *   - computeMaxHpMultiplier：当前 active maxHP buff 累乘倍率
 *
 * 两者都只消费 !meta.isTankOnly 的 status——HP 池是非坦聚合视角，
 * 坦专 buff（自身减伤 / 坦克自疗 / 坦克 maxHP）不污染非坦池。
 */

import type { PartyState } from '@/types/partyState'
import type { MitigationStatus } from '@/types/status'
import { getStatusById } from '@/utils/statusRegistry'

/**
 * 计算应用所有活跃 heal / selfHeal buff 后的目标治疗量。
 *
 * 公式：
 *   finalHeal = baseAmount × ∏ (active heal[i]) × ∏ (active selfHeal[i] if sourcePlayer 匹配)
 *
 * 仅消费 !meta.isTankOnly 的 status。
 *
 * @param baseAmount 基础治疗量（statistics 或 fixedAmount）
 * @param partyState 当前小队状态（含 statuses）
 * @param castSourcePlayerId 施法玩家 ID
 * @param castTime 治疗发生时刻（cast 时刻 / tick 时刻），秒
 */
export function computeFinalHeal(
  baseAmount: number,
  partyState: PartyState,
  castSourcePlayerId: number,
  castTime: number
): number {
  let multiplier = 1

  for (const status of partyState.statuses) {
    if (status.startTime > castTime || status.endTime <= castTime) continue
    const meta = getStatusById(status.statusId)
    if (!meta) continue
    if (meta.isTankOnly) continue
    const perf = status.performance ?? meta.performance

    if (perf.heal !== undefined && perf.heal !== 1) {
      multiplier *= perf.heal
    }
    if (perf.selfHeal !== undefined && perf.selfHeal !== 1) {
      if (status.sourcePlayerId === castSourcePlayerId) {
        multiplier *= perf.selfHeal
      }
    }
  }

  return baseAmount * multiplier
}

/**
 * 计算当前 active maxHP buff 的累乘倍率。
 *
 * 仅消费 !meta.isTankOnly 的 status：坦专 maxHP buff 不抬升非坦池上限。
 */
export function computeMaxHpMultiplier(statuses: MitigationStatus[], time: number): number {
  let m = 1
  for (const s of statuses) {
    if (s.startTime > time || s.endTime <= time) continue
    const meta = getStatusById(s.statusId)
    if (!meta) continue
    if (meta.isTankOnly) continue
    const perf = s.performance ?? meta.performance
    if (perf.maxHP !== undefined && perf.maxHP !== 1) m *= perf.maxHP
  }
  return m
}
