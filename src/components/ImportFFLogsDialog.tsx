/**
 * FFLogs 导入对话框
 */

import { useState, useEffect } from 'react'
import { Loader2, Info } from 'lucide-react'
// devClientImport（内部 fflogsClient / fflogsImporter）仅 ?client_import=1 才用，
// 且该参数仅开发环境生效，经 dynamic import 引入：生产构建经 Vite 的
// import.meta.env.DEV 常量折叠 + DCE，不会进 bundle。
import { buildFFLogsSourceIndex } from '@/utils/timelineStorage'
import type { LocalDocMeta } from '@/collab/types'
import { createLocalTimeline } from '@/collab/createLocalTimeline'
import { timelineToLocalInit } from '@/collab/timelineToLocalInit'
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalFooter } from '@/components/ui/modal'
import { track } from '@/utils/analytics'
import { fetchFFLogsImport } from '@/api/fflogsImport'
import { useFFLogsUrlInput } from '@/hooks/useFFLogsUrlInput'

interface ImportFFLogsDialogProps {
  open: boolean
  onClose: () => void
  onImported: () => void
  /** 预填的 FFLogs URL（来自 TOP100 等外部来源） */
  initialUrl?: string
}

export default function ImportFFLogsDialog({
  open,
  onClose,
  onImported,
  initialUrl,
}: ImportFFLogsDialogProps) {
  const { inputRef, url, setUrl, parsed, isValid } = useFFLogsUrlInput({ initialUrl })
  const [isLoading, setIsLoading] = useState(false)
  const [loadingStep, setLoadingStep] = useState('')
  const [error, setError] = useState('')

  const validationError = url && !isValid ? '无法识别 FFLogs 链接，请检查 URL 格式' : ''

  // 查找本地是否已导入相同 reportCode+fightId 的时间轴
  const [duplicate, setDuplicate] = useState<LocalDocMeta | null>(null)
  useEffect(() => {
    if (!parsed?.reportCode || parsed.isLastFight || parsed.fightId == null) {
      setDuplicate(null)
      return
    }
    let ignore = false
    void buildFFLogsSourceIndex().then(index => {
      if (!ignore) {
        setDuplicate(index.get(`${parsed.reportCode}:${parsed.fightId}`) ?? null)
      }
    })
    return () => {
      ignore = true
    }
  }, [parsed?.reportCode, parsed?.fightId, parsed?.isLastFight])

  // 仅开发环境支持 ?client_import=1；生产环境短路为 false，下方 handleClientSubmit
  // 永远进不去，配合 dynamic import 保证 fflogsImporter / fflogsClient 不进 bundle
  const clientImport =
    import.meta.env.DEV && new URLSearchParams(window.location.search).get('client_import') === '1'

  /** 服务端解析：一次请求返回完整 Timeline */
  const handleServerSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!parsed?.reportCode) return

    setError('')
    setIsLoading(true)
    setLoadingStep('正在解析战斗事件...')

    try {
      const newTimeline = await fetchFFLogsImport({
        reportCode: parsed.reportCode,
        fightId: parsed.fightId,
        isLastFight: parsed.isLastFight,
      })
      newTimeline.description = `导入自 ${url}`

      const newId = await createLocalTimeline(timelineToLocalInit(newTimeline))
      track('fflogs-import', { success: true, encounterId: newTimeline.encounter?.id ?? 0 })

      window.open(`/timeline/${newId}`, '_blank')
      onImported()
      onClose()
    } catch (err) {
      track('fflogs-import', { success: false })
      if (err instanceof Error) {
        if (err.message.includes('API Token') || err.message.includes('API Key')) {
          setError('FFLogs 连接配置错误，请联系开发者')
        } else {
          setError(err.message)
        }
      } else {
        setError('导入失败，请稍后重试')
      }
    } finally {
      setIsLoading(false)
    }
  }

  /** 前端解析（仅开发环境）：?client_import=1 进入；生产 DCE 后整段不可达 */
  const handleClientSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    // 生产构建里 import.meta.env.DEV 折叠成 false → if(true) return → 下方全部死代码，
    // dynamic import 站点被 Rollup/esbuild 一并清掉
    if (!import.meta.env.DEV) return
    if (!parsed?.reportCode) return

    setError('')
    setIsLoading(true)
    setLoadingStep('正在获取报告信息...')

    try {
      const { runClientFFLogsImport } = await import('@/utils/devClientImport')
      const newTimeline = await runClientFFLogsImport({
        reportCode: parsed.reportCode,
        fightId: parsed.fightId,
        isLastFight: parsed.isLastFight,
        sourceUrl: url,
        onStep: setLoadingStep,
      })

      // 保存时间轴
      const newId = await createLocalTimeline(timelineToLocalInit(newTimeline))
      track('fflogs-import', { success: true, encounterId: newTimeline.encounter?.id ?? 0 })

      // 跳转到编辑器
      window.open(`/timeline/${newId}`, '_blank')
      onImported()
      onClose()
    } catch (err) {
      track('fflogs-import', { success: false })
      if (err instanceof Error) {
        // 友好的错误提示
        if (err.message.includes('API Token') || err.message.includes('API Key')) {
          setError('FFLogs 连接配置错误，请联系开发者')
        } else {
          setError(err.message)
        }
      } else {
        setError('导入失败，请稍后重试')
      }
    } finally {
      setIsLoading(false)
    }
  }

  const handleSubmit = clientImport ? handleClientSubmit : handleServerSubmit

  return (
    <Modal open={open} onClose={onClose} disableBackdropClick={isLoading}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>从 FFLogs 导入</ModalTitle>
        </ModalHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">FFLogs 战斗链接</label>
            <input
              ref={inputRef}
              type="text"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://www.fflogs.com/reports/ABC123#fight=5"
              className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              disabled={isLoading}
            />
            <p className="text-xs text-muted-foreground mt-1">粘贴 FFLogs 战斗链接或报告代码</p>

            {validationError && <p className="text-xs text-destructive mt-1">{validationError}</p>}

            {duplicate && (
              <div className="flex items-center gap-2 rounded-lg bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 px-3 py-2 mt-2">
                <Info className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
                <p className="text-xs font-medium text-blue-700 dark:text-blue-300">
                  该战斗记录已经导入过
                </p>
                <button
                  type="button"
                  onClick={() => window.open(`/timeline/${duplicate.docId}`, '_blank')}
                  className="ml-auto text-xs text-blue-700 dark:text-blue-300 hover:text-blue-900 dark:hover:text-blue-100"
                >
                  查看
                </button>
              </div>
            )}
          </div>

          {error && (
            <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">{error}</div>
          )}

          {/* 加载状态 */}
          {isLoading && (
            <div className="p-3 bg-muted rounded-md">
              <div className="flex items-center gap-3">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">{loadingStep}</span>
              </div>
            </div>
          )}

          <ModalFooter>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border rounded-md hover:bg-accent"
              disabled={isLoading}
            >
              取消
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
              disabled={isLoading || !isValid}
            >
              {isLoading ? '导入中...' : '导入'}
            </button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  )
}
