import { describe, it, expect, beforeEach } from 'vitest'
import type { Timeline } from '@/types/timeline'
import {
  toV2,
  hydrateFromV2,
  serializeForServer,
  toLocalStored,
  migrateV1ToV2,
  parseFromAny,
} from './timelineFormat'
import { resetIdCounter } from './shortId'

function makeEditorTimeline(): Timeline {
  return {
    id: 'tl_xxx',
    name: 'M9S 进度轴',
    description: '治疗分配',
    encounter: {
      id: 101,
      name: 'M9S',
      displayName: '致命美人',
      zone: '',
      damageEvents: [],
    },
    gameZoneId: 1321,
    composition: {
      players: [
        { id: 0, job: 'PLD' },
        { id: 1, job: 'WAR' },
        { id: 2, job: 'WHM' },
        { id: 3, job: 'SCH' },
        { id: 4, job: 'DRG' },
        { id: 5, job: 'NIN' },
        { id: 6, job: 'BRD' },
        { id: 7, job: 'BLM' },
      ],
    },
    damageEvents: [
      {
        id: 'e0',
        name: '死刑',
        time: 10,
        damage: 120000,
        type: 'tankbuster',
        damageType: 'physical',
      },
      {
        id: 'e1',
        name: '分摊',
        time: 15,
        damage: 80000,
        type: 'aoe',
        damageType: 'magical',
        snapshotTime: 14.5,
      },
    ],
    castEvents: [
      { id: 'e2', actionId: 7432, timestamp: 5, playerId: 2 },
      { id: 'e3', actionId: 7433, timestamp: 8, playerId: 3 },
    ],
    statusEvents: [],
    annotations: [
      { id: 'e4', text: 'remind', time: 20, anchor: { type: 'damageTrack' } },
      {
        id: 'e5',
        text: 'WHM 礼仪',
        time: 25,
        anchor: { type: 'skillTrack', playerId: 2, actionId: 7432 },
      },
    ],
    createdAt: 1000,
    updatedAt: 2000,
  }
}

