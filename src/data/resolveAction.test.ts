import { describe, it, expect } from 'vitest'
import { resolveAction, resolveActions } from './resolveAction'
import type { MitigationAction } from '@/types/mitigation'
import { createBuffExecutor } from '@/executors'

const base: MitigationAction = {
  id: 9001,
  name: '测试技能',
  icon: '/i/test.png',
  jobs: ['WHM'],
  category: ['partywide', 'percentage'],
  duration: 20,
  cooldown: 120,
}

describe('resolveAction 区间过滤', () => {
  it('level 低于 minLevel 返回 null', () => {
    expect(resolveAction({ ...base, minLevel: 96 }, 90)).toBeNull()
  })

  it('level 等于 minLevel 可用（闭区间）', () => {
    expect(resolveAction({ ...base, minLevel: 90 }, 90)).not.toBeNull()
  })

  it('level 高于 maxLevel 返回 null', () => {
    expect(resolveAction({ ...base, maxLevel: 95 }, 100)).toBeNull()
  })

  it('level 等于 maxLevel 可用（闭区间）', () => {
    expect(resolveAction({ ...base, maxLevel: 90 }, 90)).not.toBeNull()
  })

  it('无区间声明时任何等级都可用', () => {
    expect(resolveAction(base, 70)).not.toBeNull()
  })
})

describe('resolveAction 覆盖层', () => {
  const withOverrides: MitigationAction = {
    ...base,
    levelOverrides: [
      { upTo: 81, patch: { duration: 10, cooldown: 180 } },
      { upTo: 87, patch: { duration: 15 } },
    ],
  }

  it('命中第一个 upTo >= level 的层', () => {
    const r = resolveAction(withOverrides, 70)!
    expect(r.duration).toBe(10)
    expect(r.cooldown).toBe(180)
  })

  it('只命中一层，不与后续层叠加', () => {
    // level 80 命中 upTo:81 层（duration 10 / cooldown 180），
    // 不应被 upTo:87 层的 duration 15 覆盖
    const r = resolveAction(withOverrides, 80)!
    expect(r.duration).toBe(10)
  })

  it('命中中间层时，未声明的字段回落基线而非前一层', () => {
    // level 85 命中 upTo:87 层，该层只声明 duration，
    // cooldown 应取基线 120，而不是 upTo:81 层的 180
    const r = resolveAction(withOverrides, 85)!
    expect(r.duration).toBe(15)
    expect(r.cooldown).toBe(120)
  })

  it('无层命中时返回基线原引用', () => {
    expect(resolveAction(withOverrides, 100)).toBe(withOverrides)
  })

  it('数组字段整体替换，不做元素级合并', () => {
    const action: MitigationAction = {
      ...base,
      statDataEntries: [
        { type: 'shield', key: 1 },
        { type: 'heal', key: 2 },
      ],
      levelOverrides: [{ upTo: 80, patch: { statDataEntries: [{ type: 'heal', key: 2 }] } }],
    }
    expect(resolveAction(action, 70)!.statDataEntries).toEqual([{ type: 'heal', key: 2 }])
  })

  it('executor 可被覆盖层替换', () => {
    const legacy = createBuffExecutor(1, 10)
    const action: MitigationAction = {
      ...base,
      executor: createBuffExecutor(2, 20),
      levelOverrides: [{ upTo: 80, patch: { executor: legacy } }],
    }
    expect(resolveAction(action, 70)!.executor).toBe(legacy)
  })
})

describe('resolveActions', () => {
  it('同一等级返回同一引用（memo 缓存）', () => {
    expect(resolveActions(100)).toBe(resolveActions(100))
  })

  it('actionMap 与 actions 内容一致', () => {
    const { actions, actionMap } = resolveActions(100)
    expect(actionMap.size).toBe(actions.length)
    for (const a of actions) expect(actionMap.get(a.id)).toBe(a)
  })

  it('不同等级得到不同集合大小时，低等级不多于高等级', () => {
    // 仅当已有数据声明了 minLevel 才会不等；此断言在无数据时也成立
    expect(resolveActions(70).actions.length).toBeLessThanOrEqual(
      resolveActions(100).actions.length
    )
  })
})

describe('真实数据：区间门槛', () => {
  const MEDICA_III_ID = 37010 // 医养，96 级习得

  it('90 级下医养不在技能表中', () => {
    expect(resolveActions(90).actionMap.has(MEDICA_III_ID)).toBe(false)
  })

  it('100 级下医养在技能表中', () => {
    expect(resolveActions(100).actionMap.has(MEDICA_III_ID)).toBe(true)
  })

  it('70 / 80 级下同样不可用', () => {
    expect(resolveActions(70).actionMap.has(MEDICA_III_ID)).toBe(false)
    expect(resolveActions(80).actionMap.has(MEDICA_III_ID)).toBe(false)
  })
})
