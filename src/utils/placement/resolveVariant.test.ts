import { describe, it, expect } from 'vitest'
import { resolveVariant } from './resolveVariant'
import { MITIGATION_DATA } from '@/data/mitigationActions'
import type { MitigationStatus } from '@/types/status'

const byId = new Map(MITIGATION_DATA.actions.map(a => [a.id, a]))
const parent = byId.get(37013)! // 意气轩昂之策(无 Seraphism 合法)
const members = MITIGATION_DATA.actions.filter(a => (a.trackGroup ?? a.id) === 37013)
const SERAPHISM = 3885 // 炽天附体 buff id(见 mitigationActions.ts SERAPHISM_BUFF_ID)

function status(statusId: number, playerId: number): MitigationStatus {
  return { instanceId: 'x', statusId, startTime: 0, endTime: 999, sourcePlayerId: playerId }
}

describe('resolveVariant', () => {
  it('无 Seraphism → 意气轩昂之策(37013)', () => {
    expect(resolveVariant(parent, members, 6, 100, []).id).toBe(37013)
  })
  it('Seraphism 在场 → 降临之章(37016)', () => {
    expect(resolveVariant(parent, members, 6, 100, [status(SERAPHISM, 6)]).id).toBe(37016)
  })
  it('Seraphism 属于别的玩家 → 仍是 37013(只看自己的 buff)', () => {
    expect(resolveVariant(parent, members, 6, 100, [status(SERAPHISM, 7)]).id).toBe(37013)
  })
  it('单成员组直接返回父', () => {
    const solo = byId.get(37014)! // 炽天附体,无同组变体
    expect(resolveVariant(solo, [solo], 6, 100, []).id).toBe(37014)
  })
})
