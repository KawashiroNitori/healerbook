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
import { splitDeciseconds } from '@/utils/formatters'

/**
 * 格式化时间为 Souma 时间轴可接受的字符串。
 * - t >= 0：`mm:ss.d`（十分位四舍五入并正确进位）
 * - t < 0：`-X.X`（浮点字符串，保留一位小数）
 */
export function formatSoumaTime(t: number): string {
  if (t < 0) return t.toFixed(1)

  const { minutes, seconds, tenths } = splitDeciseconds(t)
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths}`
}

/**
 * 将指定玩家在时间轴上使用过的技能转换为 Souma 时间轴文本。
 * - 技能行：`mm:ss.d "<技能名>~"[ tts]`
 * - 备注行：`# mm:ss.d 备注文本`（多行备注自动拆成多条 # 行）
 * 备注与技能按时间合并排序；同一时间备注排在技能之前。
 */
export function buildSoumaTimelineText(
  timeline: Timeline,
  playerId: number,
  selectedActionIds: number[],
  ttsEnabled: boolean,
  resolvedVariantByCastId: Map<string, number> = new Map()
): string {
  const selectedSet = new Set(selectedActionIds)

  type Entry = { time: number; order: number; text: string }
  const entries: Entry[] = []

  // 备注（全部包含；skillTrack / cast 锚定会带上绑定技能的图标语法与真实时刻）
  for (const ann of timeline.annotations ?? []) {
    let annTime = ann.time
    let iconPrefix = ''
    if (ann.anchor.type === 'skillTrack') {
      const anchorActionId = ann.anchor.actionId
      const action = MITIGATION_DATA.actions.find(a => a.id === anchorActionId)
      if (action) iconPrefix = `<${action.name}>`
    } else if (ann.anchor.type === 'cast') {
      const anchorCastId = ann.anchor.castId
      const cast = timeline.castEvents.find(c => c.id === anchorCastId)
      if (cast) {
        annTime = cast.timestamp
        const action = MITIGATION_DATA.actions.find(a => a.id === cast.actionId)
        if (action) iconPrefix = `<${action.name}>`
      }
    }
    const timeLabel = formatSoumaTime(annTime)
    for (const line of ann.text.split('\n')) {
      entries.push({ time: annTime, order: 0, text: `# ${timeLabel} ${iconPrefix}${line}` })
    }
  }

  // 技能：selectedActionIds 是主轨道（父）ID 集合；变体 cast 通过 trackGroup
  // 回退匹配到父——勾父等同隐式勾全部共享主轨道的变体
  if (selectedActionIds.length > 0) {
    for (const cast of timeline.castEvents) {
      if (cast.playerId !== playerId) continue
      // 归轨/勾选过滤仍按持久化的父 actionId（trackGroup ?? id）——勾父隐式含全部变体。
      const action = MITIGATION_DATA.actions.find(a => a.id === cast.actionId)
      if (!action) continue
      const groupId = action.trackGroup ?? action.id
      if (!selectedSet.has(groupId)) continue
      // 导出名按 simulate 推导出的具体变体（cast 持久化的是父 id）；缺失时回退父 action。
      const variantId = resolvedVariantByCastId.get(cast.id) ?? cast.actionId
      const variantAction =
        variantId === cast.actionId
          ? action
          : (MITIGATION_DATA.actions.find(a => a.id === variantId) ?? action)
      const time = formatSoumaTime(cast.timestamp)
      const tts = ttsEnabled ? ' tts' : ''
      entries.push({
        time: cast.timestamp,
        order: 1,
        text: `${time} "<${variantAction.name}>~"${tts}`,
      })
    }
  }

  // sync 事件（boss 关键技能锚点）
  for (const sync of timeline.syncEvents ?? []) {
    const time = formatSoumaTime(sync.time)
    const regexType = sync.type === 'begincast' ? 'StartsUsing' : 'Ability'
    const hex = sync.actionId.toString(16).toUpperCase()
    const once = sync.syncOnce ? ' once' : ''
    entries.push({
      time: sync.time,
      order: 2,
      text: `${time} "${sync.actionName}" ${regexType} { id: "${hex}" } window ${sync.window[0]},${sync.window[1]}${once}`,
    })
  }

  if (entries.length === 0) return ''

  // 同一 time 内备注排在技能之前；相同 order 保持插入顺序（stable sort）
  entries.sort((a, b) => a.time - b.time || a.order - b.order)

  return entries.map(e => e.text).join('\n')
}

/** ff14-overlay-vue 的 ITimeline 最小形态 */
export interface SoumaITimeline {
  name: string
  /** fflogsBoss：FFLogs V1 的 event.fights[x].boss（即 encounter.id），
   *  Souma 据此自动识别门神/本体 phase。无特定副本（id<=0）时省略。 */
  condition: { zoneId: string; jobs: Job[]; fflogsBoss?: number }
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
 * fflogsBoss 取 encounter.id（即 FFLogs fights[x].boss），>0 时输出供 Souma 自动识别 phase；
 * "其他"时间轴（id<=0）省略该字段。
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

  const fflogsBoss = timeline.encounter.id

  return {
    name: `${timeline.name} - ${getJobName(jobCode)}`,
    condition: {
      zoneId,
      jobs: [jobCode],
      ...(fflogsBoss > 0 ? { fflogsBoss } : {}),
    },
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
  /** 各 cast 的实际变体 id（来自 simulate 的 resolvedVariantByCastId）；缺省回退父 actionId。 */
  resolvedVariantByCastId?: Map<string, number>
}

/**
 * 将 Healerbook 时间轴导出为 Souma 兼容的压缩字符串。
 * 输出格式：`LZString.compressToBase64(JSON.stringify([ITimeline]))`
 */
export function exportSoumaTimeline(params: SoumaExportParams): string {
  const {
    timeline,
    playerId,
    selectedActionIds,
    ttsEnabled,
    resolvedVariantByCastId = new Map(),
  } = params
  const text = buildSoumaTimelineText(
    timeline,
    playerId,
    selectedActionIds,
    ttsEnabled,
    resolvedVariantByCastId
  )
  const wrapped = wrapAsSoumaITimeline(timeline, playerId, text)
  return LZString.compressToBase64(JSON.stringify([wrapped]))
}
