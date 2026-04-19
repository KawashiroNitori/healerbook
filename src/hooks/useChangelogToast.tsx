import { useEffect } from 'react'
import { toast } from 'sonner'
import { track } from '@/utils/analytics'

const CHANGELOG_URL = '/docs/changelog'
const LS_KEY = 'last_seen_release_id'

interface LatestRelease {
  id: string
  date: string
  html: string
  /** 可选：覆盖"查看详情"按钮的跳转目标（在 changelog 条目首行用 `<!-- viewUrl: ... -->` 声明） */
  viewUrl?: string
}

export function useChangelogToast() {
  useEffect(() => {
    let dismissed = false

    fetch('/latest-release.json')
      .then(res => {
        if (!res.ok) return null
        return res.json() as Promise<LatestRelease>
      })
      .then(latest => {
        if (!latest || !latest.html) return
        const seen = localStorage.getItem(LS_KEY)
        if (seen === latest.id) return
        // 首次访问：静默记录当前版本，不弹 toast
        if (seen === null) {
          localStorage.setItem(LS_KEY, latest.id)
          return
        }

        const markSeen = () => {
          if (!dismissed) {
            dismissed = true
            localStorage.setItem(LS_KEY, latest.id)
          }
        }

        const toastId = toast('🎉 Healerbook 已更新', {
          description: (
            <div>
              <div
                className="prose prose-sm dark:prose-invert"
                dangerouslySetInnerHTML={{ __html: latest.html }}
              />
              <div className="flex justify-end mt-2">
                <button
                  className="text-sm font-medium bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90 transition-colors"
                  onClick={() => {
                    track('changelog-toast-view', { releaseId: latest.id })
                    window.open(latest.viewUrl ?? CHANGELOG_URL, '_blank')
                    markSeen()
                    toast.dismiss(toastId)
                  }}
                >
                  查看详情
                </button>
              </div>
            </div>
          ),
          closeButton: true,
          position: 'bottom-right',
          duration: Infinity,
          onDismiss: () => {
            track('changelog-toast-dismiss', { releaseId: latest.id })
            markSeen()
          },
        })
      })
      .catch(() => {
        // 静默失败，不影响用户体验
      })
  }, [])
}
