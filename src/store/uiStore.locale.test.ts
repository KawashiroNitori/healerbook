// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

const changeLanguage = vi.hoisted(() => vi.fn())
vi.mock('@/i18n', () => ({
  default: { changeLanguage },
  getInitialLocale: () => 'zh-CN',
  getKonvaFontFamily: () => 'Arial, sans-serif',
  ensureLocaleLoaded: () => Promise.resolve(),
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
  it('setLocale writes localStorage and calls i18n.changeLanguage', async () => {
    useUIStore.getState().setLocale('en')
    expect(useUIStore.getState().locale).toBe('en')
    expect(localStorage.getItem('locale')).toBe('en')
    // changeLanguage 现在排在 catalog 按需加载之后，需让出一个微任务再断言
    await vi.waitFor(() => expect(changeLanguage).toHaveBeenCalledWith('en'))
  })
})
