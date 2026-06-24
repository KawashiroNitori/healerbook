import { describe, it, expect } from 'vitest'
import { applyMove } from './moves'
import type { OptimizerContext } from './optimizer'
import type { Candidate, EvalResult } from './types'
import type { CastEvent } from '@/types/timeline'
import type { MitigationAction } from '@/types/mitigation'

const act = (id: number): MitigationAction =>
  ({
    id,
    name: `a${id}`,
    icon: '',
    jobs: ['WHM'],
    duration: 30,
    cooldown: 60,
    category: ['partywide', 'percentage'],
  }) as MitigationAction

describe('applyMove', () => {
  it('接受降总伤的 move（撤 1 加 1）', () => {
    const oldCast: CastEvent = { id: 'old', actionId: 100, timestamp: 50, playerId: 1 }
    const newCand: Candidate = {
      action: act(100),
      playerId: 1,
      start: 10,
      covers: new Set(['big']),
    }
    const totalForCasts = (casts: CastEvent[]) =>
      casts.some(c => c.timestamp === 10) ? 60000 : 100000
    const evaluator = (casts: CastEvent[]): EvalResult => ({
      total: totalForCasts(casts),
      perEvent: new Map(),
      lethal: new Set(),
      statusTimelineByPlayer: new Map(),
      resolvedVariantByCastId: new Map(),
    })
    const ctx = {
      input: { lockedCastEvents: [], damageEvents: [] } as never,
      deps: {
        generateId: () => 'new',
        buildPlacementEngine: () => ({
          canPlaceCastEvent: () => ({ ok: true }),
          findInvalidCastEvents: () => [],
        }),
      } as never,
      evaluator,
      cands: [newCand],
      added: [oldCast],
      evalState: {
        total: 100000,
        perEvent: new Map(),
        lethal: new Set(),
        statusTimelineByPlayer: new Map(),
        resolvedVariantByCastId: new Map(),
      } as EvalResult,
      infeasible: new Map(),
    } as unknown as OptimizerContext
    const accepted = applyMove(ctx, { remove: [oldCast], add: [newCand] }, () => 0)
    expect(accepted).toBe(true)
    expect(ctx.evalState.total).toBe(60000)
    expect(ctx.added.some(c => c.timestamp === 10)).toBe(true)
    expect(ctx.added.some(c => c.id === 'old')).toBe(false)
  })
  it('拒绝升总伤的 move', () => {
    const evaluator = (): EvalResult => ({
      total: 200000,
      perEvent: new Map(),
      lethal: new Set(),
      statusTimelineByPlayer: new Map(),
      resolvedVariantByCastId: new Map(),
    })
    const ctx = {
      input: { lockedCastEvents: [] } as never,
      deps: {
        generateId: () => 'n',
        buildPlacementEngine: () => ({
          canPlaceCastEvent: () => ({ ok: true }),
          findInvalidCastEvents: () => [],
        }),
      } as never,
      evaluator,
      cands: [],
      added: [],
      evalState: {
        total: 100000,
        perEvent: new Map(),
        lethal: new Set(),
        statusTimelineByPlayer: new Map(),
        resolvedVariantByCastId: new Map(),
      } as EvalResult,
      infeasible: new Map(),
    } as unknown as OptimizerContext
    const accepted = applyMove(ctx, { remove: [], add: [] }, () => 0)
    expect(accepted).toBe(false)
    expect(ctx.evalState.total).toBe(100000)
  })
})
