/**
 * 技能轨道派生逻辑（时间轴视图和表格视图共享）
 */

import { sortJobsByOrder } from '@/data/jobs'
import type { Composition, Job, CastEvent } from '@/types/timeline'
import { effectiveTrackGroup, type MitigationAction } from '@/types/mitigation'

export interface SkillTrack {
  job: Job
  playerId: number
  actionId: number
  actionName: string
  actionIcon: string
}

/**
 * 根据阵容、隐藏玩家集合和技能列表派生技能轨道
 *
 * 规则：
 * - 玩家按职业序排序（坦克 → 治疗 → DPS）
 * - 跳过 hiddenPlayerIds 中的玩家
 * - 每个玩家展开其职业可用的非 hidden 技能
 */
export function deriveSkillTracks(
  composition: Composition,
  hiddenPlayerIds: Set<number>,
  actions: MitigationAction[]
): SkillTrack[] {
  const sortedPlayers = sortJobsByOrder(composition.players, p => p.job)
  const tracks: SkillTrack[] = []
  for (const player of sortedPlayers) {
    if (hiddenPlayerIds.has(player.id)) continue
    const jobActions = actions.filter(
      a => a.jobs.includes(player.job) && (!a.trackGroup || a.trackGroup === a.id)
    )
    for (const action of jobActions) {
      tracks.push({
        job: player.job,
        playerId: player.id,
        actionId: action.id,
        actionName: action.name,
        actionIcon: action.icon,
      })
    }
  }
  return tracks
}

/** (playerId, actionId/groupId) 复合键，与 buildTrackIndexMap/groupCastEventsByTrack 共用 */
export function trackKey(playerId: number, actionId: number): string {
  return `${playerId}:${actionId}`
}

/** 建 (playerId, actionId) → skillTracks 下标 查找表，替代散落的 findIndex 线性扫描 */
export function buildTrackIndexMap(skillTracks: SkillTrack[]): Map<string, number> {
  const map = new Map<string, number>()
  skillTracks.forEach((t, i) => map.set(trackKey(t.playerId, t.actionId), i))
  return map
}

/**
 * 按 (playerId, effectiveTrackGroup) 对 castEvents 分组——trackGroup 变体
 * 归并到父轨道分组；actionsById 查不到的 cast 丢弃。不排序，由调用方按需 sort。
 */
export function groupCastEventsByTrack(
  castEvents: CastEvent[],
  actionsById: Map<number, MitigationAction>
): Map<string, CastEvent[]> {
  const grouped = new Map<string, CastEvent[]>()
  for (const ce of castEvents) {
    const action = actionsById.get(ce.actionId)
    if (!action) continue
    const key = trackKey(ce.playerId, effectiveTrackGroup(action))
    const arr = grouped.get(key)
    if (arr) arr.push(ce)
    else grouped.set(key, [ce])
  }
  return grouped
}
