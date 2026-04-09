import { describe, it, expect } from 'vitest'
import { deriveSkillTracks } from './skillTracks'
import type { Composition } from '@/types/timeline'
import type { MitigationAction } from '@/types/mitigation'

const makeAction = (id: number, jobs: MitigationAction['jobs'], hidden = false): MitigationAction =>
  ({
    id,
    name: `action-${id}`,
    icon: `/icon-${id}.png`,
    jobs,
    duration: 10,
    cooldown: 60,
    hidden,
    executor: () => ({ players: [], statuses: [], timestamp: 0 }),
  }) as unknown as MitigationAction

describe('deriveSkillTracks', () => {
  const composition: Composition = {
    players: [
      { id: 1, job: 'WHM' },
      { id: 2, job: 'PLD' },
    ],
  }

  it('按职业顺序排序并展开每个玩家的可用技能', () => {
    const actions = [makeAction(100, ['WHM']), makeAction(200, ['PLD'])]
    const result = deriveSkillTracks(composition, new Set(), actions)
    // PLD (坦克) 应排在 WHM (治疗) 之前
    expect(result.map(t => t.playerId)).toEqual([2, 1])
    expect(result.map(t => t.actionId)).toEqual([200, 100])
  })

  it('过滤掉 hiddenPlayerIds 中的玩家', () => {
    const actions = [makeAction(100, ['WHM']), makeAction(200, ['PLD'])]
    const result = deriveSkillTracks(composition, new Set([2]), actions)
    expect(result.map(t => t.playerId)).toEqual([1])
  })

  it('过滤掉 hidden 技能', () => {
    const actions = [makeAction(100, ['WHM']), makeAction(101, ['WHM'], true)]
    const result = deriveSkillTracks(composition, new Set(), actions)
    expect(result.map(t => t.actionId)).toEqual([100])
  })

  it('空 composition 返回空数组', () => {
    const result = deriveSkillTracks({ players: [] }, new Set(), [])
    expect(result).toEqual([])
  })

  it('一个玩家有多个可用技能则全部展开，顺序与 actions 数组一致', () => {
    const actions = [makeAction(100, ['WHM']), makeAction(101, ['WHM']), makeAction(102, ['WHM'])]
    const result = deriveSkillTracks({ players: [{ id: 1, job: 'WHM' }] }, new Set(), actions)
    expect(result.map(t => t.actionId)).toEqual([100, 101, 102])
  })
})
