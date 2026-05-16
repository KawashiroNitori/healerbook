/**
 * 时间轴本地存储工具
 */

import type { Timeline, Composition, DamageEvent } from '@/types/timeline'
import type { LocalDocMeta } from '@/collab/types'
import { generateId } from '@/utils/id'
import { getEncounterById } from '@/data/raidEncounters'
import { parseFromAny } from '@/utils/timelineFormat'
import { IndexedDBDocStore } from '@/collab/storage/IndexedDBDocStore'

const STORAGE_KEY = 'healerbook_timelines'

export interface TimelineMetadata {
  id: string
  name: string
  description?: string
  encounterId: string
  createdAt: number
  updatedAt: number
  isShared?: boolean
  composition?: Composition | null
}

/**
 * 获取所有时间轴元数据
 */
export function getAllTimelineMetadata(): TimelineMetadata[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY)
    if (!data) return []
    return JSON.parse(data)
  } catch (error) {
    console.error('Failed to load timeline metadata:', error)
    return []
  }
}

/**
 * 获取时间轴
 */
export function getTimeline(id: string): Timeline | null {
  try {
    const data = localStorage.getItem(`${STORAGE_KEY}_${id}`)
    if (!data) return null
    const raw = JSON.parse(data)
    const overrides: Partial<Timeline> = {
      id: raw.id ?? id,
      isShared: raw.isShared,
      serverVersion: raw.serverVersion,
      hasLocalChanges: raw.hasLocalChanges,
      everPublished: raw.everPublished,
    }
    // 向后兼容：v2 以前写入 localStorage 的记录 statData 存于顶层而非 sd
    if (raw.statData !== undefined) overrides.statData = raw.statData
    return parseFromAny(raw, overrides)
  } catch (error) {
    console.error('Failed to load timeline:', error)
    return null
  }
}

/**
 * 构建 FFLogs 来源索引(读 IndexedDB meta 表)。
 *
 * 按 `${reportCode}:${fightId}` 聚合带 fflogsSource 的本地时间轴。
 * 相同 key 多条时保留 updatedAt 最大者。
 */
export async function buildFFLogsSourceIndex(): Promise<Map<string, LocalDocMeta>> {
  const store = new IndexedDBDocStore()
  await store.open()
  const index = new Map<string, LocalDocMeta>()
  for (const meta of await store.getAllMeta()) {
    if (!meta.fflogsSource) continue
    const key = `${meta.fflogsSource.reportCode}:${meta.fflogsSource.fightId}`
    const existing = index.get(key)
    if (!existing || meta.updatedAt > existing.updatedAt) {
      index.set(key, meta)
    }
  }
  return index
}

/**
 * 创建新时间轴
 */
export function createNewTimeline(
  encounterId: string,
  name: string,
  initialDamageEvents?: DamageEvent[]
): Timeline {
  const now = Math.floor(Date.now() / 1000)
  const encounterIdNum = parseInt(encounterId) || 0
  const staticEncounter = getEncounterById(encounterIdNum)

  return {
    id: generateId(),
    name,
    encounter: {
      id: encounterIdNum,
      name: staticEncounter?.shortName ?? name,
      displayName: staticEncounter?.name ?? name,
      zone: '',
      damageEvents: [],
    },
    gameZoneId: staticEncounter?.gameZoneId,
    damageEvents: initialDamageEvents ? [...initialDamageEvents] : [],
    castEvents: [],
    statusEvents: [],
    annotations: [],
    composition: {
      players: [],
    },
    createdAt: now,
    updatedAt: now,
  }
}
