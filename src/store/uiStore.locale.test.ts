// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

const changeLanguage = vi.hoisted(() => vi.fn())
vi.mock('@/i18n', () => ({
  default: { changeLanguage },
  getInitialLocale: () => 'zh-CN',
  getKonvaFontFamily: () => 'Arial, sans-serif',
  NAMESPACES: ['common'],
}))

import { useUIStore } from './uiStore'

describe('uiStore locale', () => {
  beforeEach(() => {
    changeLanguage.mockClear()
    localStorage.clear()
  })
  it('defaults to getInitialLocale()', () => {
    expect(useUIStore.getState().locale).toBe('zh-CN')
  })
  it('setLocale writes localStorage and calls i18n.changeLanguage', () => {
    useUIStore.getState().setLocale('en')
    expect(useUIStore.getState().locale).toBe('en')
    expect(localStorage.getItem('locale')).toBe('en')
    expect(changeLanguage).toHaveBeenCalledWith('en')
  })
})
