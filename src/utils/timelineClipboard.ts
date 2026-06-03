/**
 * 时间轴批量复制粘贴 —— 剪贴板纯逻辑。
 * 载荷复用 V2 分享格式（toV2/hydrateFromV2），只走 web 自定义格式进系统剪贴板。
 */
import type { Timeline } from '@/types/timeline'
import type { V2Timeline } from '@/types/timelineV2'
import { toV2 } from '@/utils/timelineFormat'

/** web 自定义格式 MIME；外部应用粘贴看不到，避免污染 */
export const CLIPBOARD_MIME = 'web application/x-healerbook-timeline+json'

export interface TimelineClipboard {
  __healerbook__: 'timeline-clipboard'
  version: 1
  v2: V2Timeline
}

export interface ClipboardSelection {
  eventIds: string[]
  castEventIds: string[]
  annotationIds: string[]
}

/** 用选中子集拼一个合成 Timeline 并序列化为载荷 */
export function buildClipboardPayload(
  timeline: Timeline,
  sel: ClipboardSelection
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
  return { __healerbook__: 'timeline-clipboard', version: 1, v2: toV2(subset) }
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
