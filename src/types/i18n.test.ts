import { describe, it, expect } from 'vitest'
import { normalizeLocale, isAppLanguage, DEFAULT_LOCALE } from './i18n'

describe('normalizeLocale', () => {
  it('maps Traditional Chinese variants to zh-TW', () => {
    expect(normalizeLocale('zh-TW')).toBe('zh-TW')
    expect(normalizeLocale('zh-HK')).toBe('zh-TW')
    expect(normalizeLocale('zh-Hant')).toBe('zh-TW')
    expect(normalizeLocale('zh-Hant-TW')).toBe('zh-TW')
  })
  it('maps other Chinese to zh-CN', () => {
    expect(normalizeLocale('zh')).toBe('zh-CN')
    expect(normalizeLocale('zh-CN')).toBe('zh-CN')
    expect(normalizeLocale('zh-Hans')).toBe('zh-CN')
  })
  it('maps en/ja/de/fr by prefix', () => {
    expect(normalizeLocale('en-US')).toBe('en')
    expect(normalizeLocale('ja-JP')).toBe('ja')
    expect(normalizeLocale('de')).toBe('de')
    expect(normalizeLocale('fr-FR')).toBe('fr')
  })
  it('falls back to default for unknown/empty', () => {
    expect(normalizeLocale('ko')).toBe(DEFAULT_LOCALE)
    expect(normalizeLocale('')).toBe(DEFAULT_LOCALE)
    expect(normalizeLocale(null)).toBe(DEFAULT_LOCALE)
    expect(normalizeLocale(undefined)).toBe(DEFAULT_LOCALE)
  })
})

describe('isAppLanguage', () => {
  it('accepts supported, rejects others', () => {
    expect(isAppLanguage('en')).toBe(true)
    expect(isAppLanguage('zh-CN')).toBe(true)
    expect(isAppLanguage('ko')).toBe(false)
    expect(isAppLanguage(null)).toBe(false)
  })
})
