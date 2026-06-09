import type { MitigationAction } from '@/types/mitigation'
import type { MitigationStatus, StatusInterval } from '@/types/status'
import type { PlacementContext } from './types'

/**
 * 按「截至 t 时刻、该玩家自身 active 的 buff」推导 trackGroup 内应使用的变体。
 *
 * 复用各 action 的 placement 规则(whileStatus / not 等),把当前 active statuses
 * 表达成一个覆盖全轴的「点 timeline」喂给 placement.validIntervals 判定。
 * 恰好一个合法成员时返回它;0 或 ≥2 个(歧义/非法)时 fallback 回父 action。
 * 因果性:变体只依赖之前别的 cast 产生的 buff,故 simulate 顺序处理时无循环。
 */
export function resolveVariant(
  parent: MitigationAction,
  members: MitigationAction[],
  playerId: number,
  t: number,
  activeStatuses: MitigationStatus[]
): MitigationAction {
  if (members.length < 2) return parent

  // 点 timeline:玩家自己施放的每个 active status → 一条覆盖全轴的区间
  const byStatus = new Map<number, StatusInterval[]>()
  for (const s of activeStatuses) {
    if (s.sourcePlayerId !== playerId) continue
    const arr = byStatus.get(s.statusId) ?? []
    arr.push({
      from: Number.NEGATIVE_INFINITY,
      to: Number.POSITIVE_INFINITY,
      stacks: s.stack ?? 1,
      sourcePlayerId: playerId,
      sourceCastEventId: '',
    })
    byStatus.set(s.statusId, arr)
  }
  const statusTimelineByPlayer = new Map([[playerId, byStatus]])

  const legal = members.filter(m => {
    if (!m.placement) return true
    const ctx: PlacementContext = {
      action: m,
      playerId,
      castEvents: [],
      actions: new Map(),
      statusTimelineByPlayer,
    }
    return m.placement.validIntervals(ctx).some(i => i.from <= t && t <= i.to)
  })
  return legal.length === 1 ? legal[0] : parent
}
