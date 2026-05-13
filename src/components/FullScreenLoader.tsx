import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'

// 与 index.html 内联 loader 共用同一个阈值：从 performance.timeOrigin（≈ 导航开始）
// 起算 2s 后才显示，避免快速加载时的 loader 闪屏
const SHOW_AFTER_MS = 2000

export default function FullScreenLoader() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const remaining = Math.max(0, SHOW_AFTER_MS - performance.now())
    const timer = window.setTimeout(() => setVisible(true), remaining)
    return () => window.clearTimeout(timer)
  }, [])

  if (!visible) return null

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
    </div>
  )
}
