import { createContext, useContext } from 'react'
import type { CalculationResult } from '@/utils/mitigationCalculator'
import type { DamageCalculationResult, StatusTimelineByPlayer } from '@/hooks/useDamageCalculation'

const emptyContext: DamageCalculationResult = {
  results: new Map(),
  statusTimelineByPlayer: new Map(),
  castEffectiveEndByCastEventId: new Map(),
  healSnapshots: [],
  hpTimeline: [],
  simulate: null,
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

export function useDamageCalculationSimulate(): DamageCalculationResult['simulate'] {
  return useContext(DamageCalculationContext).simulate
}

export function useHpTimeline(): DamageCalculationResult['hpTimeline'] {
  return useContext(DamageCalculationContext).hpTimeline
}
