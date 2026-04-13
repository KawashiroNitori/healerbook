// @vitest-environment jsdom
/**
 * 时间轴存储工具测试
 */

import type { DamageEvent } from '@/types/timeline'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createNewTimeline, saveTimeline, getAllTimelineMetadata } from './timelineStorage'

describe('createNewTimeline', () => {
  it('应该生成纯字母数字的 nanoid（不含 - 和 _）', () => {
    const timeline = createNewTimeline('1001', '测试时间轴')
    expect(timeline.id).toMatch(/^[0-9A-Za-z]{21}$/)
  })

  it('每次调用应该生成不同的 ID', () => {
    const t1 = createNewTimeline('1001', '时间轴 A')
    const t2 = createNewTimeline('1001', '时间轴 B')
    expect(t1.id).not.toBe(t2.id)
  })

  it('createdAt 和 updatedAt 应为 Unix 秒级时间戳（number）', () => {
    const before = Math.floor(Date.now() / 1000)
    const timeline = createNewTimeline('1001', '测试')
    const after = Math.floor(Date.now() / 1000)
    expect(typeof timeline.createdAt).toBe('number')
    expect(typeof timeline.updatedAt).toBe('number')
    expect(timeline.createdAt).toBeGreaterThanOrEqual(before)
    expect(timeline.createdAt).toBeLessThanOrEqual(after)
  })
})

describe('createNewTimeline — initialDamageEvents', () => {
  it('未传第三参数时 damageEvents 为空数组', () => {
    const timeline = createNewTimeline('1234', 'test')
    expect(timeline.damageEvents).toEqual([])
  })

  it('传入事件数组时 damageEvents 被填充', () => {
    const events: DamageEvent[] = [
      {
        id: 'e1',
        name: '死刑',
        time: 10,
        damage: 80000,
        type: 'tankbuster',
        damageType: 'physical',
      },
    ]
    const timeline = createNewTimeline('1234', 'test', events)
    expect(timeline.damageEvents).toHaveLength(1)
    expect(timeline.damageEvents[0].id).toBe('e1')
  })

  it('浅 copy 防御：修改传入数组不影响新时间轴', () => {
    const events: DamageEvent[] = [
      {
        id: 'e1',
        name: '死刑',
        time: 10,
        damage: 80000,
        type: 'tankbuster',
        damageType: 'physical',
      },
    ]
    const timeline = createNewTimeline('1234', 'test', events)
    events.push({
      id: 'e2',
      name: 'extra',
      time: 20,
      damage: 1000,
      type: 'aoe',
      damageType: 'magical',
    })
    expect(timeline.damageEvents).toHaveLength(1)
  })
})

describe('saveTimeline - description 元数据同步', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('保存带 description 的时间轴时，元数据中应包含 description', () => {
    const timeline = createNewTimeline('1001', '测试')
    timeline.description = '这是一段说明'
    saveTimeline(timeline)

    const metadata = getAllTimelineMetadata()
    expect(metadata).toHaveLength(1)
    expect(metadata[0].description).toBe('这是一段说明')
  })

  it('保存不带 description 的时间轴时，元数据中 description 应为 undefined', () => {
    const timeline = createNewTimeline('1001', '测试')
    saveTimeline(timeline)

    const metadata = getAllTimelineMetadata()
    expect(metadata[0].description).toBeUndefined()
  })

  it('更新时间轴 description 后，元数据应同步更新', () => {
    const timeline = createNewTimeline('1001', '测试')
    timeline.description = '初始说明'
    saveTimeline(timeline)

    timeline.description = '更新后的说明'
    saveTimeline(timeline)

    const metadata = getAllTimelineMetadata()
    expect(metadata).toHaveLength(1)
    expect(metadata[0].description).toBe('更新后的说明')
  })

  it('元数据中 updatedAt 应为 number 类型', () => {
    const timeline = createNewTimeline('1001', '测试')
    saveTimeline(timeline)
    const metadata = getAllTimelineMetadata()
    expect(typeof metadata[0].updatedAt).toBe('number')
  })
})
