// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

let mockLocale = 'en'
vi.mock('@/store/uiStore', () => ({
  useUIStore: (sel: (s: { locale: string }) => unknown) => sel({ locale: mockLocale }),
}))

vi.mock('@/i18n/progress.json', () => ({
  default: { en: { translated: 100, approved: 42 } },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

import TranslationBanner from './TranslationBanner'

describe('TranslationBanner', () => {
  beforeEach(() => {
    mockLocale = 'en'
  })

  it('源语言下不渲染', () => {
    mockLocale = 'zh-CN'
    const { container } = render(<TranslationBanner />)
    expect(container.firstChild).toBeNull()
  })

  it('未登记进度的语言不渲染', () => {
    mockLocale = 'ja'
    const { container } = render(<TranslationBanner />)
    expect(container.firstChild).toBeNull()
  })

  it('非源语言下展示征集窄条', () => {
    render(<TranslationBanner />)
    expect(screen.getByText('home:translationBanner.cta')).toBeTruthy()
  })

  it('点击窄条弹出进度与 Crowdin 链接', () => {
    render(<TranslationBanner />)
    fireEvent.click(screen.getByText('home:translationBanner.cta'))
    // 两个百分比分别对应翻译率与审校率
    expect(screen.getByText('100%')).toBeTruthy()
    expect(screen.getByText('42%')).toBeTruthy()
    const link = screen.getByRole('link', { name: /goToCrowdin/ })
    expect(link.getAttribute('href')).toBe('https://crowdin.com/project/healerbook')
    expect(link.getAttribute('rel')).toContain('noopener')
  })
})
