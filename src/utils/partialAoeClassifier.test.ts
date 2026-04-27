import { describe, it, expect } from 'vitest'
import { classifyPartialAOE } from './partialAoeClassifier'
import type { DamageEvent, PlayerDamageDetail } from '@/types/timeline'
import type { Job } from '@/data/jobs'

// ─────────────── helpers ───────────────

interface Composition {
  players: Array<{ id: number; job: Job }>
}

/** 8 人组：2 坦（id 1,2 PLD/WAR）+ 6 非坦 */
const STD_COMP: Composition = {
  players: [
    { id: 1, job: 'PLD' },
    { id: 2, job: 'WAR' },
    { id: 3, job: 'WHM' },
    { id: 4, job: 'SCH' },
    { id: 5, job: 'SAM' },
    { id: 6, job: 'BLM' },
    { id: 7, job: 'BRD' },
    { id: 8, job: 'NIN' },
  ],
}

function detail(playerId: number, job: Job): PlayerDamageDetail {
  return {
    timestamp: 0,
    playerId,
    job,
    unmitigatedDamage: 1000,
    finalDamage: 800,
    statuses: [],
  }
}

function aoeEvent(time: number, hitPlayerIds: number[]): DamageEvent {
  return {
    id: `e-${time}`,
    name: 'evt',
    time,
    damage: 1000,
    type: 'aoe',
    damageType: 'magical',
    playerDamageDetails: hitPlayerIds.map(id => {
      const job = STD_COMP.players.find(p => p.id === id)!.job
      return detail(id, job)
    }),
  }
}

// ─────────────── tests ───────────────

