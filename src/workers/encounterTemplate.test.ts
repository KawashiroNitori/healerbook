import { describe, it, expect } from 'vitest'
import { buildEncounterTemplate } from './encounterTemplate'
import type { StoredDamageEvent } from './top100Sync'

describe('buildEncounterTemplate (single-fight)', () => {
  function makeSlim(abilityId: number, time: number, damage = 1000): StoredDamageEvent {
    return { name: `a-${abilityId}`, time, damage, type: 'aoe', damageType: 'magical', abilityId }
  }

  it('无旧模板 → 用本场骨架产出新模板', () => {
    const events = [makeSlim(1, 1, 100), makeSlim(2, 2, 200)]
    const result = buildEncounterTemplate({
      fightDurationMs: 120_000,
      fightEvents: events,
      p50Map: { 1: 555, 2: 666 },
      oldTemplate: null,
    })
    expect(result).not.toBeNull()
    expect(result!.templateSourceDurationMs).toBe(120_000)
    expect(result!.events).toHaveLength(2)
    const byId = Object.fromEntries(result!.events.map(e => [e.abilityId!, e.damage]))
    expect(byId[1]).toBe(555)
    expect(byId[2]).toBe(666)
  })

  it('本场更长 → 覆盖', () => {
    const oldTemplate = {
      encounterId: 1,
      events: [],
      templateSourceDurationMs: 100_000,
      updatedAt: 'x',
    }
    const result = buildEncounterTemplate({
      fightDurationMs: 100_001,
      fightEvents: [makeSlim(1, 1)],
      p50Map: {},
      oldTemplate,
    })
    expect(result).not.toBeNull()
    expect(result!.templateSourceDurationMs).toBe(100_001)
  })

  it('本场等长 → 不覆盖（严格 >）', () => {
    const oldTemplate = {
      encounterId: 1,
      events: [],
      templateSourceDurationMs: 100_000,
      updatedAt: 'x',
    }
    const result = buildEncounterTemplate({
      fightDurationMs: 100_000,
      fightEvents: [makeSlim(1, 1)],
      p50Map: {},
      oldTemplate,
    })
    expect(result).toBeNull()
  })

  it('本场更短 → 不覆盖', () => {
    const oldTemplate = {
      encounterId: 1,
      events: [],
      templateSourceDurationMs: 100_000,
      updatedAt: 'x',
    }
    const result = buildEncounterTemplate({
      fightDurationMs: 50_000,
      fightEvents: [makeSlim(1, 1)],
      p50Map: {},
      oldTemplate,
    })
    expect(result).toBeNull()
  })

  it('damage 字段用 p50Map 覆盖，无 p50 时 fallback 到原值', () => {
    const result = buildEncounterTemplate({
      fightDurationMs: 100,
      fightEvents: [makeSlim(1, 1, 9999), makeSlim(2, 2, 8888)],
      p50Map: { 1: 500 },
      oldTemplate: null,
    })
    const byId = Object.fromEntries(result!.events.map(e => [e.abilityId!, e.damage]))
    expect(byId[1]).toBe(500)
    expect(byId[2]).toBe(8888)
  })

  it('每个事件带不同的 nanoid id', () => {
    const result = buildEncounterTemplate({
      fightDurationMs: 100,
      fightEvents: [makeSlim(1, 1), makeSlim(2, 2), makeSlim(3, 3)],
      p50Map: {},
      oldTemplate: null,
    })
    const ids = result!.events.map(e => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/\S+/)
  })

  it('空 events → 空 template（仍写）', () => {
    const result = buildEncounterTemplate({
      fightDurationMs: 100,
      fightEvents: [],
      p50Map: {},
      oldTemplate: null,
    })
    expect(result).not.toBeNull()
    expect(result!.events).toHaveLength(0)
  })

  it('产出 template 带 kill 字段（默认 false）', () => {
    const wipe = buildEncounterTemplate({
      fightDurationMs: 100,
      fightEvents: [makeSlim(1, 1)],
      p50Map: {},
      oldTemplate: null,
    })
    expect(wipe!.kill).toBe(false)

    const kill = buildEncounterTemplate({
      fightDurationMs: 100,
      fightEvents: [makeSlim(1, 1)],
      p50Map: {},
      oldTemplate: null,
      fightKill: true,
    })
    expect(kill!.kill).toBe(true)
  })

  it('kill 顶掉更长的 wipe（无视时长）', () => {
    const oldTemplate = {
      encounterId: 1,
      events: [],
      templateSourceDurationMs: 900_000,
      kill: false,
      updatedAt: 'x',
    }
    const result = buildEncounterTemplate({
      fightDurationMs: 500_000, // 比旧 wipe 短
      fightEvents: [makeSlim(1, 1)],
      p50Map: {},
      oldTemplate,
      fightKill: true,
    })
    expect(result).not.toBeNull()
    expect(result!.kill).toBe(true)
    expect(result!.templateSourceDurationMs).toBe(500_000)
  })

  it('更长的 wipe 不顶掉已有 kill', () => {
    const oldTemplate = {
      encounterId: 1,
      events: [],
      templateSourceDurationMs: 500_000,
      kill: true,
      updatedAt: 'x',
    }
    const result = buildEncounterTemplate({
      fightDurationMs: 900_000, // 更长，但 wipe
      fightEvents: [makeSlim(1, 1)],
      p50Map: {},
      oldTemplate,
      fightKill: false,
    })
    expect(result).toBeNull()
  })

  it('都是 kill → 本场更长才覆盖', () => {
    const oldTemplate = {
      encounterId: 1,
      events: [],
      templateSourceDurationMs: 500_000,
      kill: true,
      updatedAt: 'x',
    }
    expect(
      buildEncounterTemplate({
        fightDurationMs: 500_001,
        fightEvents: [makeSlim(1, 1)],
        p50Map: {},
        oldTemplate,
        fightKill: true,
      })
    ).not.toBeNull()
    expect(
      buildEncounterTemplate({
        fightDurationMs: 400_000,
        fightEvents: [makeSlim(1, 1)],
        p50Map: {},
        oldTemplate,
        fightKill: true,
      })
    ).toBeNull()
  })

  it('旧 template 无 kill 字段 → 按 wipe 处理，kill 仍可顶掉', () => {
    const legacyOld = {
      encounterId: 1,
      events: [],
      templateSourceDurationMs: 900_000,
      updatedAt: 'x',
    }
    const result = buildEncounterTemplate({
      fightDurationMs: 300_000,
      fightEvents: [makeSlim(1, 1)],
      p50Map: {},
      oldTemplate: legacyOld,
      fightKill: true,
    })
    expect(result).not.toBeNull()
    expect(result!.kill).toBe(true)
  })
})
