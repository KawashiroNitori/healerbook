import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Plus } from 'lucide-react'
import type { Job, Composition } from '@/types/timeline'
import {
  JOB_ORDER,
  getJobName,
  ROLE_LABELS,
  ROLE_ORDER,
  groupJobsByRole,
} from '@/data/jobs'
import JobIcon from './JobIcon'

interface CompositionDialogProps {
  composition: Composition
  onSave: (composition: Composition) => void
  disabled?: boolean
}

export default function CompositionDialog({
  composition,
  onSave,
  disabled = false,
}: CompositionDialogProps) {
  const [open, setOpen] = useState(false)
  const [selectedJob, setSelectedJob] = useState<Job | ''>('')

  // 按职业类别分组所有职业（允许重复职业）
  const jobsByRole = groupJobsByRole(JOB_ORDER)

  const handleSave = () => {
    if (!selectedJob) {
      setOpen(false)
      return
    }

    // 生成新的玩家 ID（使用时间戳 + 随机数）
    const newPlayerId = Date.now() + Math.floor(Math.random() * 1000)

    const newComposition = {
      players: [
        ...composition.players,
        {
          id: newPlayerId,
          job: selectedJob,
          name: `${selectedJob} Player`,
        },
      ],
    }

    onSave(newComposition)
    setSelectedJob('')
    setOpen(false)
  }

  const handleCancel = () => {
    setSelectedJob('')
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="w-full" disabled={disabled}>
          <Plus className="w-4 h-4 mr-2" />
          新增队员
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>新增队员</DialogTitle>
          <DialogDescription>选择职业添加到小队</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Select value={selectedJob} onValueChange={(value) => setSelectedJob(value as Job)}>
            <SelectTrigger>
              <SelectValue placeholder="选择职业" />
            </SelectTrigger>
            <SelectContent>
              {ROLE_ORDER.map((role) => {
                const jobs = jobsByRole[role]
                if (jobs.length === 0) return null

                return (
                  <SelectGroup key={role}>
                    <SelectLabel className="text-xs text-muted-foreground font-normal">
                      {ROLE_LABELS[role]}
                    </SelectLabel>
                    {jobs.map((job) => (
                      <SelectItem key={job} value={job}>
                        <div className="flex items-center gap-2">
                          <JobIcon job={job} size="sm" />
                          {getJobName(job)}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )
              })}
            </SelectContent>
          </Select>

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={handleCancel}>
              取消
            </Button>
            <Button onClick={handleSave} disabled={!selectedJob}>
              完成
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
