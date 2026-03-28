import { useState } from 'react'
import { Users, X, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalFooter } from '@/components/ui/modal'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { Job, Composition } from '@/types/timeline'
import {
  getJobName,
  getTankJobs,
  getHealerJobs,
  getDPSJobs,
  getJobRole,
  sortJobsByOrder,
} from '@/data/jobs'
import { MAX_PARTY_SIZE } from '@/types/timeline'
import JobIcon from './JobIcon'

interface CompositionDialogProps {
  composition: Composition
  onSave: (composition: Composition) => void
}

const dpsJobs = getDPSJobs()
const JOB_ROWS: Array<{ label: string; jobs: Job[] }> = [
  { label: '坦克', jobs: getTankJobs() },
  { label: '治疗', jobs: getHealerJobs() },
  { label: '近战', jobs: dpsJobs.filter(j => getJobRole(j) === 'melee') },
  { label: '远敏', jobs: dpsJobs.filter(j => getJobRole(j) === 'ranged') },
  { label: '法系', jobs: dpsJobs.filter(j => getJobRole(j) === 'caster') },
]

export default function CompositionDialog({ composition, onSave }: CompositionDialogProps) {
  const [open, setOpen] = useState(false)
  const [localPlayers, setLocalPlayers] = useState(composition.players)

  const canAddMore = localPlayers.length < MAX_PARTY_SIZE
  const sortedLocalPlayers = [...localPlayers].sort((a, b) => {
    const jobs = sortJobsByOrder([a.job, b.job])
    return jobs.indexOf(a.job) - jobs.indexOf(b.job)
  })

  const handleAddJob = (job: Job) => {
    if (!canAddMore) return
    setLocalPlayers(prev => [
      ...prev,
      { id: Date.now() + Math.floor(Math.random() * 1000), job, name: `${job} Player` },
    ])
  }

  const handleRemove = (playerId: number) => {
    setLocalPlayers(prev => prev.filter(p => p.id !== playerId))
  }

  const handleConfirm = () => {
    onSave({ players: localPlayers })
    setOpen(false)
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => {
          setLocalPlayers(composition.players)
          setOpen(true)
        }}
      >
        <Users className="w-4 h-4 mr-2" />
        调整阵容
      </Button>

      <Modal open={open} onClose={() => setOpen(false)}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>调整阵容</ModalTitle>
          </ModalHeader>

          <TooltipProvider>
            <div className="space-y-4">
              {/* 当前阵容 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-medium text-muted-foreground">当前阵容</h4>
                  <span className="text-xs text-muted-foreground">
                    {localPlayers.length}/{MAX_PARTY_SIZE}
                  </span>
                </div>
                {sortedLocalPlayers.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2 text-center">暂无队员</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {sortedLocalPlayers.map(player => (
                      <Tooltip key={player.id}>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => handleRemove(player.id)}
                            className="relative group"
                          >
                            <JobIcon job={player.job} size="md" />
                            <span className="absolute inset-0 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 bg-black/40 transition-opacity">
                              <X className="w-3 h-3 text-white" />
                            </span>
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>{getJobName(player.job)}（点击移除）</TooltipContent>
                      </Tooltip>
                    ))}
                  </div>
                )}
              </div>

              <div className="border-t" />

              {/* 添加职业 */}
              <div>
                <h4 className="text-xs font-medium text-muted-foreground mb-3">添加职业</h4>
                <div className="space-y-2">
                  {JOB_ROWS.map(({ label, jobs }) => (
                    <div key={label} className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground w-6 shrink-0">{label}</span>
                      <div className="flex flex-wrap gap-1.5">
                        {jobs.map(job => (
                          <Tooltip key={job}>
                            <TooltipTrigger asChild>
                              <button
                                onClick={() => handleAddJob(job)}
                                disabled={!canAddMore}
                                className={`transition-all ${
                                  canAddMore
                                    ? 'opacity-60 hover:opacity-100 hover:scale-105'
                                    : 'opacity-20 cursor-not-allowed'
                                }`}
                              >
                                <JobIcon job={job} size="md" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>{getJobName(job)}</TooltipContent>
                          </Tooltip>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </TooltipProvider>

          <ModalFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button onClick={handleConfirm}>
              <Check className="w-4 h-4 mr-1" />
              完成
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
