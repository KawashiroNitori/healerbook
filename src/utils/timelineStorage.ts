/**
 * 时间轴本地存储工具
 */

import type { Timeline } from '@/types/timeline'
import { customAlphabet } from 'nanoid'

// 使用纯字母数字字母表（排除默认的 _ 和 -），避免 ID 包含特殊字符
const generateId = customAlphabet(
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  21
)

const STORAGE_KEY = 'healerbook_timelines'

export interface TimelineMetadata {
  id: string
  name: string
  description?: string
  encounterId: string
  createdAt: number
  updatedAt: number
  isShared?: boolean
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
    return JSON.parse(data)
  } catch (error) {
    console.error('Failed to load timeline:', error)
    return null
  }
}

/**
 * 保存时间轴
 */
export function saveTimeline(timeline: Timeline): void {
  try {
    // 保存时间轴数据
    localStorage.setItem(`${STORAGE_KEY}_${timeline.id}`, JSON.stringify(timeline))

    // 更新元数据列表
    const metadata = getAllTimelineMetadata()
    const existingIndex = metadata.findIndex(m => m.id === timeline.id)

    const newMetadata: TimelineMetadata = {
      id: timeline.id,
      name: timeline.name,
      description: timeline.description,
      encounterId: timeline.encounter?.id?.toString() || 'unknown',
      createdAt: timeline.createdAt,
      updatedAt: timeline.updatedAt,
      ...(timeline.isShared && { isShared: true }),
    }

    if (existingIndex >= 0) {
      metadata[existingIndex] = newMetadata
    } else {
      metadata.push(newMetadata)
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(metadata))
  } catch (error) {
    console.error('Failed to save timeline:', error)
    throw new Error('保存时间轴失败')
  }
}

/**
 * 删除时间轴
 */
export function deleteTimeline(id: string): void {
  try {
    // 删除时间轴数据
    localStorage.removeItem(`${STORAGE_KEY}_${id}`)

    // 更新元数据列表
    const metadata = getAllTimelineMetadata()
    const filtered = metadata.filter(m => m.id !== id)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered))
  } catch (error) {
    console.error('Failed to delete timeline:', error)
    throw new Error('删除时间轴失败')
  }
}

/**
 * 创建新时间轴
 */
export function createNewTimeline(encounterId: string, name: string): Timeline {
  const now = Math.floor(Date.now() / 1000)

  return {
    id: generateId(),
    name,
    encounter: {
      id: parseInt(encounterId) || 0,
      name: name,
      displayName: name,
      zone: '',
      damageEvents: [],
    },
    damageEvents: [],
    castEvents: [],
    statusEvents: [],
    composition: {
      players: [],
    },
    phases: [],
    createdAt: now,
    updatedAt: now,
  }
}
