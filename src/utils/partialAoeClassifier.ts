/**
 * 部分 AOE 状态机：把 type === 'aoe' 的事件按"非 T 玩家命中集合"细分为
 *   'aoe' / 'partial_aoe' / 'partial_final_aoe'
 *
 * 必须在 detectDamageType / refineTankbusterClassification /
 * refineAutoAttackClassification 之后调用，此时 tankbuster / auto 已稳定。
 *
 * 算法：
 *   1. 仅消费 type === 'aoe' 且 playerDamageDetails 非空的事件（其余跳过）
 *   2. 维护 hitCount: Map<nonTankPlayerId, number>，初值全 0
 *   3. 每个事件：
 *      a. hitNonTanks = 该事件命中的非 T 玩家集合（去重）
 *      b. 命中全部非 T → 'aoe'，清零
 *      c. 命中为空（只命中坦克的伪 aoe）→ 'aoe' 不变，不动计数
 *      d. 部分命中 → 计数 +1；累加后全员 ≥1 → 'partial_final_aoe' 并清零，
 *         否则 → 'partial_aoe'
 *
 * composition 缺失或非 T 全集为空 → no-op（既有用例保持等价行为）。
 */

import { getJobRole, type Job } from '@/data/jobs'
import type { DamageEvent } from '@/types/timeline'

interface CompositionLike {
  players: Array<{ id: number; job: Job }>
}

export function classifyPartialAOE(
  damageEvents: DamageEvent[],
  composition: CompositionLike | undefined
): void {
  if (!composition) return

  const nonTankIds = new Set<number>(
    composition.players.filter(p => getJobRole(p.job) !== 'tank').map(p => p.id)
  )
  if (nonTankIds.size === 0) return

  const hitCount = new Map<number, number>()
  for (const id of nonTankIds) hitCount.set(id, 0)

  const resetCounts = () => {
    for (const id of nonTankIds) hitCount.set(id, 0)
  }

  for (const event of damageEvents) {
    if (event.type !== 'aoe') continue
    const details = event.playerDamageDetails
    if (!details || details.length === 0) continue

    const hitNonTanks = new Set<number>()
    for (const d of details) {
      if (nonTankIds.has(d.playerId)) hitNonTanks.add(d.playerId)
    }

    if (hitNonTanks.size === 0) {
      // 伪 aoe（只命中坦克），保持 'aoe' 不变，不动计数
      continue
    }

    if (hitNonTanks.size === nonTankIds.size) {
      // 命中全部非 T —— 真正的全员 AOE
      event.type = 'aoe'
      resetCounts()
      continue
    }

    // 部分命中
    for (const id of hitNonTanks) {
      hitCount.set(id, (hitCount.get(id) ?? 0) + 1)
    }

    let allCovered = true
    for (const id of nonTankIds) {
      if ((hitCount.get(id) ?? 0) < 1) {
        allCovered = false
        break
      }
    }

    if (allCovered) {
      event.type = 'partial_final_aoe'
      resetCounts()
    } else {
      event.type = 'partial_aoe'
    }
  }
}
