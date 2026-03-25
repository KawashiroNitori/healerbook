/**
 * 版本冲突解决对话框（PUT 返回 409 时使用）
 */

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

interface ConflictDialogProps {
  open: boolean
  localUpdatedAt: number
  serverUpdatedAt: number
  onKeepLocal: () => Promise<void>
  onUseServer: () => Promise<void>
}

function formatTs(ts: number): string {
  return new Date(ts * 1000).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export default function ConflictDialog({
  open,
  localUpdatedAt,
  serverUpdatedAt,
  onKeepLocal,
  onUseServer,
}: ConflictDialogProps) {
  const [loading, setLoading] = useState<'local' | 'server' | null>(null)

  const handle = async (action: 'local' | 'server') => {
    setLoading(action)
    try {
      if (action === 'local') {
        await onKeepLocal()
      } else {
        await onUseServer()
      }
    } catch (err) {
      toast.error(`操作失败：${err instanceof Error ? err.message : '未知错误'}`)
    } finally {
      setLoading(null)
    }
  }

  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>服务器上的版本已被更新（另一设备）</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span>本地版本：</span>
                <span>最后编辑于 {formatTs(localUpdatedAt)}</span>
              </div>
              <div className="flex justify-between">
                <span>服务器版本：</span>
                <span>更新于 {formatTs(serverUpdatedAt)}</span>
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="outline" onClick={() => handle('server')} disabled={loading !== null}>
            {loading === 'server' && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            使用服务器版本
          </Button>
          <Button onClick={() => handle('local')} disabled={loading !== null}>
            {loading === 'local' && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            保留本地版本
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
