/**
 * 通用模态框组件
 * 提供点击空白处关闭的能力，带出入动画和背景模糊
 */

import * as React from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

interface ModalProps {
  /** 是否打开 */
  open: boolean
  /** 关闭回调 */
  onClose: () => void
  /** 子元素 */
  children: React.ReactNode
  /** 是否禁止点击空白处关闭（例如加载中） */
  disableBackdropClick?: boolean
  /** 内容区域的最大宽度 */
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl'
  /** 自定义类名 */
  className?: string
}

const maxWidthClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
}

export function Modal({
  open,
  onClose,
  children,
  disableBackdropClick = false,
  maxWidth = 'md',
  className,
}: ModalProps) {
  const [mounted, setMounted] = React.useState(false)
  const [visible, setVisible] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setMounted(true)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true))
      })
    } else {
      setVisible(false)
    }
  }, [open])

  const handleTransitionEnd = () => {
    if (!visible) setMounted(false)
  }

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && !disableBackdropClick) {
      onClose()
    }
  }

  React.useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!mounted) return null

  return createPortal(
    <div
      className={cn(
        'fixed inset-0 flex items-center justify-center z-50 transition-all duration-200',
        visible ? 'bg-black/80 backdrop-blur-sm' : 'bg-black/0 backdrop-blur-none'
      )}
      onClick={handleBackdropClick}
      onTransitionEnd={handleTransitionEnd}
    >
      <div
        className={cn(
          'bg-background rounded-lg shadow-lg w-full mx-4 transition-all duration-200',
          visible ? 'opacity-100 scale-100' : 'opacity-0 scale-95',
          maxWidthClasses[maxWidth],
          className
        )}
      >
        {children}
      </div>
    </div>,
    document.body
  )
}

interface ModalContentProps {
  children: React.ReactNode
  className?: string
}

export function ModalContent({ children, className }: ModalContentProps) {
  return <div className={cn('p-6', className)}>{children}</div>
}

interface ModalHeaderProps {
  children: React.ReactNode
  className?: string
}

export function ModalHeader({ children, className }: ModalHeaderProps) {
  return <div className={cn('mb-4', className)}>{children}</div>
}

interface ModalTitleProps {
  children: React.ReactNode
  className?: string
}

export function ModalTitle({ children, className }: ModalTitleProps) {
  return <h2 className={cn('text-xl font-semibold', className)}>{children}</h2>
}

interface ModalFooterProps {
  children: React.ReactNode
  className?: string
}

export function ModalFooter({ children, className }: ModalFooterProps) {
  return <div className={cn('flex gap-2 justify-end pt-4', className)}>{children}</div>
}
