import { describe, it, expect } from 'vitest'
import {
  computeLitCellsByEvent,
  computeCdCellsByEvent,
  computeShadowCellsByEvent,
  computeCastMarkerCells,
  cellKey,
  extractBossCasts,
  attachCastWindows,
} from './castWindow'
import type { DamageEvent, CastEvent } from '@/types/timeline'
import type { MitigationAction } from '@/types/mitigation'
import type { SkillTrack } from './skillTracks'
import type { FFLogsEvent } from '@/types/fflogs'

const damage = (id: string, time: number): DamageEvent =>
  ({
    id,
    name: `dmg-${id}`,
    time,
    damage: 100000,
    type: 'aoe',
    damageType: 'magical',
  }) as DamageEvent

const cast = (id: string, playerId: number, actionId: number, timestamp: number): CastEvent =>
  ({
    id,
    actionId,
    timestamp,
    playerId,
    job: 'WHM',
  }) as CastEvent

const action = (id: number, duration: number): MitigationAction =>
  ({
    id,
    name: `a-${id}`,
    icon: '',
    jobs: [],
    duration,
    cooldown: 60,
    executor: () => ({ players: [], statuses: [], timestamp: 0 }),
  }) as unknown as MitigationAction

// 空的 castEffectiveEnd：绿条/CD 起点回退到静态 duration（即旧行为）
const noEff = new Map<string, number>()

describe('computeLitCellsByEvent', () => {
  it('castTime <= damageTime < castTime + duration 时亮起', () => {
    const actionsById = new Map([[100, action(100, 10)]])
    const events = [damage('d1', 5)]
    const casts = [cast('c1', 1, 100, 0)] // 窗口 [0, 10)
    const result = computeLitCellsByEvent(events, casts, actionsById, noEff)
    expect(result.get('d1')?.has(cellKey(1, 100))).toBe(true)
  })

  it('castTime === damageTime 时亮起（左闭）', () => {
    const actionsById = new Map([[100, action(100, 10)]])
    const result = computeLitCellsByEvent(
      [damage('d1', 0)],
      [cast('c1', 1, 100, 0)],
      actionsById,
      noEff
    )
    expect(result.get('d1')?.has(cellKey(1, 100))).toBe(true)
  })

  it('damageTime === castTime + duration 时不亮起（右开）', () => {
    const actionsById = new Map([[100, action(100, 10)]])
    const result = computeLitCellsByEvent(
      [damage('d1', 10)],
      [cast('c1', 1, 100, 0)],
      actionsById,
      noEff
    )
    expect(result.get('d1')?.has(cellKey(1, 100))).toBe(false)
  })

  it('damageTime 在 cast 窗口之前不亮起', () => {
    const actionsById = new Map([[100, action(100, 10)]])
    const result = computeLitCellsByEvent(
      [damage('d1', 0)],
      [cast('c1', 1, 100, 5)],
      actionsById,
      noEff
    )
    expect(result.get('d1')?.has(cellKey(1, 100))).toBe(false)
  })

  it('一个玩家的多次 cast 只要有一个窗口命中就亮起', () => {
    const actionsById = new Map([[100, action(100, 5)]])
    const casts = [
      cast('c1', 1, 100, 0), // 窗口 [0, 5)
      cast('c2', 1, 100, 20), // 窗口 [20, 25)
    ]
    const result = computeLitCellsByEvent(
      [damage('d1', 2), damage('d2', 10), damage('d3', 22)],
      casts,
      actionsById,
      noEff
    )
    expect(result.get('d1')?.has(cellKey(1, 100))).toBe(true)
    expect(result.get('d2')?.has(cellKey(1, 100))).toBe(false)
    expect(result.get('d3')?.has(cellKey(1, 100))).toBe(true)
  })

  it('不同 playerId / actionId 的 cast 独立计算', () => {
    const actionsById = new Map([
      [100, action(100, 10)],
      [200, action(200, 10)],
    ])
    const casts = [cast('c1', 1, 100, 0), cast('c2', 2, 200, 0)]
    const result = computeLitCellsByEvent([damage('d1', 5)], casts, actionsById, noEff)
    const lit = result.get('d1')!
    expect(lit.has(cellKey(1, 100))).toBe(true)
    expect(lit.has(cellKey(2, 200))).toBe(true)
    expect(lit.has(cellKey(1, 200))).toBe(false)
    expect(lit.has(cellKey(2, 100))).toBe(false)
  })

  it('actionsById 中不存在的 actionId 被跳过', () => {
    const actionsById = new Map<number, MitigationAction>()
    const result = computeLitCellsByEvent(
      [damage('d1', 5)],
      [cast('c1', 1, 999, 0)],
      actionsById,
      noEff
    )
    expect(result.get('d1')?.size).toBe(0)
  })

  it('每个伤害事件都有一个 Set（可能为空）', () => {
    const actionsById = new Map([[100, action(100, 10)]])
    const result = computeLitCellsByEvent(
      [damage('d1', 100), damage('d2', 200)],
      [],
      actionsById,
      noEff
    )
    expect(result.get('d1')).toEqual(new Set())
    expect(result.get('d2')).toEqual(new Set())
  })

  it('收回型变体：castEffectiveEnd 缺失时回退按「解析后变体」duration（duration0 → 不点亮父列）', () => {
    // 父 100 duration=20；变体 101(trackGroup 100) duration=0（收回，只移除 buff 不附着）。
    // cast 持久化父 100、resolved 为 101，castEffectiveEnd 缺失 → 回退应按变体 0 → 窗口 [0,0) 不点亮。
    const actionsById = new Map<number, MitigationAction>([
      [100, action(100, 20)],
      [101, { ...action(101, 0), trackGroup: 100 } as MitigationAction],
    ])
    const resolved = new Map<string, number>([['c1', 101]])
    const result = computeLitCellsByEvent(
      [damage('d1', 5)],
      [cast('c1', 1, 100, 0)],
      actionsById,
      noEff,
      resolved
    )
    expect(result.get('d1')?.has(cellKey(1, 100))).toBe(false)
  })

  it('castEffectiveEnd 覆盖静态 duration：buff 被延长后绿格延长（与时间轴一致）', () => {
    const actionsById = new Map([[100, action(100, 10)]]) // 静态窗口 [0,10)
    const casts = [cast('c1', 1, 100, 0)]
    const eff = new Map([['c1', 25]]) // 被延长到 25 → 绿格应覆盖 [0,25)
    const result = computeLitCellsByEvent(
      [damage('d1', 20), damage('d2', 25)],
      casts,
      actionsById,
      eff
    )
    expect(result.get('d1')?.has(cellKey(1, 100))).toBe(true) // 静态会是 false，延长后亮起
    expect(result.get('d2')?.has(cellKey(1, 100))).toBe(false) // t===effEnd 右开不亮
  })
})

