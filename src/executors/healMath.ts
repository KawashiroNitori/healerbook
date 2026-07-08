/**
 * HP 模拟相关的纯函数计算工具
 *
 * 共两组：
 *   - computeFinalHeal：基础治疗量 → 应用 heal / selfHeal buff 倍率后的目标治疗量
 *   - computeMaxHpMultiplierFiltered / computeMaxHpMultiplier：active maxHP buff
 *     累乘倍率（前者为谓词 + 边界口径参数化的核心，后者为 HP 池视角薄包装）
 *
 * computeFinalHeal 与 computeMaxHpMultiplier 都只消费 !meta.isTankOnly 的
 * status——HP 池是非坦聚合视角，坦专 buff（自身减伤 / 坦克自疗 / 坦克 maxHP）
 * 不污染非坦池。
 */

import type { PartyState } from '@/types/partyState'
import type { MitigationStatus, MitigationStatusMetadata } from '@/types/status'
import { getStatusById } from '@/utils/statusRegistry'
import { isStatusActiveAt, type StatusWindowBoundary } from '@/utils/statusWindow'

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
    if (!isStatusActiveAt(status, castTime, 'excludeEnd')) continue
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

  // 出口取整：单点保证所有治疗（一次性 cast / HoT snapshot）入 hp.current 时是整数，
  // 与 calculate 出口 round finalDamage / recomputeHpMax round newMax 的口径一致。
  return Math.round(baseAmount * multiplier)
}

/**
 * maxHP 倍率累乘的核心实现：谓词与边界口径均由调用方参数化。
 *
 * 两个既有入口是它的薄包装：
 * - `computeMaxHpMultiplier`：`'excludeEnd'` + `!meta.isTankOnly`（HP 池视角）
 * - mitigationCalculator 的 `computeReferenceMaxHP`：`'closed'` + 调用方 filter（参考 HP 视角）
 *
 * @param boundary 生效窗边界口径（见 `statusWindow.ts` 两口径说明）
 * @param filter 谓词：返回 false 的 status 不参与累乘
 */
export function computeMaxHpMultiplierFiltered(
  statuses: MitigationStatus[],
  time: number,
  boundary: StatusWindowBoundary,
  filter: (meta: MitigationStatusMetadata, status: MitigationStatus) => boolean
): number {
  let m = 1
  for (const s of statuses) {
    if (!isStatusActiveAt(s, time, boundary)) continue
    const meta = getStatusById(s.statusId)
    if (!meta) continue
    if (!filter(meta, s)) continue
    const perf = s.performance ?? meta.performance
    if (perf.maxHP !== undefined && perf.maxHP !== 1) m *= perf.maxHP
  }
  return m
}

/**
 * 计算当前 active maxHP buff 的累乘倍率。
 *
 * 仅消费 !meta.isTankOnly 的 status：坦专 maxHP buff 不抬升非坦池上限。
 */
export function computeMaxHpMultiplier(statuses: MitigationStatus[], time: number): number {
  return computeMaxHpMultiplierFiltered(statuses, time, 'excludeEnd', meta => !meta.isTankOnly)
}
