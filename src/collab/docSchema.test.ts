import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import { buildYDoc } from './docSchema'
import { Y_MAP } from './constants'
import type { TimelineContent } from './types'

const sample: TimelineContent = {
  name: '测试',
  encounter: { id: 1, name: 'E', displayName: 'E', zone: '', damageEvents: [] },
  composition: {
    players: [
      { id: 1, job: 'PLD' },
      { id: 2, job: 'WHM' },
    ],
  },
  damageEvents: [
    { id: 'd1', name: 'AOE', time: 10, damage: 1000, type: 'aoe', damageType: 'magical' },
  ],
  castEvents: [{ id: 'c1', actionId: 100, timestamp: 5, playerId: 1 }],
  annotations: [{ id: 'a1', text: '注释', time: 8, anchor: { type: 'damageTrack' } }],
  createdAt: 1000,
}

describe('buildYDoc', () => {
  it('把内容写进 Y.Doc 的对应 Map', () => {
    const doc = buildYDoc(sample)
    expect(doc.getMap(Y_MAP.meta).get('name')).toBe('测试')
    const de = doc.getMap(Y_MAP.damageEvents)
    expect(de.size).toBe(1)
    expect((de.get('d1') as Y.Map<unknown>).get('damage')).toBe(1000)
    expect(doc.getMap(Y_MAP.castEvents).size).toBe(1)
    expect(doc.getMap(Y_MAP.annotations).size).toBe(1)
    expect((doc.getMap(Y_MAP.composition).get('1') as Y.Map<unknown>).get('job')).toBe('PLD')
  })
})
