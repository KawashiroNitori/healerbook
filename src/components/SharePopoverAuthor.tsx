/**
 * 作者共享面板:复制链接 + 申请开关 + 编辑者列表 + 申请者列表。
 */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Check, Loader2, Trash2, X, HelpCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  fetchShareState,
  setAllowEditRequests,
  approveEditRequest,
  rejectEditRequest,
  removeEditor,
  type ShareState,
} from '@/api/timelineShareApi'
import { useTimelineStore } from '@/store/timelineStore'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'

interface SharePopoverAuthorProps {
  timelineId: string
  shareUrl: string
}

export default function SharePopoverAuthor({ timelineId, shareUrl }: SharePopoverAuthorProps) {
  const { t } = useTranslation(['share', 'common'])
  const [state, setState] = useState<ShareState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const { copied, copy } = useCopyToClipboard({
    onError: () => toast.error(t('share:sharePopoverAuthor.copyFailed')),
  })
  const [busyUserId, setBusyUserId] = useState<string | null>(null)

  useEffect(() => {
    let ignore = false
    setLoading(true)
    setError(false)
    fetchShareState(timelineId)
      .then(s => {
        if (!ignore) setState(s)
      })
      .catch(() => {
        if (!ignore) setError(true)
      })
      .finally(() => {
        if (!ignore) setLoading(false)
      })
    return () => {
      ignore = true
    }
  }, [timelineId, reloadKey])

  // 申请数变化同步到 store,使共享按钮角标与列表保持一致
  useEffect(() => {
    if (state) useTimelineStore.setState({ pendingRequestCount: state.applicants.length })
  }, [state])

  const handleToggle = async (next: boolean) => {
    if (!state) return
    const prev = state.allowEditRequests
    setState(cur => (cur ? { ...cur, allowEditRequests: next } : cur))
    try {
      await setAllowEditRequests(timelineId, next)
    } catch {
      setState(cur => (cur ? { ...cur, allowEditRequests: prev } : cur))
      toast.error(t('share:sharePopoverAuthor.setFailed'))
    }
  }

  const handleApprove = async (userId: string, userName: string) => {
    if (!state) return
    setBusyUserId(userId)
    try {
      await approveEditRequest(timelineId, userId)
      setState({
        allowEditRequests: state.allowEditRequests,
        editors: [...state.editors, { userId, userName }],
        applicants: state.applicants.filter(a => a.userId !== userId),
      })
    } catch {
      toast.error(t('share:sharePopoverAuthor.actionFailed'))
    } finally {
      setBusyUserId(null)
    }
  }

  const handleReject = async (userId: string) => {
    if (!state) return
    setBusyUserId(userId)
    try {
      await rejectEditRequest(timelineId, userId)
      setState({ ...state, applicants: state.applicants.filter(a => a.userId !== userId) })
    } catch {
      toast.error(t('share:sharePopoverAuthor.actionFailed'))
    } finally {
      setBusyUserId(null)
    }
  }

  const handleRemoveEditor = async (userId: string) => {
    if (!state) return
    setBusyUserId(userId)
    try {
      await removeEditor(timelineId, userId)
      setState({ ...state, editors: state.editors.filter(e => e.userId !== userId) })
    } catch {
      toast.error(t('share:sharePopoverAuthor.removeFailed'))
    } finally {
      setBusyUserId(null)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <input
          readOnly
          value={shareUrl}
          className="flex-1 px-2 py-1 text-xs border rounded bg-muted font-mono truncate"
        />
        <Button variant="outline" size="sm" onClick={() => copy(shareUrl)}>
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        </div>
      ) : error || !state ? (
        <div className="flex flex-col items-center gap-2 py-4">
          <p className="text-xs text-muted-foreground">
            {t('share:sharePopoverAuthor.loadFailed')}
          </p>
          <Button variant="outline" size="sm" onClick={() => setReloadKey(k => k + 1)}>
            {t('share:sharePopoverAuthor.retry')}
          </Button>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <span className="text-sm">{t('share:sharePopoverAuthor.allowEditRequests')}</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={t('share:sharePopoverAuthor.allowEditRequestsHelpLabel')}
                  >
                    <HelpCircle className="w-3.5 h-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-[220px]">
                  {t('share:sharePopoverAuthor.allowEditRequestsHelp')}
                </TooltipContent>
              </Tooltip>
            </div>
            <Switch checked={state.allowEditRequests} onCheckedChange={handleToggle} />
          </div>

          {state.editors.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">
                {t('share:sharePopoverAuthor.editors')}
              </p>
              {state.editors.map(e => (
                <div key={e.userId} className="flex items-center justify-between">
                  <span className="text-sm truncate">{e.userName}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-destructive"
                    disabled={busyUserId === e.userId}
                    onClick={() => handleRemoveEditor(e.userId)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {state.applicants.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">
                {t('share:sharePopoverAuthor.applicants')}
              </p>
              {state.applicants.map(a => (
                <div key={a.userId} className="flex items-center justify-between">
                  <span className="text-sm truncate">{a.userName}</span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-green-600 hover:text-green-700"
                      disabled={busyUserId === a.userId}
                      onClick={() => handleApprove(a.userId, a.userName)}
                    >
                      <Check className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-destructive"
                      disabled={busyUserId === a.userId}
                      onClick={() => handleReject(a.userId)}
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
