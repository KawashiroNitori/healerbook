// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { ReactNode, ReactElement } from 'react'
import { createContext, useContext, useState, cloneElement, isValidElement } from 'react'

/**
 * 文件级 mock：用精简实现替换 Radix DropdownMenu，
 * 使 fireEvent.click 可以正常触发菜单打开（Radix 只监听 pointerdown）。
 * 作用域仅限本测试文件，不影响其他测试。
 */
vi.mock('@/components/ui/dropdown-menu', () => {
  interface MenuState {
    open: boolean
    setOpen: (v: boolean) => void
  }
  interface RadioState {
    value: string
    onValueChange: (v: string) => void
  }

  const MenuCtx = createContext<MenuState>({ open: false, setOpen: () => {} })
  const RadioCtx = createContext<RadioState>({ value: '', onValueChange: () => {} })

  function DropdownMenu({ children }: { children?: ReactNode }) {
    const [open, setOpen] = useState(false)
    return <MenuCtx.Provider value={{ open, setOpen }}>{children}</MenuCtx.Provider>
  }

  function DropdownMenuTrigger({ children, asChild }: { children?: ReactNode; asChild?: boolean }) {
    const { setOpen } = useContext(MenuCtx)
    const open = () => setOpen(true)
    if (asChild && isValidElement(children)) {
      return cloneElement(children as ReactElement<{ onClick?: () => void }>, { onClick: open })
    }
    return <button onClick={open}>{children}</button>
  }

  function DropdownMenuContent({ children }: { children?: ReactNode }) {
    const { open } = useContext(MenuCtx)
    if (!open) return null
    return <div>{children}</div>
  }

  function DropdownMenuRadioGroup({
    children,
    value,
    onValueChange,
  }: {
    children?: ReactNode
    value?: string
    onValueChange?: (v: string) => void
  }) {
    return (
      <RadioCtx.Provider value={{ value: value ?? '', onValueChange: onValueChange ?? (() => {}) }}>
        <div>{children}</div>
      </RadioCtx.Provider>
    )
  }

  function DropdownMenuRadioItem({ children, value }: { children?: ReactNode; value: string }) {
    const { onValueChange } = useContext(RadioCtx)
    return <div onClick={() => onValueChange(value)}>{children}</div>
  }

  return {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
  }
})

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
