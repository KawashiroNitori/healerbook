import { describe, it, expect } from 'vitest'
import { extractBossCasts, attachCastWindows } from './castWindowImport'
import type { DamageEvent } from '@/types/timeline'
import type { FFLogsEvent } from '@/types/fflogs'

const FS = 1000 // fightStartTime ms
const players = new Map([[24, { id: 24, name: 'P', type: 'WAR' }]])

function bc(
  type: 'begincast' | 'cast',
  src: number,
  id: number,
  tsMs: number,
  duration?: number
): FFLogsEvent {
  return {
    type,
    sourceID: src,
    targetID: src,
    abilityGameID: id,
    timestamp: tsMs,
    ...(duration ? { duration } : {}),
  }
}
function dmg(name: string, abilityId: number, tdMs: number): DamageEvent {
  return {
    id: name,
    name,
    time: (tdMs - FS) / 1000,
    damage: 1,
    type: 'aoe',
    damageType: 'magical',
    playerDamageDetails: [
      {
        timestamp: tdMs,
        playerId: 24,
        job: 'WAR',
        abilityId,
        unmitigatedDamage: 1,
        finalDamage: 1,
        statuses: [],
      },
    ],
  }
}

describe('extractBossCasts', () => {
  it('排除玩家施法，只留 boss begincast/cast', () => {
    const events = [bc('cast', 24, 999, 2000), bc('begincast', 50, 47877, 2100, 4700)]
    const out = extractBossCasts(events, players)
    expect(out).toHaveLength(1)
    expect(out[0].abilityGameID).toBe(47877)
  })
})

describe('attachCastWindows', () => {
  it('正常成对 → 写 castStartTime/castEndTime（秒）', () => {
    const boss = [bc('begincast', 50, 47877, 1500, 4700), bc('cast', 50, 47877, 6500)]
    const evs = [dmg('hit', 47877, 6600)]
    attachCastWindows(evs, boss, FS)
    expect(evs[0].castStartTime).toBe(0.5)
    expect(evs[0].castEndTime).toBe(5.5)
  })

  it('中断（仅 begincast 无 cast）→ 不写', () => {
    const boss = [bc('begincast', 50, 50718, 1500, 9700)]
    const evs = [dmg('hit', 50718, 12000)]
    attachCastWindows(evs, boss, FS)
    expect(evs[0].castStartTime).toBeUndefined()
    expect(evs[0].castEndTime).toBeUndefined()
  })

  it('瞬发（仅 cast 无 begincast）→ 不写', () => {
    const boss = [bc('cast', 50, 30000, 5000)]
    const evs = [dmg('hit', 30000, 5100)]
    attachCastWindows(evs, boss, FS)
    expect(evs[0].castStartTime).toBeUndefined()
  })

  it('中断悬挂 begincast 被之后瞬发 cast 误消费 → duration 校验丢弃', () => {
    // begincast@2s duration=9700，cast 出现在 +30s，远超 9700*1.5+1000 → 不配对
    const boss = [bc('begincast', 50, 70000, 2000, 9700), bc('cast', 50, 70000, 32000)]
    const evs = [dmg('hit', 70000, 32100)]
    attachCastWindows(evs, boss, FS)
    expect(evs[0].castStartTime).toBeUndefined()
  })

  it('多 boss 同技能并发 → 按 sourceID 分流，各自成对', () => {
    const boss = [
      bc('begincast', 50, 80000, 1000, 3000),
      bc('begincast', 51, 80000, 1200, 3000),
      bc('cast', 50, 80000, 4000),
      bc('cast', 51, 80000, 4200),
    ]
    const e1 = dmg('a', 80000, 4100) // 命中 source50 那对 [1000,4000]
    const e2 = dmg('b', 80000, 4300) // 命中 source51 那对 [1200,4200]
    attachCastWindows([e1, e2], boss, FS)
    expect(e1.castStartTime).toBe(0)
    expect(e1.castEndTime).toBe(3.0) // (4000-1000)/1000
    expect(e2.castStartTime).toBe(0.2)
    expect(e2.castEndTime).toBe(3.2) // (4200-1000)/1000
  })

  it('伤害技能 id ≠ 读条 id → 查不到，不写', () => {
    const boss = [bc('begincast', 50, 11111, 1000, 2000), bc('cast', 50, 11111, 3000)]
    const evs = [dmg('hit', 22222, 3100)]
    attachCastWindows(evs, boss, FS)
    expect(evs[0].castStartTime).toBeUndefined()
  })

  it('手动事件（无 playerDamageDetails）→ 跳过', () => {
    const boss = [bc('begincast', 50, 33333, 1000, 2000), bc('cast', 50, 33333, 3000)]
    const manual: DamageEvent = {
      id: 'm',
      name: 'M',
      time: 2,
      damage: 1,
      type: 'aoe',
      damageType: 'magical',
    }
    attachCastWindows([manual], boss, FS)
    expect(manual.castStartTime).toBeUndefined()
  })
})