describe('computeCdCellsByEvent', () => {
  // cdBarEndFor 桩：按 castEventId 返回预置的 rawEnd
  const stubCd = (map: Record<string, number | null>) => (id: string) => map[id] ?? null

  it('greenEnd <= damageTime < rawEnd 时标记为 CD', () => {
    const actionsById = new Map([[100, action(100, 10)]]) // duration=10
    const cd = stubCd({ c1: 30 }) // cast@0 → greenEnd=10, rawEnd=30 → CD 区间 [10,30)
    const result = computeCdCellsByEvent(
      [damage('d1', 15)],
      [cast('c1', 1, 100, 0)],
      actionsById,
      cd,
      noEff
    )
    expect(result.get('d1')?.has(cellKey(1, 100))).toBe(true)
  })

  it('damageTime === greenEnd 当刻归 CD（左闭）', () => {
    const actionsById = new Map([[100, action(100, 10)]])
    const cd = stubCd({ c1: 30 })
    const result = computeCdCellsByEvent(
      [damage('d1', 10)],
      [cast('c1', 1, 100, 0)],
      actionsById,
      cd,
      noEff
    )
    expect(result.get('d1')?.has(cellKey(1, 100))).toBe(true)
  })

  it('damageTime === rawEnd 当刻不归 CD（右开）', () => {
    const actionsById = new Map([[100, action(100, 10)]])
    const cd = stubCd({ c1: 30 })
    const result = computeCdCellsByEvent(
      [damage('d1', 30)],
      [cast('c1', 1, 100, 0)],
      actionsById,
      cd,
      noEff
    )
    expect(result.get('d1')?.has(cellKey(1, 100))).toBe(false)
  })

  it('绿条覆盖区间内（< greenEnd）不归 CD', () => {
    const actionsById = new Map([[100, action(100, 10)]])
    const cd = stubCd({ c1: 30 })
    const result = computeCdCellsByEvent(
      [damage('d1', 5)],
      [cast('c1', 1, 100, 0)],
      actionsById,
      cd,
      noEff
    )
    expect(result.get('d1')?.has(cellKey(1, 100))).toBe(false)
  })

  it('cdBarEndFor 返回 null 时该 cast 不产生 CD', () => {
    const actionsById = new Map([[100, action(100, 10)]])
    const cd = stubCd({ c1: null })
    const result = computeCdCellsByEvent(
      [damage('d1', 15)],
      [cast('c1', 1, 100, 0)],
      actionsById,
      cd,
      noEff
    )
    expect(result.get('d1')?.size).toBe(0)
  })

  it('rawEnd 为 Infinity 时延伸到时间轴末（所有 t >= greenEnd 的后续行）', () => {
    const actionsById = new Map([[100, action(100, 10)]])
    const cd = stubCd({ c1: Infinity }) // greenEnd=10
    const result = computeCdCellsByEvent(
      [damage('d1', 5), damage('d2', 50), damage('d3', 9999)],
      [cast('c1', 1, 100, 0)],
      actionsById,
      cd,
      noEff
    )
    expect(result.get('d1')?.has(cellKey(1, 100))).toBe(false) // 还在绿条内
    expect(result.get('d2')?.has(cellKey(1, 100))).toBe(true)
    expect(result.get('d3')?.has(cellKey(1, 100))).toBe(true)
  })

  it('trackGroup 变体的 CD 归到 parent 列', () => {
    // 200 是 100 的变体（trackGroup=100），CD 应落在 cellKey(1,100) 而非 cellKey(1,200)
    const variant = { ...action(200, 10), trackGroup: 100 } as MitigationAction
    const actionsById = new Map<number, MitigationAction>([
      [100, action(100, 10)],
      [200, variant],
    ])
    const cd = stubCd({ c1: 30 })
    const result = computeCdCellsByEvent(
      [damage('d1', 15)],
      [cast('c1', 1, 200, 0)],
      actionsById,
      cd,
      noEff
    )
    expect(result.get('d1')?.has(cellKey(1, 100))).toBe(true)
    expect(result.get('d1')?.has(cellKey(1, 200))).toBe(false)
  })

  it('actionsById 中不存在的 actionId 被跳过', () => {
    const actionsById = new Map<number, MitigationAction>()
    const cd = stubCd({ c1: 30 })
    const result = computeCdCellsByEvent(
      [damage('d1', 15)],
      [cast('c1', 1, 999, 0)],
      actionsById,
      cd,
      noEff
    )
    expect(result.get('d1')?.size).toBe(0)
  })

  it('每个伤害事件都有一个 Set（可能为空）', () => {
    const actionsById = new Map([[100, action(100, 10)]])
    const result = computeCdCellsByEvent(
      [damage('d1', 100), damage('d2', 200)],
      [],
      actionsById,
      () => null,
      noEff
    )
    expect(result.get('d1')).toEqual(new Set())
    expect(result.get('d2')).toEqual(new Set())
  })

  it('多个 cast 的 CD 区间可同时覆盖同一伤害事件', () => {
    const actionsById = new Map([
      [100, action(100, 10)],
      [200, action(200, 10)],
    ])
    const cd = stubCd({ c1: 40, c2: 40 }) // 两者 greenEnd=10, CD 区间 [10,40)
    const casts = [cast('c1', 1, 100, 0), cast('c2', 2, 200, 0)]
    const result = computeCdCellsByEvent([damage('d1', 20)], casts, actionsById, cd, noEff)
    const cdSet = result.get('d1')!
    expect(cdSet.has(cellKey(1, 100))).toBe(true)
    expect(cdSet.has(cellKey(2, 200))).toBe(true)
  })

  it('duration=0 技能：greenEnd===cast 时刻，CD 从 cast 时刻起命中（与时间轴一致）', () => {
    const actionsById = new Map([[100, action(100, 0)]]) // duration=0 → greenEnd=0
    const cd = stubCd({ c1: 30 }) // CD 区间 [0,30)
    const result = computeCdCellsByEvent(
      [damage('d0', 0), damage('d1', 15), damage('d2', 30)],
      [cast('c1', 1, 100, 0)],
      actionsById,
      cd,
      noEff
    )
    expect(result.get('d0')?.has(cellKey(1, 100))).toBe(true) // cast 时刻即命中
    expect(result.get('d1')?.has(cellKey(1, 100))).toBe(true)
    expect(result.get('d2')?.has(cellKey(1, 100))).toBe(false) // rawEnd 右开
  })

  it('castEffectiveEnd 覆盖静态 duration：buff 延长后蓝条起点后移（与时间轴一致）', () => {
    const actionsById = new Map([[100, action(100, 10)]]) // 静态 greenEnd=10
    const cd = stubCd({ c1: 40 }) // rawEnd=40
    const eff = new Map([['c1', 25]]) // 延长到 25 → CD 区间应为 [25,40) 而非 [10,40)
    const result = computeCdCellsByEvent(
      [damage('d1', 20), damage('d2', 30)],
      [cast('c1', 1, 100, 0)],
      actionsById,
      cd,
      eff
    )
    expect(result.get('d1')?.has(cellKey(1, 100))).toBe(false) // t=20 仍在延长后的绿区内，不归 CD
    expect(result.get('d2')?.has(cellKey(1, 100))).toBe(true) // t=30 在 [25,40) 内
  })
})

