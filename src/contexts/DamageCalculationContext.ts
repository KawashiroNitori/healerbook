import { createContext, useContext } from 'react'
import type { CalculationResult } from '@/utils/mitigationCalculator'

export const DamageCalculationContext = createContext<Map<string, CalculationResult>>(new Map())

export function useDamageCalculationResults() {
  return useContext(DamageCalculationContext)
}
