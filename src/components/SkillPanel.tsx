import { useEffect } from 'react'
import { useMitigationStore } from '@/store/mitigationStore'
import { useTimelineStore } from '@/store/timelineStore'
import CompositionDialog from './CompositionDialog'
import JobIcon from './JobIcon'
import { Button } from '@/components/ui/button'
import { X } from 'lucide-react'
import type { Composition, Job } from '@/types/timeline'
import { MAX_PARTY_SIZE } from '@/types/timeline'
import { getIconUrl } from '@/utils/iconUtils'
import { sortJobsByOrder, getJobName } from '@/data/jobs'

export default function ActionPanel() {
  const { actions, loadActions } = useMitigationStore()
  const { timeline, updateComposition } = useTimelineStore()

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

  const composition = timeline.composition || { tanks: [], healers: [], dps: [] }

  const allMembers = sortJobsByOrder([
    ...(composition.tanks || []),
    ...(composition.healers || []),
    ...(composition.dps || []),
  ])

  const canAddMore = allMembers.length < MAX_PARTY_SIZE

  const handleSaveComposition = (newComposition: Composition) => {
    updateComposition(newComposition)
  }

  const handleRemoveMember = (job: Job) => {
    const newComposition = { ...composition }
    newComposition.tanks = newComposition.tanks.filter((j) => j !== job)
    newComposition.healers = newComposition.healers.filter((j) => j !== job)
    newComposition.dps = newComposition.dps.filter((j) => j !== job)
    updateComposition(newComposition)
  }

  return (
    <div className="w-64 border-r bg-background flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">小队阵容</h2>
          <span className="text-sm text-muted-foreground">
            {allMembers.length}/{MAX_PARTY_SIZE}
          </span>
        </div>
        <CompositionDialog
          composition={composition}
          onSave={handleSaveComposition}
          disabled={!canAddMore}
        />
      </div>

      {/* Members and Skills List */}
      <div className="flex-1 overflow-y-auto scrollbar-custom">
        {allMembers.length === 0 ? (
          <div className="p-4 text-center">
            <p className="text-sm text-muted-foreground">点击"新增队员"添加队员</p>
          </div>
        ) : (
          <div className="divide-y">
            {allMembers.map((job, index) => {
              // 获取该职业的所有减伤技能
              const jobActions = actions.filter((action) => action.jobs.includes(job))

              return (
                <div key={`${job}-${index}`} className="p-3 relative">
                  {/* 职业名称和删除按钮 */}
                  <div className="font-medium text-sm mb-2 flex items-center gap-2">
                    <JobIcon job={job} size="md" />
                    {getJobName(job)}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 ml-auto"
                      onClick={() => handleRemoveMember(job)}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>

                  {/* 技能列表 */}
                  <div className="space-y-1.5 ml-4">
                    {jobActions.length === 0 ? (
                      <p className="text-xs text-muted-foreground">无可用技能</p>
                    ) : (
                      jobActions.map((action) => (
                        <div
                          key={action.id}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData('actionId', action.id.toString())
                            e.dataTransfer.setData('job', job)
                          }}
                          className="flex items-center gap-2 p-2 rounded hover:bg-muted/50 transition-colors cursor-move"
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
                              {action.barrier > 0 && action.physicReduce === 0 && action.magicReduce === 0 ? (
                                `盾: ${action.barrier}`
                              ) : action.barrier === 0 && action.physicReduce === action.magicReduce ? (
                                `${action.physicReduce}%`
                              ) : action.barrier === 0 ? (
                                `物${action.physicReduce}% 魔${action.magicReduce}%`
                              ) : (
                                `盾: ${action.barrier} + ${action.physicReduce === action.magicReduce ? action.physicReduce : `物${action.physicReduce}/魔${action.magicReduce}`}%`
                              )}
                              {' · '}
                              {action.duration}s
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
