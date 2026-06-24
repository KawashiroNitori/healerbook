/**
 * Vitest / jsdom stub for shadcn dropdown-menu.
 * Replaces Radix-UI portal/pointer-event logic with plain HTML so
 * @testing-library fireEvent.click works without PointerEvent polyfills.
 */
import {
  createContext,
  useContext,
  useState,
  type ReactNode,
  type ReactElement,
  cloneElement,
  isValidElement,
} from 'react'

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

export function DropdownMenu({ children }: { children?: ReactNode }) {
  const [open, setOpen] = useState(false)
  return <MenuCtx.Provider value={{ open, setOpen }}>{children}</MenuCtx.Provider>
}

export function DropdownMenuTrigger({
  children,
  asChild,
}: {
  children?: ReactNode
  asChild?: boolean
}) {
  const { setOpen } = useContext(MenuCtx)
  const open = () => setOpen(true)
  if (asChild && isValidElement(children)) {
    return cloneElement(children as ReactElement<{ onClick?: () => void }>, { onClick: open })
  }
  return <button onClick={open}>{children}</button>
}

export function DropdownMenuContent({ children }: { children?: ReactNode }) {
  const { open } = useContext(MenuCtx)
  if (!open) return null
  return <div>{children}</div>
}

export function DropdownMenuRadioGroup({
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

export function DropdownMenuRadioItem({
  children,
  value,
}: {
  children?: ReactNode
  value: string
}) {
  const { onValueChange } = useContext(RadioCtx)
  return <div onClick={() => onValueChange(value)}>{children}</div>
}