describe('toV2 / hydrateFromV2 (editor mode)', () => {
  beforeEach(() => resetIdCounter())

  it('editor timeline roundtrip 保留所有用户可见信息', () => {
    const tl = makeEditorTimeline()
    const v2 = toV2(tl)
    expect(v2.v).toBe(2)
    expect(v2.n).toBe('M9S 进度轴')
    expect(v2.desc).toBe('治疗分配')
    expect(v2.e).toBe(101)
    expect(v2.gz).toBe(1321)
    expect(v2.c).toEqual(['PLD', 'WAR', 'WHM', 'SCH', 'DRG', 'NIN', 'BRD', 'BLM'])
    expect(v2.de.length).toBe(2)
    expect(v2.de[0]).toMatchObject({ n: '死刑', t: 10, d: 120000, ty: 1, dt: 0 })
    expect(v2.de[1]).toMatchObject({ n: '分摊', t: 15, d: 80000, ty: 0, dt: 1, st: 14.5 })
    expect(v2.ce).toEqual({
      a: [7432, 7433],
      t: [5, 8],
      p: [2, 3],
    })
    expect(v2.an).toHaveLength(2)
    expect(v2.an?.[0]).toMatchObject({ x: 'remind', t: 20, k: 0 })
    expect(v2.an?.[1]).toMatchObject({ x: 'WHM 礼仪', t: 25, k: [2, 7432] })
    expect(v2.r).toBeUndefined()
    expect(v2.ca).toBe(1000)
    expect(v2.ua).toBe(2000)

    const back = hydrateFromV2(v2, { id: 'tl_xxx' })
    expect(back.id).toBe('tl_xxx')
    expect(back.name).toBe('M9S 进度轴')
    expect(back.description).toBe('治疗分配')
    expect(back.encounter.id).toBe(101)
    expect(back.gameZoneId).toBe(1321)
    expect(back.composition.players).toHaveLength(8)
    expect(back.composition.players[2]).toEqual({ id: 2, job: 'WHM' })
    expect(back.damageEvents).toHaveLength(2)
    expect(back.damageEvents[0]).toMatchObject({
      name: '死刑',
      time: 10,
      damage: 120000,
      type: 'tankbuster',
      damageType: 'physical',
    })
    expect(back.damageEvents[1].snapshotTime).toBe(14.5)
    expect(back.castEvents).toHaveLength(2)
    expect(back.castEvents[0]).toMatchObject({ actionId: 7432, timestamp: 5, playerId: 2 })
    expect(back.annotations).toHaveLength(2)
    expect(back.annotations[0].anchor).toEqual({ type: 'damageTrack' })
    expect(back.annotations[1].anchor).toEqual({
      type: 'skillTrack',
      playerId: 2,
      actionId: 7432,
    })
  })

  it('hydrate 时为 DE/CE/Annotation 发号不冲突', () => {
    const tl = makeEditorTimeline()
    const v2 = toV2(tl)
    const back = hydrateFromV2(v2, { id: 'tl_xxx' })
    const ids = [
      ...back.damageEvents.map(e => e.id),
      ...back.castEvents.map(e => e.id),
      ...(back.annotations ?? []).map(a => a.id),
    ]
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('composition 中间空槽在 roundtrip 后保留空位', () => {
    const tl = makeEditorTimeline()
    tl.composition.players = [
      { id: 0, job: 'PLD' },
      { id: 2, job: 'WHM' },
      { id: 4, job: 'DRG' },
    ]
    const v2 = toV2(tl)
    expect(v2.c).toEqual(['PLD', '', 'WHM', '', 'DRG'])
    const back = hydrateFromV2(v2, { id: 'tl_xxx' })
    expect(back.composition.players).toEqual([
      { id: 0, job: 'PLD' },
      { id: 2, job: 'WHM' },
      { id: 4, job: 'DRG' },
    ])
  })

  it('composition 尾部 truncate 反序列化补足到 8', () => {
    const v2Base = toV2(makeEditorTimeline())
    const v2 = { ...v2Base, c: ['PLD', 'WAR', 'WHM'] }
    const back = hydrateFromV2(v2, { id: 'tl_xxx' })
    expect(back.composition.players).toEqual([
      { id: 0, job: 'PLD' },
      { id: 1, job: 'WAR' },
      { id: 2, job: 'WHM' },
    ])
  })

  it('空 CE / 空 annotations / 无 syncEvents 正常处理', () => {
    const tl: Timeline = {
      ...makeEditorTimeline(),
      castEvents: [],
      annotations: [],
    }
    const v2 = toV2(tl)
    expect(v2.ce).toEqual({ a: [], t: [], p: [] })
    expect(v2.an).toBeUndefined()
    const back = hydrateFromV2(v2, { id: 'tl_xxx' })
    expect(back.castEvents).toEqual([])
    expect(back.annotations).toEqual([])
  })
})

describe('toV2 / hydrateFromV2 (replay mode)', () => {
  beforeEach(() => resetIdCounter())

  it('replay timeline 保留 pdd 与 status 数据', () => {
    const tl: Timeline = {
      ...makeEditorTimeline(),
      isReplayMode: true,
      damageEvents: [
        {
          id: 'd1',
          name: '死刑',
          time: 10,
          damage: 120000,
          type: 'tankbuster',
          damageType: 'physical',
          playerDamageDetails: [
            {
              timestamp: 123456,
              playerId: 0,
              job: 'PLD',
              abilityId: 40000,
              unmitigatedDamage: 120000,
              finalDamage: 60000,
              statuses: [{ statusId: 1001 }, { statusId: 1002, absorb: 5000 }],
              hitPoints: 50000,
              maxHitPoints: 80000,
            },
          ],
        },
      ],
    }
    const v2 = toV2(tl)
    expect(v2.r).toBe(1)
    expect(v2.de[0].pdd).toHaveLength(1)
    // 注意：toV2 剥离 job 和 abilityId
    expect(v2.de[0].pdd?.[0]).toEqual({
      ts: 123456,
      p: 0,
      u: 120000,
      f: 60000,
      hp: 50000,
      mhp: 80000,
      ss: [{ s: 1001 }, { s: 1002, ab: 5000 }],
    })

    const back = hydrateFromV2(v2, { id: 'tl_xxx' })
    expect(back.isReplayMode).toBe(true)
    const detail = back.damageEvents[0].playerDamageDetails![0]
    expect(detail.timestamp).toBe(123456)
    expect(detail.playerId).toBe(0)
    expect(detail.unmitigatedDamage).toBe(120000)
    expect(detail.finalDamage).toBe(60000)
    expect(detail.hitPoints).toBe(50000)
    expect(detail.maxHitPoints).toBe(80000)
    expect(detail.statuses).toEqual([{ statusId: 1001 }, { statusId: 1002, absorb: 5000 }])
    // hydrate 时 job 从 composition 反查
    expect(detail.job).toBe('PLD')
    // abilityId / packetId 在 hydrate 后为 undefined
    expect(detail.abilityId).toBeUndefined()
    expect(back.damageEvents[0].packetId).toBeUndefined()
  })
})

describe('serializeForServer / toLocalStored', () => {
  beforeEach(() => resetIdCounter())

  it('serializeForServer 不包含运行时字段', () => {
    const tl: Timeline = {
      ...makeEditorTimeline(),
      isShared: true,
      serverVersion: 3,
      hasLocalChanges: false,
      everPublished: true,
    }
    const v2 = serializeForServer(tl)
    expect(v2).not.toHaveProperty('id')
    expect(v2).not.toHaveProperty('isShared')
    expect(v2).not.toHaveProperty('serverVersion')
    expect(v2).not.toHaveProperty('hasLocalChanges')
    expect(v2).not.toHaveProperty('everPublished')
    expect(v2).not.toHaveProperty('statData')
  })

  it('toLocalStored 携带运行时字段', () => {
    const tl: Timeline = {
      ...makeEditorTimeline(),
      isShared: true,
      serverVersion: 3,
      hasLocalChanges: false,
      everPublished: true,
    }
    const stored = toLocalStored(tl)
    expect(stored.v).toBe(2)
    expect(stored.id).toBe('tl_xxx')
    expect(stored.isShared).toBe(true)
    expect(stored.serverVersion).toBe(3)
    expect(stored.hasLocalChanges).toBe(false)
    expect(stored.everPublished).toBe(true)
    // V2 核心字段也在
    expect(stored.n).toBe('M9S 进度轴')
    expect(stored.de).toHaveLength(2)
  })
})

// ──────────────────────────────────────────────────────────────
// V1 → V2 迁移
// ──────────────────────────────────────────────────────────────

function makeV1EditorTimeline() {
  return {
    name: 'M9S 进度轴',
    description: '治疗分配',
    fflogsSource: { reportCode: 'abc123', fightId: 5 },
    gameZoneId: 1321,
    encounter: {
      id: 101,
      name: 'M9S',
      displayName: '致命美人',
      zone: 'some-zone',
      damageEvents: [{ fake: true }],
    },
    composition: {
      players: [
        { id: 0, job: 'PLD' },
        { id: 1, job: 'WAR' },
        { id: 2, job: 'WHM' },
        { id: 3, job: 'SCH' },
        { id: 4, job: 'DRG' },
        { id: 5, job: 'NIN' },
        { id: 6, job: 'BRD' },
        { id: 7, job: 'BLM' },
      ],
    },
    damageEvents: [
      {
        id: 'old-de-1',
        name: '死刑',
        time: 10,
        damage: 120000,
        type: 'tankbuster',
        damageType: 'physical',
        targetPlayerId: 0,
        packetId: 999,
      },
      {
        id: 'old-de-2',
        name: '分摊',
        time: 15,
        damage: 80000,
        type: 'aoe',
        damageType: 'magical',
        snapshotTime: 14.5,
      },
    ],
    castEvents: [
      { id: 'old-ce-1', actionId: 7432, timestamp: 8, playerId: 2, job: 'WHM', targetPlayerId: 0 },
      { id: 'old-ce-2', actionId: 7433, timestamp: 5, playerId: 3, job: 'SCH' },
    ],
    annotations: [
      { id: 'old-an-1', text: 'remind', time: 20, anchor: { type: 'damageTrack' } },
      {
        id: 'old-an-2',
        text: 'WHM 礼仪',
        time: 25,
        anchor: { type: 'skillTrack', playerId: 2, actionId: 7432 },
      },
    ],
    syncEvents: [
      {
        time: 3,
        type: 'begincast',
        actionId: 0x1234,
        actionName: 'Boss Cast',
        window: [2, 3] as [number, number],
        syncOnce: true,
      },
    ],
    createdAt: 1000,
    updatedAt: 2000,
  }
}

describe('migrateV1ToV2', () => {
  it('V1 editor mode → V2 正确转换', () => {
    const v1 = makeV1EditorTimeline()
    const v2 = migrateV1ToV2(v1)

    // 基本
    expect(v2.v).toBe(2)
    expect(v2.n).toBe('M9S 进度轴')
    expect(v2.desc).toBe('治疗分配')
    expect(v2.e).toBe(101)
    expect(v2.gz).toBe(1321)
    expect(v2.fs).toEqual({ rc: 'abc123', fi: 5 })
    expect(v2.ca).toBe(1000)
    expect(v2.ua).toBe(2000)
    expect(v2.r).toBeUndefined()

    // composition 8-slot sparse
    expect(v2.c).toEqual(['PLD', 'WAR', 'WHM', 'SCH', 'DRG', 'NIN', 'BRD', 'BLM'])

    // DE: short keys, stripped id/targetPlayerId/packetId
    expect(v2.de).toHaveLength(2)
    expect(v2.de[0]).toEqual({ n: '死刑', t: 10, d: 120000, ty: 1, dt: 0 })
    expect(v2.de[1]).toMatchObject({ n: '分摊', t: 15, d: 80000, ty: 0, dt: 1, st: 14.5 })

    // CE: columnar, sorted by timestamp (5 before 8)
    expect(v2.ce).toEqual({
      a: [7433, 7432],
      t: [5, 8],
      p: [3, 2],
    })

    // annotations
    expect(v2.an).toHaveLength(2)
    expect(v2.an![0]).toEqual({ x: 'remind', t: 20, k: 0 })
    expect(v2.an![1]).toEqual({ x: 'WHM 礼仪', t: 25, k: [2, 7432] })

    // syncEvents
    expect(v2.se).toHaveLength(1)
    expect(v2.se![0]).toEqual({ t: 3, ty: 0, a: 0x1234, nm: 'Boss Cast', w: [2, 3], so: 1 })
  })

  it('V1 replay mode → V2 保留 pdd 并剥离死字段', () => {
    const v1 = {
      ...makeV1EditorTimeline(),
      isReplayMode: true,
      damageEvents: [
        {
          id: 'old-rd',
          name: '死刑',
          time: 10,
          damage: 120000,
          type: 'tankbuster',
          damageType: 'physical',
          targetPlayerId: 0,
          packetId: 999,
          playerDamageDetails: [
            {
              timestamp: 123456,
              packetId: 888,
              sourceId: 777,
              playerId: 0,
              job: 'PLD',
              abilityId: 40000,
              skillName: 'Old Skill',
              unmitigatedDamage: 120000,
              finalDamage: 60000,
              overkill: 5000,
              multiplier: 1.2,
              statuses: [
                { statusId: 1001, targetPlayerId: 0 },
                { statusId: 1002, absorb: 5000 },
              ],
              hitPoints: 50000,
              maxHitPoints: 80000,
            },
          ],
        },
      ],
    }

    const v2 = migrateV1ToV2(v1)
    expect(v2.r).toBe(1)
    expect(v2.de[0].pdd).toHaveLength(1)
    const pdd = v2.de[0].pdd![0]
    // 保留的字段
    expect(pdd.ts).toBe(123456)
    expect(pdd.p).toBe(0)
    expect(pdd.u).toBe(120000)
    expect(pdd.f).toBe(60000)
    expect(pdd.o).toBe(5000)
    expect(pdd.m).toBe(1.2)
    expect(pdd.hp).toBe(50000)
    expect(pdd.mhp).toBe(80000)
    // 死字段不在输出
    expect(pdd).not.toHaveProperty('packetId')
    expect(pdd).not.toHaveProperty('sourceId')
    expect(pdd).not.toHaveProperty('skillName')
    expect(pdd).not.toHaveProperty('job')
    expect(pdd).not.toHaveProperty('abilityId')
    // status: targetPlayerId stripped
    expect(pdd.ss).toEqual([{ s: 1001 }, { s: 1002, ab: 5000 }])
  })
})

// ──────────────────────────────────────────────────────────────
// parseFromAny
// ──────────────────────────────────────────────────────────────

describe('parseFromAny', () => {
  beforeEach(() => resetIdCounter())

  it('v === 2 直接走 V2 分支', () => {
    const tl = makeEditorTimeline()
    const v2 = toV2(tl)
    const result = parseFromAny(v2, { id: 'tl_test' })
    expect(result.id).toBe('tl_test')
    expect(result.name).toBe('M9S 进度轴')
    expect(result.damageEvents).toHaveLength(2)
  })

  it('无 v 字段走 V1 迁移', () => {
    const v1 = makeV1EditorTimeline()
    const result = parseFromAny(v1, { id: 'tl_migrated' })
    expect(result.id).toBe('tl_migrated')
    expect(result.name).toBe('M9S 进度轴')
    expect(result.damageEvents).toHaveLength(2)
    expect(result.castEvents).toHaveLength(2)
    // CE sorted by timestamp
    expect(result.castEvents[0].timestamp).toBe(5)
    expect(result.castEvents[1].timestamp).toBe(8)
  })

  it('non-object 抛出异常', () => {
    expect(() => parseFromAny(null)).toThrow('Invalid timeline: not a plain object')
    expect(() => parseFromAny('string')).toThrow('Invalid timeline: not a plain object')
    expect(() => parseFromAny([1, 2])).toThrow('Invalid timeline: not a plain object')
    expect(() => parseFromAny(42)).toThrow('Invalid timeline: not a plain object')
  })
})
