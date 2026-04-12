/**
 * Souma 时间轴导出工具
 *
 * 将 Healerbook 时间轴转换为 cactbot 风格的压缩字符串，
 * 可直接被 ff14-overlay-vue 的时间轴模块导入。
 */

import type { Timeline } from '@/types/timeline'
import { MITIGATION_DATA } from '@/data/mitigationActions'
import { getEncounterById } from '@/data/raidEncounters'
import type { Job } from '@/data/jobs'

/**
 * 格式化时间为 Souma 时间轴可接受的字符串。
 * - t >= 0：`mm:ss.d`（十分位四舍五入并正确进位）
 * - t < 0：`-X.X`（浮点字符串，保留一位小数）
 */
export function formatSoumaTime(t: number): string {
  if (t < 0) return t.toFixed(1)

  // 先按 0.1s 精度四舍五入，再拆分 mm/ss，避免 59.95 被显示为 00:60.0
  const deciseconds = Math.round(t * 10)
  const totalSeconds = Math.floor(deciseconds / 10)
  const tenths = deciseconds % 10
  const mm = Math.floor(totalSeconds / 60)
  const ss = totalSeconds % 60
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${tenths}`
}

/**
 * 将指定玩家在时间轴上使用过的技能转换为 Souma 时间轴文本。
 * 每行格式：`mm:ss.d "<技能名>~"[ tts]`
 */
export function buildSoumaTimelineText(
  timeline: Timeline,
  playerId: number,
  selectedActionIds: number[],
  ttsEnabled: boolean
): string {
  if (selectedActionIds.length === 0) return ''

  const selectedSet = new Set(selectedActionIds)
  const casts = timeline.castEvents
    .filter(c => c.playerId === playerId && selectedSet.has(c.actionId))
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp)

  const lines: string[] = []
  for (const cast of casts) {
    const action = MITIGATION_DATA.actions.find(a => a.id === cast.actionId)
    if (!action) continue
    const time = formatSoumaTime(cast.timestamp)
    const tts = ttsEnabled ? ' tts' : ''
    lines.push(`${time} "<${action.name}>~"${tts}`)
  }

  return lines.join('\n')
}

/** ff14-overlay-vue 的 ITimeline 最小形态 */
export interface SoumaITimeline {
  name: string
  condition: { zoneId: string; jobs: Job[] }
  timeline: string
  codeFight: string
  create: string
}

/**
 * 将 timeline + 玩家 + 行文本包装为 Souma 的 ITimeline。
 * zoneId 使用三级 fallback：
 *   1. timeline.gameZoneId
 *   2. 静态表 getEncounterById(timeline.encounter.id)?.gameZoneId
 *   3. "0"
 */
export function wrapAsSoumaITimeline(
  timeline: Timeline,
  playerId: number,
  timelineText: string
): SoumaITimeline {
  const player = timeline.composition.players.find(p => p.id === playerId)
  const jobCode = (player?.job ?? 'NONE') as Job

  const staticZoneId = getEncounterById(timeline.encounter.id)?.gameZoneId
  const zoneId = String(timeline.gameZoneId ?? staticZoneId ?? 0)

  return {
    name: `${timeline.name} - ${jobCode}`,
    condition: { zoneId, jobs: [jobCode] },
    timeline: timelineText,
    codeFight: 'Healerbook 导出',
    create: new Date().toLocaleString(),
  }
}
