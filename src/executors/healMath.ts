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
import type { MitigationStatus, MitigationStatusMetadata } from '@/types/status'
import { isStatusActiveAt } from '@/utils/statusWindow'

/**
 * statusId → 状态元数据的查询函数。
 *
 * healMath 不直接 import 状态注册表（避免 registry → statusExtras →
 * healMath → registry 的静态 import 环），由叶子调用方 import
 * `getStatusById` 并显式注入。
 */
export type GetStatusMeta = (statusId: number) => MitigationStatusMetadata | undefined

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
 * @param getMeta statusId → 元数据查询函数（调用方注入，通常为 getStatusById）
 */
export function computeFinalHeal(
  baseAmount: number,
  partyState: PartyState,
  castSourcePlayerId: number,
  castTime: number,
  getMeta: GetStatusMeta
): number {
  let multiplier = 1

  for (const status of partyState.statuses) {
    if (!isStatusActiveAt(status, castTime, 'excludeEnd')) continue
    const meta = getMeta(status.statusId)
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

  // 出口取整：单点保证所有治疗（一次性 cast / HoT snapshot）入 hp.current 时是整数，
  // 与 calculate 出口 round finalDamage / recomputeHpMax round newMax 的口径一致。
  return Math.round(baseAmount * multiplier)
}

/**
 * 计算当前 active maxHP buff 的累乘倍率。
 *
 * 仅消费 !meta.isTankOnly 的 status：坦专 maxHP buff 不抬升非坦池上限。
 *
 * @param getMeta statusId → 元数据查询函数（调用方注入，通常为 getStatusById）
 */
export function computeMaxHpMultiplier(
  statuses: MitigationStatus[],
  time: number,
  getMeta: GetStatusMeta
): number {
  let m = 1
  for (const s of statuses) {
    if (!isStatusActiveAt(s, time, 'excludeEnd')) continue
    const meta = getMeta(s.statusId)
    if (!meta) continue
    if (meta.isTankOnly) continue
    const perf = s.performance ?? meta.performance
    if (perf.maxHP !== undefined && perf.maxHP !== 1) m *= perf.maxHP
  }
  return m
}
