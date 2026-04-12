import { describe, it, expect } from 'vitest'
import { formatSoumaTime } from './soumaExporter'

describe('formatSoumaTime', () => {
  it('zero → "00:00.0"', () => {
    expect(formatSoumaTime(0)).toBe('00:00.0')
  })

  it('positive < 60 → "00:ss.d"', () => {
    expect(formatSoumaTime(12.34)).toBe('00:12.3')
  })

  it('positive ≥ 60 → "mm:ss.d"', () => {
    expect(formatSoumaTime(125.45)).toBe('02:05.5')
  })

  it('positive carry: 59.95 → "01:00.0"', () => {
    expect(formatSoumaTime(59.95)).toBe('01:00.0')
  })

  it('exact minute: 60.0 → "01:00.0"', () => {
    expect(formatSoumaTime(60)).toBe('01:00.0')
  })

  it('negative integer → "-20.0"', () => {
    expect(formatSoumaTime(-20)).toBe('-20.0')
  })

  it('negative fractional → "-0.5"', () => {
    expect(formatSoumaTime(-0.5)).toBe('-0.5')
  })
})
