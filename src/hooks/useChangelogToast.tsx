import { useEffect } from 'react'
import { toast } from 'sonner'

const CHANGELOG_URL = '/docs/changelog'
const LS_KEY = 'lastSeenReleaseId'

interface LatestRelease {
  id: string
  date: string
  html: string
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

        const markSeen = () => {
          if (!dismissed) {
            dismissed = true
            localStorage.setItem(LS_KEY, latest.id)
          }
        }

        toast('🎉 Healerbook 已更新', {
          description: (
            <div
              className="prose prose-sm dark:prose-invert"
              dangerouslySetInnerHTML={{ __html: latest.html }}
            />
          ),
          action: {
            label: '查看详情',
            onClick: () => {
              window.open(CHANGELOG_URL, '_blank')
              markSeen()
            },
          },
          position: 'bottom-right',
          duration: Infinity,
          onDismiss: markSeen,
        })
      })
      .catch(() => {
        // 静默失败，不影响用户体验
      })
  }, [])
}
