import { describe, it, expect } from 'vitest'
import { RESOURCE_REGISTRY } from './resources'
import { syntheticCdDef } from '@/utils/resource/compute'

describe('RESOURCE_REGISTRY style', () => {
  const expected: Record<string, string> = {
    'sch:aetherflow': 'lights',
    'whm:lily': 'lightsWithBar',
    'sge:addersgall': 'lightsWithBar',
    'sch:consolation': 'cooldown',
    'drk:oblation': 'cooldown',
    'ast:intersection': 'cooldown',
    'whm:divine': 'cooldown',
  }
  it('每个显式池声明了约定的样式', () => {
    for (const [id, style] of Object.entries(expected)) {
      expect(RESOURCE_REGISTRY[id]?.style).toBe(style)
    }
  })
  it('显式池数量与样式表一致（防止漏配新池）', () => {
    expect(Object.keys(RESOURCE_REGISTRY).sort()).toEqual(Object.keys(expected).sort())
  })
})

describe('syntheticCdDef', () => {
  it('合成 __cd__ 池恒为 cooldown 样式', () => {
    expect(syntheticCdDef('__cd__:188', 30).style).toBe('cooldown')
  })
})
