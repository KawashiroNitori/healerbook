/**
 * 时间轴批量复制粘贴 —— 剪贴板纯逻辑。
 * 载荷复用 V2 分享格式（toV2/hydrateFromV2），只走 web 自定义格式进系统剪贴板。
 */
import type { Timeline, Composition, DamageEvent, CastEvent, Annotation } from '@/types/timeline'
import type { V2Timeline } from '@/types/timelineV2'
import { toV2, hydrateFromV2 } from '@/utils/timelineFormat'
import { buildPlayerIdMap } from '@/utils/importAdapter'
import { TIMELINE_START_TIME } from '@/components/Timeline/constants'

/** web 自定义格式 MIME；外部应用粘贴看不到，避免污染 */
export const CLIPBOARD_MIME = 'web application/x-healerbook-timeline+json'

export interface TimelineClipboard {
  __healerbook__: 'timeline-clipboard'
  version: 1
  v2: V2Timeline
  /** 复制来源为全选类操作：粘贴时保留对象原始绝对时间，忽略目标位置。缺省/false 为相对鼠标位置粘贴 */
  absolute?: boolean
}

export interface ClipboardSelection {
  eventIds: string[]
  castEventIds: string[]
  annotationIds: string[]
}

/** 用选中子集拼一个合成 Timeline 并序列化为载荷；absolute 标记粘贴时是否用绝对时间 */
export function buildClipboardPayload(
  timeline: Timeline,
  sel: ClipboardSelection,
  absolute = false
): TimelineClipboard {
  const eventSet = new Set(sel.eventIds)
  const castSet = new Set(sel.castEventIds)
  const annSet = new Set(sel.annotationIds)
  const subset: Timeline = {
    ...timeline,
    damageEvents: timeline.damageEvents.filter(e => eventSet.has(e.id)),
    castEvents: timeline.castEvents.filter(c => castSet.has(c.id)),
    annotations: (timeline.annotations ?? []).filter(a => annSet.has(a.id)),
    syncEvents: [],
  }
  return { __healerbook__: 'timeline-clipboard', version: 1, v2: toV2(subset), absolute }
}

/** 解析并校验剪贴板文本；非本格式返回 null */
export function parseClipboardPayload(text: string): TimelineClipboard | null {
  try {
    const obj = JSON.parse(text)
    if (obj && obj.__healerbook__ === 'timeline-clipboard' && obj.version === 1 && obj.v2) {
      return obj as TimelineClipboard
    }
  } catch {
    /* not our format */
  }
  return null
}

export interface PasteRemapArgs {
  currentComposition: Composition
  targetTime: number
  validActionIds: Set<number>
}

export interface PasteResult {
  damageEvents: Omit<DamageEvent, 'id'>[]
  castEvents: Omit<CastEvent, 'id'>[]
  annotations: Omit<Annotation, 'id'>[]
  skipped: number
}

/** 反序列化 + 职业映射 + 时间平移；落不了位的 cast/skillTrack 注释跳过并计数 */
export function remapClipboardForPaste(
  payload: TimelineClipboard,
  args: PasteRemapArgs
): PasteResult {
  const { currentComposition, targetTime, validActionIds } = args
  const hydrated = hydrateFromV2(payload.v2)
  const map = buildPlayerIdMap(hydrated.composition, currentComposition)

  const allTimes = [
    ...hydrated.damageEvents.map(e => e.time),
    ...hydrated.castEvents.map(c => c.timestamp),
    ...(hydrated.annotations ?? []).map(a => a.time),
  ]
  if (allTimes.length === 0) {
    return { damageEvents: [], castEvents: [], annotations: [], skipped: 0 }
  }
  // absolute（全选来源）：保留原始绝对时间；否则把最早对象对齐到 targetTime，其余按相对偏移
  const baseTime = Math.min(...allTimes)
  const shift = payload.absolute ? (t: number) => t : (t: number) => targetTime + (t - baseTime)

  let skipped = 0

  const damageEvents: Omit<DamageEvent, 'id'>[] = hydrated.damageEvents.map(e => ({
    name: e.name,
    time: Math.max(0, shift(e.time)),
    damage: e.damage,
    type: e.type,
    damageType: e.damageType,
    ...(e.playerDamageDetails !== undefined && { playerDamageDetails: e.playerDamageDetails }),
    ...(e.packetId !== undefined && { packetId: e.packetId }),
    ...(e.snapshotTime !== undefined && { snapshotTime: e.snapshotTime }),
    ...(e.tempMitigations !== undefined && { tempMitigations: e.tempMitigations }),
    ...(e.targetMitigationDisabled !== undefined && {
      targetMitigationDisabled: e.targetMitigationDisabled,
    }),
  }))

  const castEvents: Omit<CastEvent, 'id'>[] = []
  for (const c of hydrated.castEvents) {
    const mapped = map.get(c.playerId)
    if (mapped === undefined || !validActionIds.has(c.actionId)) {
      skipped++
      continue
    }
    castEvents.push({
      actionId: c.actionId,
      timestamp: Math.max(TIMELINE_START_TIME, shift(c.timestamp)),
      playerId: mapped,
    })
  }

  const annotations: Omit<Annotation, 'id'>[] = []
  for (const a of hydrated.annotations ?? []) {
    if (a.anchor.type === 'skillTrack') {
      const mapped = map.get(a.anchor.playerId)
      if (mapped === undefined) {
        skipped++
        continue
      }
      annotations.push({
        text: a.text,
        time: Math.max(TIMELINE_START_TIME, shift(a.time)),
        anchor: { type: 'skillTrack', playerId: mapped, actionId: a.anchor.actionId },
      })
    } else {
      annotations.push({
        text: a.text,
        time: Math.max(TIMELINE_START_TIME, shift(a.time)),
        anchor: { type: 'damageTrack' },
      })
    }
  }

  return { damageEvents, castEvents, annotations, skipped }
}
