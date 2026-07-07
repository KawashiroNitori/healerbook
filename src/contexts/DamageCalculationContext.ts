import { createContext, useContext } from 'react'
import type { CalculationResult } from '@/types/calculation'
import type { DamageCalculationResult, StatusTimelineByPlayer } from '@/hooks/useDamageCalculation'

const emptyContext: DamageCalculationResult = {
  results: new Map(),
  statusTimelineByPlayer: new Map(),
  castEffectiveEndByCastEventId: new Map(),
  resolvedVariantByCastId: new Map(),
  healSnapshots: [],
  hpTimeline: [],
  removalTimelinesByExcludeId: new Map(),
  isPending: false,
}

export const DamageCalculationContext = createContext<DamageCalculationResult>(emptyContext)

export function useDamageCalculationResults(): Map<string, CalculationResult> {
  return useContext(DamageCalculationContext).results
}

export function useStatusTimelineByPlayer(): StatusTimelineByPlayer {
  return useContext(DamageCalculationContext).statusTimelineByPlayer
}

export function useCastEffectiveEnd(): Map<string, number> {
  return useContext(DamageCalculationContext).castEffectiveEndByCastEventId
}

export function useResolvedVariantByCastId(): Map<string, number> {
  return useContext(DamageCalculationContext).resolvedVariantByCastId
}

export function useRemovalTimelinesByExcludeId(): Map<string, StatusTimelineByPlayer> {
  return useContext(DamageCalculationContext).removalTimelinesByExcludeId
}

export function useHpTimeline(): DamageCalculationResult['hpTimeline'] {
  return useContext(DamageCalculationContext).hpTimeline
}

export function useDamageCalculationPending(): boolean {
  return useContext(DamageCalculationContext).isPending
}
