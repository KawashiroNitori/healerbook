/**
 * Souma 时间轴导出工具
 *
 * 将 Healerbook 时间轴转换为 cactbot 风格的压缩字符串，
 * 可直接被 ff14-overlay-vue 的时间轴模块导入。
 */

import LZString from 'lz-string'
import type { Timeline } from '@/types/timeline'
import { MITIGATION_DATA } from '@/data/mitigationActions'
import { getEncounterById } from '@/data/raidEncounters'
import { getJobName, type Job } from '@/data/jobs'

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
 * - 技能行：`mm:ss.d "<技能名>~"[ tts]`
 * - 注释行：`# mm:ss.d 注释文本`（多行注释自动拆成多条 # 行）
 * 注释与技能按时间合并排序；同一时间注释排在技能之前。
 */
export function buildSoumaTimelineText(
  timeline: Timeline,
  playerId: number,
  selectedActionIds: number[],
  ttsEnabled: boolean
): string {
  const selectedSet = new Set(selectedActionIds)

  type Entry = { time: number; order: number; text: string }
  const entries: Entry[] = []

  // 注释（全部包含，skillTrack anchor 会额外带上绑定技能的图标语法）
  for (const ann of timeline.annotations ?? []) {
    const timeLabel = formatSoumaTime(ann.time)
    let iconPrefix = ''
    if (ann.anchor.type === 'skillTrack') {
      const anchorActionId = ann.anchor.actionId
      const action = MITIGATION_DATA.actions.find(a => a.id === anchorActionId)
      if (action) iconPrefix = `<${action.name}>`
    }
    for (const line of ann.text.split('\n')) {
      entries.push({ time: ann.time, order: 0, text: `# ${timeLabel} ${iconPrefix}${line}` })
    }
  }

  // 技能
  if (selectedActionIds.length > 0) {
    for (const cast of timeline.castEvents) {
      if (cast.playerId !== playerId || !selectedSet.has(cast.actionId)) continue
      const action = MITIGATION_DATA.actions.find(a => a.id === cast.actionId)
      if (!action) continue
      const time = formatSoumaTime(cast.timestamp)
      const tts = ttsEnabled ? ' tts' : ''
      entries.push({
        time: cast.timestamp,
        order: 1,
        text: `${time} "<${action.name}>~"${tts}`,
      })
    }
  }

  if (entries.length === 0) return ''

  // 同一 time 内注释排在技能之前；相同 order 保持插入顺序（stable sort）
  entries.sort((a, b) => a.time - b.time || a.order - b.order)

  return entries.map(e => e.text).join('\n')
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
    name: `${timeline.name} - ${getJobName(jobCode)}`,
    condition: { zoneId, jobs: [jobCode] },
    timeline: timelineText,
    codeFight: 'Healerbook 导出',
    create: new Date().toLocaleString(),
  }
}

export interface SoumaExportParams {
  timeline: Timeline
  playerId: number
  selectedActionIds: number[]
  ttsEnabled: boolean
}

/**
 * 将 Healerbook 时间轴导出为 Souma 兼容的压缩字符串。
 * 输出格式：`LZString.compressToBase64(JSON.stringify([ITimeline]))`
 */
export function exportSoumaTimeline(params: SoumaExportParams): string {
  const { timeline, playerId, selectedActionIds, ttsEnabled } = params
  const text = buildSoumaTimelineText(timeline, playerId, selectedActionIds, ttsEnabled)
  const wrapped = wrapAsSoumaITimeline(timeline, playerId, text)
  return LZString.compressToBase64(JSON.stringify([wrapped]))
}
