import { useEffect } from 'react'
import { useMitigationStore } from '@/store/mitigationStore'
import { useTimelineStore } from '@/store/timelineStore'
import { useEditorReadOnly } from '@/hooks/useEditorReadOnly'
import CompositionDialog from './CompositionDialog'
import JobIcon from './JobIcon'
import { Button } from '@/components/ui/button'
import { X } from 'lucide-react'
import type { Composition } from '@/types/timeline'
import { MAX_PARTY_SIZE } from '@/types/timeline'
import { getIconUrl } from '@/utils/iconUtils'
import { sortJobsByOrder, getJobName } from '@/data/jobs'

export default function ActionPanel() {
  const { actions, loadActions } = useMitigationStore()
  const { timeline, updateComposition } = useTimelineStore()
  const isReadOnly = useEditorReadOnly()

  useEffect(() => {
    if (actions.length === 0) {
      loadActions()
    }
  }, [actions.length, loadActions])

  if (!timeline) {
    return (
      <div className="w-64 border-r bg-background flex items-center justify-center">
        <p className="text-sm text-muted-foreground">未加载时间轴</p>
      </div>
    )
  }

  const composition = timeline.composition || { players: [] }

  // 按职业顺序排序玩家
  const sortedPlayers = [...composition.players].sort((a, b) => {
    const jobs = sortJobsByOrder([a.job, b.job])
    return jobs.indexOf(a.job) - jobs.indexOf(b.job)
  })

  const canAddMore = sortedPlayers.length < MAX_PARTY_SIZE

  const handleSaveComposition = (newComposition: Composition) => {
    updateComposition(newComposition)
  }

  const handleRemoveMember = (playerId: number) => {
    const newComposition = {
      players: composition.players.filter((p) => p.id !== playerId),
    }
    updateComposition(newComposition)
  }

  return (
    <div className="w-64 border-r bg-background flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">小队阵容</h2>
          <span className="text-sm text-muted-foreground">
            {sortedPlayers.length}/{MAX_PARTY_SIZE}
          </span>
        </div>
        <CompositionDialog
          composition={composition}
          onSave={handleSaveComposition}
          disabled={!canAddMore || isReadOnly}
        />
      </div>

      {/* Members and Skills List */}
      <div className="flex-1 overflow-y-auto scrollbar-custom">
        {sortedPlayers.length === 0 ? (
          <div className="p-4 text-center">
            <p className="text-sm text-muted-foreground">点击"新增队员"添加队员</p>
          </div>
        ) : (
          <div className="divide-y">
            {sortedPlayers.map((player) => {
              // 获取该职业的所有减伤技能
              const jobActions = actions.filter((action) => action.jobs.includes(player.job))

              return (
                <div key={`player-${player.id}`} className="p-3 relative">
                  {/* 职业名称和删除按钮 */}
                  <div className="font-medium text-sm mb-2 flex items-center gap-2">
                    <JobIcon job={player.job} size="md" />
                    {getJobName(player.job)}
                    {!isReadOnly && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 ml-auto"
                        onClick={() => handleRemoveMember(player.id)}
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    )}
                  </div>

                  {/* 技能列表 */}
                  <div className="space-y-1.5 ml-4">
                    {jobActions.length === 0 ? (
                      <p className="text-xs text-muted-foreground">无可用技能</p>
                    ) : (
                      jobActions.map((action) => (
                        <div
                          key={action.id}
                          className="flex items-center gap-2 p-2 rounded hover:bg-muted/50 transition-colors"
                        >
                          {/* 技能图标 */}
                          <div className="w-6 h-6 flex-shrink-0 rounded overflow-hidden bg-muted">
                            <img
                              src={getIconUrl(action.icon)}
                              alt={action.name}
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                e.currentTarget.style.display = 'none'
                              }}
                            />
                          </div>

                          {/* 技能信息 */}
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium truncate">{action.name}</div>
                            <div className="text-[10px] text-muted-foreground">
                              {action.duration}s · CD {action.cooldown}s
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
