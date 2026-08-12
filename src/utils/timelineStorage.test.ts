// @vitest-environment jsdom
/**
 * 时间轴存储工具测试
 */

import type { DamageEvent } from '@/types/timeline'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createNewTimeline } from './timelineStorage'
import { ALL_ENCOUNTERS } from '@/data/raidEncounters'
import * as RaidEncountersModule from '@/data/raidEncounters'

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

describe('createNewTimeline 等级推导', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('从副本表推导等级', () => {
    const encounter = ALL_ENCOUNTERS[0]
    const tl = createNewTimeline(String(encounter.id), '测试')
    expect(tl.level).toBe(encounter.level)
  })

  it('未知副本 id 回退 100', () => {
    expect(createNewTimeline('999999', '测试').level).toBe(100)
  })

  it('读表推导链路工作正确（验证不硬编码）', () => {
    // 锁定：推导逻辑确实从副本表读取等级，而非硬编码为 100
    // 即便生产数据里所有副本都是 100，通过注入 level=90 的假副本
    // 来验证 createNewTimeline 读到了这个非默认值
    const mockEncounter = {
      id: 9999,
      name: '假副本',
      shortName: 'FAKE',
      gameZoneId: 9999,
      level: 90,
    }
    vi.spyOn(RaidEncountersModule, 'getEncounterById').mockReturnValue(mockEncounter)

    const tl = createNewTimeline('9999', '测试')
    expect(tl.level).toBe(90)
  })
})
