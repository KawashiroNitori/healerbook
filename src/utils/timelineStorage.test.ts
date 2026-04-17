// @vitest-environment jsdom
/**
 * 时间轴存储工具测试
 */

import type { DamageEvent } from '@/types/timeline'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createNewTimeline,
  saveTimeline,
  getAllTimelineMetadata,
  buildFFLogsSourceIndex,
} from './timelineStorage'

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

describe('buildFFLogsSourceIndex', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('无本地时间轴时返回空 Map', () => {
    const index = buildFFLogsSourceIndex()
    expect(index.size).toBe(0)
  })

  it('忽略没有 fflogsSource 的时间轴', () => {
    const timeline = createNewTimeline('1001', '纯本地')
    saveTimeline(timeline)

    const index = buildFFLogsSourceIndex()
    expect(index.size).toBe(0)
  })

  it('含 fflogsSource 的时间轴应加入索引', () => {
    const timeline = createNewTimeline('1001', '导入自 FFLogs')
    timeline.fflogsSource = { reportCode: 'ABC123', fightId: 5 }
    saveTimeline(timeline)

    const index = buildFFLogsSourceIndex()
    expect(index.size).toBe(1)
    const meta = index.get('ABC123:5')
    expect(meta).toBeDefined()
    expect(meta!.id).toBe(timeline.id)
    expect(meta!.name).toBe('导入自 FFLogs')
  })

  it('相同 reportCode+fightId 多条时保留 updatedAt 最大的一条', () => {
    const older = createNewTimeline('1001', '旧')
    older.fflogsSource = { reportCode: 'RPT', fightId: 3 }
    older.updatedAt = 1000
    saveTimeline(older)

    const newer = createNewTimeline('1001', '新')
    newer.fflogsSource = { reportCode: 'RPT', fightId: 3 }
    newer.updatedAt = 2000
    saveTimeline(newer)

    const index = buildFFLogsSourceIndex()
    expect(index.size).toBe(1)
    const meta = index.get('RPT:3')
    expect(meta!.id).toBe(newer.id)
    expect(meta!.name).toBe('新')
  })

  it('不同 reportCode+fightId 应分别索引', () => {
    const a = createNewTimeline('1001', 'A')
    a.fflogsSource = { reportCode: 'AAA', fightId: 1 }
    saveTimeline(a)

    const b = createNewTimeline('1002', 'B')
    b.fflogsSource = { reportCode: 'BBB', fightId: 2 }
    saveTimeline(b)

    const index = buildFFLogsSourceIndex()
    expect(index.size).toBe(2)
    expect(index.get('AAA:1')!.id).toBe(a.id)
    expect(index.get('BBB:2')!.id).toBe(b.id)
  })

  it('时间轴数据损坏时静默跳过（不抛异常）', () => {
    const good = createNewTimeline('1001', '正常')
    good.fflogsSource = { reportCode: 'GOOD', fightId: 1 }
    saveTimeline(good)

    // 手动注入一条损坏的 metadata 条目（指向不存在的 id）
    const metadata = JSON.parse(localStorage.getItem('healerbook_timelines')!)
    metadata.push({
      id: 'broken-id',
      name: '坏',
      encounterId: '1001',
      createdAt: 0,
      updatedAt: 0,
    })
    localStorage.setItem('healerbook_timelines', JSON.stringify(metadata))

    const index = buildFFLogsSourceIndex()
    expect(index.size).toBe(1)
    expect(index.has('GOOD:1')).toBe(true)
  })
})