describe('computeShadowCellsByEvent', () => {
  const track = (playerId: number, actionId: number): SkillTrack =>
    ({ playerId, actionId, job: 'WHM', actionName: `a-${actionId}`, actionIcon: '' }) as SkillTrack

  it('from <= damageTime < to 時標記為 shadow', () => {
    const tracks = [track(1, 100)]
    const intervals = () => [{ from: 10, to: 30 }]
    const result = computeShadowCellsByEvent([damage('d1', 20)], tracks, intervals)
    expect(result.get('d1')?.has(cellKey(1, 100))).toBe(true)
  })

  it('damageTime === from 当刻命中（左闭）', () => {
    const result = computeShadowCellsByEvent([damage('d1', 10)], [track(1, 100)], () => [
      { from: 10, to: 30 },
    ])
    expect(result.get('d1')?.has(cellKey(1, 100))).toBe(true)
  })

  it('damageTime === to 当刻不命中（右开）', () => {
    const result = computeShadowCellsByEvent([damage('d1', 30)], [track(1, 100)], () => [
      { from: 10, to: 30 },
    ])
    expect(result.get('d1')?.has(cellKey(1, 100))).toBe(false)
  })

  it('单轨多区间：任一区间命中即标记', () => {
    const intervals = () => [
      { from: 0, to: 5 },
      { from: 20, to: 25 },
    ]
    const result = computeShadowCellsByEvent(
      [damage('d1', 2), damage('d2', 10), damage('d3', 22)],
      [track(1, 100)],
      intervals
    )
    expect(result.get('d1')?.has(cellKey(1, 100))).toBe(true)
    expect(result.get('d2')?.has(cellKey(1, 100))).toBe(false)
    expect(result.get('d3')?.has(cellKey(1, 100))).toBe(true)
  })

  it('回调返回空区间则该轨不产生 shadow', () => {
    const result = computeShadowCellsByEvent([damage('d1', 20)], [track(1, 100)], () => [])
    expect(result.get('d1')?.size).toBe(0)
  })

  it('不同 track 独立 keying', () => {
    const tracks = [track(1, 100), track(2, 200)]
    const intervals = (t: SkillTrack) =>
      t.playerId === 1 ? [{ from: 10, to: 30 }] : [{ from: 100, to: 200 }]
    const result = computeShadowCellsByEvent(
      [damage('d1', 20), damage('d2', 150)],
      tracks,
      intervals
    )
    expect(result.get('d1')?.has(cellKey(1, 100))).toBe(true)
    expect(result.get('d1')?.has(cellKey(2, 200))).toBe(false)
    expect(result.get('d2')?.has(cellKey(1, 100))).toBe(false)
    expect(result.get('d2')?.has(cellKey(2, 200))).toBe(true)
  })

  it('每个伤害事件都有一个 Set（可能为空）', () => {
    const result = computeShadowCellsByEvent([damage('d1', 100), damage('d2', 200)], [], () => [])
    expect(result.get('d1')).toEqual(new Set())
    expect(result.get('d2')).toEqual(new Set())
  })
})