describe('classifyPartialAOE', () => {
  it('一波命中全部非T → aoe，前置计数被清零', () => {
    const e1 = aoeEvent(1, [3]) // partial_aoe，hitCount[3]=1
    const e2 = aoeEvent(2, [3, 4, 5, 6, 7, 8]) // 全员
    classifyPartialAOE([e1, e2], STD_COMP)
    expect(e1.type).toBe('partial_aoe')
    expect(e2.type).toBe('aoe')
  })

  it('一波命中部分非T → partial_aoe', () => {
    const e1 = aoeEvent(1, [3, 4])
    classifyPartialAOE([e1], STD_COMP)
    expect(e1.type).toBe('partial_aoe')
  })

  it('累计后所有非T 计数 ≥ 1 → partial_final_aoe，清零', () => {
    const e1 = aoeEvent(1, [3, 4, 5]) // partial_aoe
    const e2 = aoeEvent(2, [6, 7, 8]) // partial_final_aoe（全员都被打过了）
    const e3 = aoeEvent(3, [3]) // 清零后又一波 partial_aoe
    classifyPartialAOE([e1, e2, e3], STD_COMP)
    expect(e1.type).toBe('partial_aoe')
    expect(e2.type).toBe('partial_final_aoe')
    expect(e3.type).toBe('partial_aoe')
  })

  it('多轮 partial → partial_final 循环正确', () => {
    const events = [
      aoeEvent(1, [3, 4, 5]),
      aoeEvent(2, [6, 7, 8]), // 第一次结算
      aoeEvent(3, [3, 4, 5]),
      aoeEvent(4, [6, 7, 8]), // 第二次结算
    ]
    classifyPartialAOE(events, STD_COMP)
    expect(events.map(e => e.type)).toEqual([
      'partial_aoe',
      'partial_final_aoe',
      'partial_aoe',
      'partial_final_aoe',
    ])
  })

  it('tankbuster / auto 不被改写、不参与计数', () => {
    const e1 = aoeEvent(1, [3, 4, 5])
    const tb: DamageEvent = {
      id: 'tb',
      name: 'tb',
      time: 1.5,
      damage: 5000,
      type: 'tankbuster',
      damageType: 'physical',
      playerDamageDetails: [detail(1, 'PLD'), detail(2, 'WAR')],
    }
    const auto: DamageEvent = {
      id: 'auto',
      name: 'auto',
      time: 1.7,
      damage: 1000,
      type: 'auto',
      damageType: 'physical',
      playerDamageDetails: [detail(1, 'PLD')],
    }
    const e2 = aoeEvent(2, [6, 7, 8]) // 仍然是 partial_final_aoe（tb/auto 不影响计数）
    classifyPartialAOE([e1, tb, auto, e2], STD_COMP)
    expect(e1.type).toBe('partial_aoe')
    expect(tb.type).toBe('tankbuster')
    expect(auto.type).toBe('auto')
    expect(e2.type).toBe('partial_final_aoe')
  })

  it('非 T 全集为空（8 坦极端组）→ 不修改任何事件', () => {
    const allTanks: Composition = {
      players: [
        { id: 1, job: 'PLD' },
        { id: 2, job: 'WAR' },
        { id: 3, job: 'DRK' },
        { id: 4, job: 'GNB' },
      ],
    }
    const e1 = aoeEvent(1, [1, 2])
    classifyPartialAOE([e1], allTanks)
    expect(e1.type).toBe('aoe')
  })

  it('composition 缺失 → 不修改任何事件', () => {
    const e1 = aoeEvent(1, [3, 4])
    classifyPartialAOE([e1], undefined)
    expect(e1.type).toBe('aoe')
  })

  it('playerDamageDetails 为空 → 跳过该事件，不计数', () => {
    const e1: DamageEvent = {
      id: 'e1',
      name: 'no-details',
      time: 1,
      damage: 0,
      type: 'aoe',
      damageType: 'magical',
      playerDamageDetails: [],
    }
    const e2 = aoeEvent(2, [3, 4, 5, 6, 7, 8]) // 全员
    classifyPartialAOE([e1, e2], STD_COMP)
    expect(e1.type).toBe('aoe') // 不被改写
    expect(e2.type).toBe('aoe')
  })

  it('同一非T 在事件里出现多次 detail → 计数只 +1（去重）', () => {
    const dup: DamageEvent = {
      id: 'dup',
      name: 'dup',
      time: 1,
      damage: 1000,
      type: 'aoe',
      damageType: 'magical',
      // 玩家 3 出现 3 次（多伤害包），玩家 4 出现 1 次
      playerDamageDetails: [detail(3, 'WHM'), detail(3, 'WHM'), detail(3, 'WHM'), detail(4, 'SCH')],
    }
    const next1 = aoeEvent(2, [5])
    const next2 = aoeEvent(3, [6])
    const next3 = aoeEvent(4, [7])
    const next4 = aoeEvent(5, [8])
    // dup 把 3,4 各计 1 次；next1..4 各加 5,6,7,8 → 计数 3:1,4:1,5:1,6:1,7:1,8:1
    // next4 加完后所有 ≥1 → partial_final_aoe
    classifyPartialAOE([dup, next1, next2, next3, next4], STD_COMP)
    expect(dup.type).toBe('partial_aoe')
    expect(next1.type).toBe('partial_aoe')
    expect(next2.type).toBe('partial_aoe')
    expect(next3.type).toBe('partial_aoe')
    expect(next4.type).toBe('partial_final_aoe')
  })

  it('只命中坦克的"伪 aoe"（refine 没改成 tankbuster）保留 aoe，不动计数', () => {
    const tankOnlyButAOE: DamageEvent = {
      id: 'fake',
      name: 'fake',
      time: 1,
      damage: 5000,
      type: 'aoe', // refine 验证伤害量阈值未达，回退到了 aoe
      damageType: 'physical',
      playerDamageDetails: [detail(1, 'PLD')],
    }
    const e2 = aoeEvent(2, [3, 4, 5, 6, 7, 8])
    classifyPartialAOE([tankOnlyButAOE, e2], STD_COMP)
    expect(tankOnlyButAOE.type).toBe('aoe')
    expect(e2.type).toBe('aoe')
  })

  it('event 已按时间升序传入；调用方负责排序', () => {
    // 调用方约定：传入前已 sort by time
    const events = [aoeEvent(1, [3]), aoeEvent(2, [4]), aoeEvent(3, [5, 6, 7, 8])]
    classifyPartialAOE(events, STD_COMP)
    expect(events.map(e => e.type)).toEqual(['partial_aoe', 'partial_aoe', 'partial_final_aoe'])
  })
})
