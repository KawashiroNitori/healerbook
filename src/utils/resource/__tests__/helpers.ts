/**
 * src/utils/resource 下测试共用的 helper 工厂
 */

import type { MitigationAction } from '@/types/mitigation'
import type { CastEvent } from '@/types/timeline'

export function makeAction(partial: Partial<MitigationAction> & { id: number }): MitigationAction {
  return {
    name: 'A',
    icon: '',
    jobs: [] as unknown as MitigationAction['jobs'],
    category: ['partywide'],
    duration: 0,
    cooldown: 60,
    ...partial,
  } as MitigationAction
}

export function makeCast(
  partial: Partial<CastEvent> & { id: string; actionId: number }
): CastEvent {
  return { playerId: 10, timestamp: 0, ...partial } as CastEvent
}
