import type { Timeline } from '@/types/timeline'
import type { TimelineContent } from './types'

/**
 * 把 Timeline-like 对象裁剪为 createLocalTimeline 所需的 TimelineContent，
 * 统一「本地新建 / 创建副本 / FFLogs 导入」的 13 字段透传口径，避免遗漏字段。
 * overrides 用于覆盖个别字段（创建副本时改名、重置 createdAt）。
 */
export function timelineToLocalInit(
  timeline: Pick<Timeline, keyof TimelineContent>,
  overrides: Partial<TimelineContent> = {}
): TimelineContent {
  return {
    name: timeline.name,
    description: timeline.description,
    encounter: timeline.encounter,
    fflogsSource: timeline.fflogsSource,
    gameZoneId: timeline.gameZoneId,
    syncEvents: timeline.syncEvents,
    isReplayMode: timeline.isReplayMode,
    composition: timeline.composition,
    damageEvents: timeline.damageEvents,
    castEvents: timeline.castEvents,
    annotations: timeline.annotations ?? [],
    statData: timeline.statData,
    createdAt: timeline.createdAt,
    ...overrides,
  }
}
