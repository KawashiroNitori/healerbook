import { createContext, useContext } from 'react'
import type { CalculationResult } from '@/utils/mitigationCalculator'
import type { DamageCalculationResult, StatusTimelineByPlayer } from '@/hooks/useDamageCalculation'

const emptyContext: DamageCalculationResult = {
  results: new Map(),
  statusTimelineByPlayer: new Map(),
  simulate: null,
}

export const DamageCalculationContext = createContext<DamageCalculationResult>(emptyContext)

export function useDamageCalculationResults(): Map<string, CalculationResult> {
  return useContext(DamageCalculationContext).results
}

export function useStatusTimelineByPlayer(): StatusTimelineByPlayer {
  return useContext(DamageCalculationContext).statusTimelineByPlayer
}

export function useDamageCalculationSimulate(): DamageCalculationResult['simulate'] {
  return useContext(DamageCalculationContext).simulate
}
