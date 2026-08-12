import { describe, it, expect } from 'vitest'
import { validateActions } from './validate'
import type { MitigationAction } from '@/types/mitigation'
import { resolveActions } from '@/data/resolveAction'
import { SUPPORTED_LEVELS } from '@/types/level'

function a(p: Partial<MitigationAction> & { id: number }): MitigationAction {
  return {
    name: 'x',
    icon: '',
    jobs: [] as unknown as MitigationAction['jobs'],
    category: ['partywide'],
    duration: 1,
    cooldown: 1,
    ...p,
  } as MitigationAction
}

describe('validateActions', () => {
  it('trackGroup 指向不存在的 id → error', () => {
    const issues = validateActions([a({ id: 1, trackGroup: 999 })])
    expect(issues.some(i => i.level === 'error' && i.rule === 'trackgroup-missing')).toBe(true)
  })

  it('trackGroup 链式（指向的 action 自己也有 trackGroup）→ error', () => {
    const issues = validateActions([
      a({ id: 1, trackGroup: 2 }),
      a({ id: 2, trackGroup: 3 }),
      a({ id: 3 }),
    ])
    expect(issues.some(i => i.rule === 'trackgroup-chain')).toBe(true)
  })

  it('同轨组成员必须都有 placement → error', () => {
    const issues = validateActions([
      a({ id: 1, placement: { validIntervals: () => [] } }),
      a({ id: 2, trackGroup: 1 }),
    ])
    expect(issues.some(i => i.rule === 'trackgroup-placement-missing')).toBe(true)
  })
})

const stub: MitigationAction = {
  id: 9101,
  name: '测试',
  icon: '/i/test.png',
  jobs: ['WHM'],
  category: ['self'],
  duration: 10,
  cooldown: 60,
}

describe('等级校验规则', () => {
  it('minLevel > maxLevel 报错', () => {
    const issues = validateActions([{ ...stub, minLevel: 96, maxLevel: 90 }])
    expect(issues.some(i => i.rule === 'level-range-inverted' && i.level === 'error')).toBe(true)
  })

  it('minLevel === maxLevel 合法', () => {
    const issues = validateActions([{ ...stub, minLevel: 90, maxLevel: 90 }])
    expect(issues.some(i => i.rule === 'level-range-inverted')).toBe(false)
  })

  it('levelOverrides 的 upTo 非升序报错', () => {
    const issues = validateActions([
      {
        ...stub,
        levelOverrides: [
          { upTo: 87, patch: { duration: 5 } },
          { upTo: 81, patch: { duration: 6 } },
        ],
      },
    ])
    expect(issues.some(i => i.rule === 'level-overrides-unsorted' && i.level === 'error')).toBe(
      true
    )
  })

  it('levelOverrides 的 upTo 重复报错', () => {
    const issues = validateActions([
      {
        ...stub,
        levelOverrides: [
          { upTo: 81, patch: { duration: 5 } },
          { upTo: 81, patch: { duration: 6 } },
        ],
      },
    ])
    expect(issues.some(i => i.rule === 'level-overrides-unsorted')).toBe(true)
  })

  it('upTo < minLevel 的死层报错', () => {
    const issues = validateActions([
      { ...stub, minLevel: 90, levelOverrides: [{ upTo: 81, patch: { duration: 5 } }] },
    ])
    expect(issues.some(i => i.rule === 'level-override-dead' && i.level === 'error')).toBe(true)
  })

  it('空 patch 的层报错', () => {
    const issues = validateActions([{ ...stub, levelOverrides: [{ upTo: 81, patch: {} }] }])
    expect(issues.some(i => i.rule === 'level-override-empty' && i.level === 'error')).toBe(true)
  })
})

describe('四档位全量校验', () => {
  // 某技能一旦声明 minLevel / maxLevel，它在部分档位会退出技能池，
  // 同 trackGroup 的其余成员的 placement 就可能不再覆盖全轴——
  // 这类 bug 只在特定等级复现，必须逐档位验。
  for (const level of SUPPORTED_LEVELS) {
    it(`${level} 级下全量技能数据无 error`, () => {
      const errors = validateActions(resolveActions(level).actions).filter(i => i.level === 'error')
      expect(errors).toEqual([])
    })
  }
})