describe('cellKey', () => {
  it('格式为 playerId:actionId', () => {
    expect(cellKey(1, 100)).toBe('1:100')
  })
})

describe('computeCastMarkerCells', () => {
  // 父 100 / 变体 101（trackGroup: 100），归列按 trackGroup（100），value 存显示变体 id
  const variantAction = (id: number, trackGroup?: number): MitigationAction =>
    ({ ...action(id, 10), trackGroup }) as MitigationAction
  const actionsById = new Map<number, MitigationAction>([
    [100, variantAction(100)],
    [101, variantAction(101, 100)],
  ])

  it('cast 持久化父 id，value 按 resolvedVariantByCastId 存变体 id；归列仍按 trackGroup', () => {
    const events = [damage('d1', 30)]
    const casts = [cast('c1', 1, 100, 20)] // 持久化父 100
    const resolved = new Map<string, number>([['c1', 101]]) // 推导为变体 101
    const result = computeCastMarkerCells(events, casts, actionsById, resolved)
    // 归列 key 仍是 trackGroup(100)，但 value 是变体 101
    expect(result.get('d1')?.get(cellKey(1, 100))).toBe(101)
  })

  it('resolvedVariantByCastId 缺失该 cast 时回退父 actionId', () => {
    const events = [damage('d1', 30)]
    const casts = [cast('c1', 1, 100, 20)]
    const result = computeCastMarkerCells(events, casts, actionsById, new Map())
    expect(result.get('d1')?.get(cellKey(1, 100))).toBe(100)
  })
})

// ─── Boss 读条配对 ────────────────────────────────────────────────────────────

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
    expect(e1.castEndTime).toBe(3.0) // (4000-1000)/1000
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
