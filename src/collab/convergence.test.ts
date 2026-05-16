import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import { buildYDoc, projectTimeline, yUpdateDamageEvent, yAddCastEvent } from './docSchema'
import type { TimelineContent } from './types'

const base: TimelineContent = {
  name: 'base',
  encounter: { id: 1, name: 'E', displayName: 'E', zone: '', damageEvents: [] },
  composition: { players: [{ id: 1, job: 'PLD' }] },
  damageEvents: [
    { id: 'd1', name: 'A', time: 10, damage: 100, type: 'aoe', damageType: 'magical' },
  ],
  castEvents: [],
  annotations: [],
  createdAt: 0,
}

/** 从同一基线 update 派生两个 Y.Doc(共同祖先) */
function fork(content: TimelineContent): [Y.Doc, Y.Doc] {
  const seed = Y.encodeStateAsUpdate(buildYDoc(content))
  const a = new Y.Doc()
  Y.applyUpdate(a, seed)
  const b = new Y.Doc()
  Y.applyUpdate(b, seed)
  return [a, b]
}

function syncBothWays(a: Y.Doc, b: Y.Doc): void {
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)))
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)))
}

describe('CRDT 收敛', () => {
  it('两端改同一事件的不同字段 → 合并后都保留', () => {
    const [a, b] = fork(base)
    yUpdateDamageEvent(a, 'd1', { time: 99 })
    yUpdateDamageEvent(b, 'd1', { damage: 555 })
    syncBothWays(a, b)
    const pa = projectTimeline(a).damageEvents[0]
    const pb = projectTimeline(b).damageEvents[0]
    expect(pa).toEqual(pb)
    expect(pa.time).toBe(99)
    expect(pa.damage).toBe(555)
  })

  it('两端各加不同 castEvent → 合并后都在', () => {
    const [a, b] = fork(base)
    yAddCastEvent(a, { id: 'ca', actionId: 1, timestamp: 1, playerId: 1 })
    yAddCastEvent(b, { id: 'cb', actionId: 2, timestamp: 2, playerId: 1 })
    syncBothWays(a, b)
    expect(
      projectTimeline(a)
        .castEvents.map(c => c.id)
        .sort()
    ).toEqual(['ca', 'cb'])
    expect(
      projectTimeline(b)
        .castEvents.map(c => c.id)
        .sort()
    ).toEqual(['ca', 'cb'])
  })
})
