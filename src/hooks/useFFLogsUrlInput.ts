/**
 * FFLogs URL 输入框公共状态：受控 value + 实时解析 + 剪贴板自动填充。
 * initialUrl 有值时跳过剪贴板（预填场景不覆盖）；enabled 供常驻挂载的
 * Dialog 用 open 控制生效时机。
 */
import { useEffect, useRef, useState } from 'react'
import { parseFFLogsUrl } from '@/utils/fflogsParser'

interface UseFFLogsUrlInputOptions {
  initialUrl?: string
  enabled?: boolean
}

export function useFFLogsUrlInput({ initialUrl, enabled = true }: UseFFLogsUrlInputOptions = {}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState(initialUrl ?? '')

  const parsed = url ? parseFFLogsUrl(url) : null
  const isValid = !!parsed?.reportCode

  useEffect(() => {
    if (!enabled) return
    inputRef.current?.focus()
    if (initialUrl) return

    void (async () => {
      try {
        const text = await navigator.clipboard.readText()
        if (text && /fflogs\.com\/reports\//.test(text)) setUrl(text)
      } catch (err) {
        console.debug('无法读取剪贴板:', err)
      }
    })()
  }, [enabled, initialUrl])

  return { inputRef, url, setUrl, parsed, isValid }
}
