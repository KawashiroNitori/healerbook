import { Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { OptimizeProgress } from '@/utils/autoMitigation'

interface Props {
  open: boolean
  progress: OptimizeProgress | null
  onCancel: () => void
}

/**
 * 自动减伤进度 modal：运行中展示实时进度（阶段/轮次/已评估次数/耗时）与计算规模，
 * 可取消；点击空白处 / Esc 不关闭（避免误关），仅「取消」按钮可中止。
 */
export function AutoMitigateProgressModal({ open, progress, onCancel }: Props) {
  return (
    <Dialog open={open}>
      <DialogContent
        className="max-w-sm [&>button:last-child]:hidden"
        onInteractOutside={e => e.preventDefault()}
        onEscapeKeyDown={e => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在自动规划减伤…
          </DialogTitle>
          <DialogDescription>
            计算中…
            {progress && progress.round > 1 ? `（第 ${progress.round} 轮）` : ''}
          </DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
          <Stat
            label="计算耗时"
            value={progress ? `${(progress.elapsedMs / 1000).toFixed(1)}s` : '—'}
          />
          <Stat label="已放置" value={progress ? `${progress.castsPlaced}` : '—'} />
          <Stat label="评估次数" value={progress ? progress.simulateCalls.toLocaleString() : '—'} />
          <Stat label="候选规模" value={progress ? `${progress.candidateCount}` : '—'} />
          <Stat label="范围内事件" value={progress ? `${progress.inScopeEventCount}` : '—'} />
        </dl>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onCancel}>
            取消
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono tabular-nums">{value}</dd>
    </div>
  )
}
