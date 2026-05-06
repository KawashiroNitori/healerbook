import { describe, it, expect } from 'vitest'
import { deriveLethalDangerous } from './lethalDanger'
import type { HpSimulationSnapshot } from './mitigationCalculator'

const snap = (over: Partial<HpSimulationSnapshot>): HpSimulationSnapshot => ({
  hpBefore: 100000,
  hpAfter: 50000,
  hpMax: 100000,
  ...over,
})

describe('deriveLethalDangerous', () => {
  describe('回放真实 overkill 短路', () => {
    it('hasOverkill=true 永远不致死也不危险（让回放路径自己显示 💀）', () => {
      const r = deriveLethalDangerous(snap({ hpAfter: 0, overkill: 100 }), 200000, 100000, true)
      expect(r).toEqual({ isLethal: false, isDangerous: false })
    })
  })

  describe('累积视角（hpSim 存在）', () => {
    it('hpAfter=0 且 overkill>0 → 致死', () => {
      const r = deriveLethalDangerous(snap({ hpAfter: 0, overkill: 1 }), 100001, 100000, false)
      expect(r).toEqual({ isLethal: true, isDangerous: false })
    })

    it('hpAfter=0 但 overkill=0（恰好打空）→ 不致死也不危险（hpAfter>0 守卫）', () => {
      const r = deriveLethalDangerous(snap({ hpAfter: 0, overkill: 0 }), 100000, 100000, false)
      expect(r).toEqual({ isLethal: false, isDangerous: false })
    })

    it('剩余 < 5% → 危险', () => {
      const r = deriveLethalDangerous(snap({ hpAfter: 4000, hpMax: 100000 }), 96000, 100000, false)
      expect(r).toEqual({ isLethal: false, isDangerous: true })
    })

    it('剩余 = 5% → 不危险（边界严格 <）', () => {
      const r = deriveLethalDangerous(snap({ hpAfter: 5000, hpMax: 100000 }), 95000, 100000, false)
      expect(r).toEqual({ isLethal: false, isDangerous: false })
    })

    it('剩余 > 5% → 不危险', () => {
      const r = deriveLethalDangerous(snap({ hpAfter: 50000, hpMax: 100000 }), 50000, 100000, false)
      expect(r).toEqual({ isLethal: false, isDangerous: false })
    })

    it('overkill 字段缺失（undefined）按 0 处理 → 不致死', () => {
      const r = deriveLethalDangerous(snap({ hpAfter: 0 }), 100000, 100000, false)
      expect(r).toEqual({ isLethal: false, isDangerous: false })
    })

    it('hpSim 存在则忽略 fallback 路径（refHP 不参与判定）', () => {
      const r = deriveLethalDangerous(snap({ hpAfter: 50000 }), 999999, 100000, false)
      expect(r).toEqual({ isLethal: false, isDangerous: false })
    })
  })

  describe('坦专 fallback（hpSim 缺失，refHP 存在）', () => {
    it('damage >= refHP → 致死', () => {
      const r = deriveLethalDangerous(undefined, 100000, 100000, false)
      expect(r).toEqual({ isLethal: true, isDangerous: false })
    })

    it('damage > refHP → 致死', () => {
      const r = deriveLethalDangerous(undefined, 150000, 100000, false)
      expect(r).toEqual({ isLethal: true, isDangerous: false })
    })

    it('damage >= refHP * 0.95 但 < refHP → 危险', () => {
      const r = deriveLethalDangerous(undefined, 95000, 100000, false)
      expect(r).toEqual({ isLethal: false, isDangerous: true })
    })

    it('damage = refHP * 0.95 边界 → 危险（>=）', () => {
      const r = deriveLethalDangerous(undefined, 95000, 100000, false)
      expect(r).toEqual({ isLethal: false, isDangerous: true })
    })

    it('damage < refHP * 0.95 → 都不', () => {
      const r = deriveLethalDangerous(undefined, 50000, 100000, false)
      expect(r).toEqual({ isLethal: false, isDangerous: false })
    })
  })

  describe('两路都缺失', () => {
    it('hpSim 与 refHP 都 undefined → 都不', () => {
      const r = deriveLethalDangerous(undefined, 50000, undefined, false)
      expect(r).toEqual({ isLethal: false, isDangerous: false })
    })

    it('refHP=0 视为缺失 → 都不（避免除零 / 永远致死）', () => {
      const r = deriveLethalDangerous(undefined, 50000, 0, false)
      expect(r).toEqual({ isLethal: false, isDangerous: false })
    })
  })
})
