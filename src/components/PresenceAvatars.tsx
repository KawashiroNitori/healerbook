import { useTranslation } from 'react-i18next'
import { useTimelineStore } from '@/store/timelineStore'
import type { PeerState } from '@/collab/awarenessTypes'

/** 按 user.id 去重,保留最后出现的(最新 clientId) */
function dedupeByUser(peers: PeerState[]): PeerState[] {
  const byUser = new Map<string, PeerState>()
  for (const p of peers) byUser.set(p.user.id, p)
  return [...byUser.values()]
}

export default function PresenceAvatars() {
  const { t } = useTranslation(['editor', 'common'])
  const peers = useTimelineStore(s => s.peers)
  const connectionStatus = useTimelineStore(s => s.connectionStatus)
  const isPublished = useTimelineStore(s => s.isPublished)

  // 仅已发布(editor 模式)才可能有协作者;非发布态直接不渲染
  if (!isPublished) return null
  const people = dedupeByUser(peers)
  if (people.length === 0) return null

  const reconnecting = connectionStatus !== 'connected'

  return (
    <div
      className="flex items-center gap-1.5"
      title={reconnecting ? t('presence.reconnecting') : undefined}
    >
      <div className={`flex -space-x-1.5 ${reconnecting ? 'opacity-50' : ''}`}>
        {people.map(p => (
          <div
            key={p.user.id}
            title={p.user.name}
            className="flex h-6 w-6 items-center justify-center rounded-full border border-background text-[10px] font-medium text-white"
            style={{ backgroundColor: p.user.color }}
          >
            {p.user.name.slice(0, 1)}
          </div>
        ))}
      </div>
      {reconnecting && (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
          {t('presence.reconnecting')}
        </span>
      )}
    </div>
  )
}
