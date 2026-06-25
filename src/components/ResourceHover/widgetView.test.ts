import { describe, it, expect } from 'vitest'
import { cooldownView, lightsView, barView } from './widgetView'
import type { ResourceWidget } from '@/utils/resource/hoverSnapshot'

const base: ResourceWidget = { resourceId: 'r', style: 'cooldown', name: 'x', amount: 0, max: 1 }

describe('cooldownView', () => {
  it('amount=max 就绪：无遮罩、无倒计时', () => {
    const v = cooldownView({ ...base, amount: 1, max: 1 })
    expect(v.showMask).toBe(false)
    expect(v.countdownLabel).toBeNull()
  })
  it('冷却中：遮罩 sweep=1-progress，倒计时向上取整秒', () => {
    const v = cooldownView({
      ...base,
      amount: 0,
      max: 1,
      countdownSec: 14.2,
      nextChargeProgress: 0.5,
    })
    expect(v.showMask).toBe(true)
    expect(v.sweepFraction).toBeCloseTo(0.5)
    expect(v.countdownLabel).toBe('15')
  })
  it('多充能：layer 角标 = amount；max=1 时无角标', () => {
    expect(cooldownView({ ...base, amount: 1, max: 2 }).stackBadge).toBe(1)
    expect(cooldownView({ ...base, amount: 1, max: 1 }).stackBadge).toBeNull()
  })
})

describe('lightsView', () => {
  it('total=max，lit=amount', () => {
    expect(lightsView({ ...base, style: 'lights', amount: 2, max: 3 })).toEqual({
      total: 3,
      lit: 2,
    })
  })
})

describe('barView', () => {
  it('progressBar：fraction=amount/max，label=current/max', () => {
    expect(barView({ ...base, style: 'progressBar', amount: 30, max: 100 })).toEqual({
      fraction: 0.3,
      label: '30/100',
    })
  })
})
