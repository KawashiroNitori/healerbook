// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const setLocale = vi.fn()
vi.mock('@/store/uiStore', () => ({
  useUIStore: (sel: (s: { locale: string; setLocale: typeof setLocale }) => unknown) =>
    sel({ locale: 'zh-CN', setLocale }),
}))

import LanguageToggle from './LanguageToggle'

describe('LanguageToggle', () => {
  it('opens menu and switching a language calls setLocale', () => {
    render(<LanguageToggle />)
    fireEvent.click(screen.getByRole('button', { name: 'Language' }))
    fireEvent.click(screen.getByText('English'))
    expect(setLocale).toHaveBeenCalledWith('en')
  })
})
