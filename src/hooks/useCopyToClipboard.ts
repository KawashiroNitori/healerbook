import { useCallback, useEffect, useRef, useState } from 'react'

interface UseCopyToClipboardOptions {
  /** 回弹延时（毫秒），默认 2000 */
  resetDelayMs?: number
  /** 复制成功后的副作用（埋点等） */
  onCopied?: () => void
  /** 复制失败时的处理（toast 等） */
  onError?: (err: unknown) => void
}

/**
 * 复制到剪贴板 + 延时回弹的 copied 状态。
 * 统一 SharePopover / SharePopoverAuthor / ExportSoumaDialog 三处重复实现：
 * 计时器经 ref 管理，卸载时清理，连续点击重置计时器。
 */
export function useCopyToClipboard({
  resetDelayMs = 2000,
  onCopied,
  onError,
}: UseCopyToClipboardOptions = {}) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => setCopied(false), resetDelayMs)
        onCopied?.()
      } catch (err) {
        onError?.(err)
      }
    },
    [resetDelayMs, onCopied, onError]
  )

  return { copied, copy }
}
