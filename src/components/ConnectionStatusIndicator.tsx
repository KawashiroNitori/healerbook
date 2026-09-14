import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, WifiOff } from 'lucide-react'
import { useTimelineStore } from '@/store/timelineStore'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { retrySecondsLeft } from './connectionRetry'

/** 失败态气泡文案;仅在气泡打开时挂载,挂载即取当前时间,每 500ms 刷新倒计时 */
function RetryHint({ nextRetryAt }: { nextRetryAt: number }) {
  const { t } = useTranslation('editor')
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [])
  return <>{t('editor:connection.retryHint', { seconds: retrySecondsLeft(nextRetryAt, now) })}</>
}

/**
 * 编辑器右上角的远端 WS 连接状态。
 * 仅在「连接中」与「网络原因失败、等待自动重连」时显示;
 * 本地时间轴 / 只读查看 / 已连接 / 业务原因终态断开(disconnected)一律不渲染。
 */
export default function ConnectionStatusIndicator() {
  const { t } = useTranslation('editor')
  const sessionRole = useTimelineStore(s => s.sessionRole)
  const connectionStatus = useTimelineStore(s => s.connectionStatus)
  const nextRetryAt = useTimelineStore(s => s.nextRetryAt)
  const reconnectNow = useTimelineStore(s => s.reconnectNow)

  if (sessionRole === 'local' || sessionRole === 'viewer') return null

  if (connectionStatus === 'connecting') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {t('editor:connection.connecting')}
      </span>
    )
  }

  if (connectionStatus === 'failed') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={reconnectNow}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-destructive transition-colors hover:bg-destructive/10"
          >
            <WifiOff className="h-3.5 w-3.5" />
            {t('editor:connection.failed')}
          </button>
        </TooltipTrigger>
        {nextRetryAt !== null && (
          <TooltipContent side="bottom">
            <RetryHint nextRetryAt={nextRetryAt} />
          </TooltipContent>
        )}
      </Tooltip>
    )
  }

  return null
}
