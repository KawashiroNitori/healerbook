/**
 * 技能轨道派生逻辑（时间轴视图和表格视图共享）
 */

import { sortJobsByOrder } from '@/data/jobs'
import type { Composition, Job } from '@/types/timeline'
import type { MitigationAction } from '@/types/mitigation'

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
    const jobActions = actions.filter(a => a.jobs.includes(player.job) && !a.hidden)
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
