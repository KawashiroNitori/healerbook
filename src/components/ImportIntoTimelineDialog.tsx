/**
 * 导入到当前时间轴 —— 2 步 wizard
 *
 * Step 1: 选择来源（FFLogs 战斗 / 副本模板）+ 输入数据 + 解析
 * Step 2: 配置导入（数据类型 / 时间范围 / 实时预览 / 确认导入）
 *
 * 详见 design/superpowers/specs/2026-05-29-editor-import-design.md
 */

import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Modal, ModalHeader, ModalTitle, ModalFooter } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { apiClient } from '@/api/apiClient'
import { parseFFLogsUrl } from '@/utils/fflogsParser'
import { parseFromAny } from '@/utils/timelineFormat'
import { parseApiError } from '@/api/parseApiError'
import { generateId } from '@/utils/id'
import { extractImportableFromTimeline, type ImportableSubset } from '@/utils/importAdapter'

interface ImportIntoTimelineDialogProps {
  open: boolean
  onClose: () => void
}

type Step = 1 | 2
type SourceKind = 'fflogs'

export default function ImportIntoTimelineDialog({ open, onClose }: ImportIntoTimelineDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>(1)
  const [source] = useState<SourceKind>('fflogs') // 模板源在 Task 9 引入
  const [url, setUrl] = useState('')
  const [isParsing, setIsParsing] = useState(false)
  const [error, setError] = useState('')
  const [parsed, setParsed] = useState<ImportableSubset | null>(null)
  /** parsed 对应的 URL，用于检测用户改动 URL 后是否需要重新解析 */
  const [parsedKey, setParsedKey] = useState<string>('')

  // 自动聚焦 + 剪贴板探测
  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    void (async () => {
      try {
        const text = await navigator.clipboard.readText()
        if (text && /fflogs\.com\/reports\//.test(text)) setUrl(text)
      } catch {
        /* 剪贴板权限拒绝，静默 */
      }
    })()
  }, [open])

  // 关闭时重置内部态
  useEffect(() => {
    if (!open) {
      setStep(1)
      setUrl('')
      setError('')
      setParsed(null)
      setParsedKey('')
      setIsParsing(false)
    }
  }, [open])

  const parsedUrl = url ? parseFFLogsUrl(url) : null
  const urlValid = !!parsedUrl?.reportCode
  const needReparse = parsed !== null && parsedKey !== url
  const nextLabel = step === 1 ? (parsed && !needReparse ? '下一步' : '解析') : '确认导入'

  const handleParse = async () => {
    if (!parsedUrl?.reportCode) return
    setError('')
    setIsParsing(true)
    try {
      const params = new URLSearchParams({ reportCode: parsedUrl.reportCode })
      if (!parsedUrl.isLastFight && parsedUrl.fightId !== null) {
        params.set('fightId', String(parsedUrl.fightId))
      }
      const response = await apiClient.get(`fflogs/import?${params}`, {
        timeout: 120000,
        throwHttpErrors: false,
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as unknown
        throw new Error(parseApiError(body, response.status))
      }
      const raw = await response.json()
      const fullTimeline = parseFromAny(raw, { id: generateId() })
      const extracted = extractImportableFromTimeline(fullTimeline)
      setParsed(extracted)
      setParsedKey(url)
      setStep(2)
    } catch (err) {
      setError(err instanceof Error ? err.message : '解析失败')
    } finally {
      setIsParsing(false)
    }
  }

  const handleNext = () => {
    if (step === 1) {
      if (needReparse || !parsed) void handleParse()
      else setStep(2)
    } else {
      // Task 13 接入 bulkImport
    }
  }

  return (
    <Modal open={open} onClose={onClose} disableBackdropClick={isParsing}>
      {/* 标题区 —— 保持 Task 7 的无 ModalContent 结构，以便 stepper border-b 贴边 */}
      <div className="px-6 pt-6 pb-4">
        <ModalHeader className="mb-0">
          <ModalTitle>导入到当前时间轴</ModalTitle>
        </ModalHeader>
      </div>

      {/* Stepper —— border-b 需要全宽贴边，不能被 ModalContent 的 padding 截断 */}
      <div className="px-6 py-3 border-b bg-muted/30 flex items-center gap-3 text-sm">
        <span className={step === 1 ? 'font-semibold' : 'text-muted-foreground'}>① 选择来源</span>
        <span className="text-muted-foreground">→</span>
        <span className={step === 2 ? 'font-semibold' : 'text-muted-foreground'}>② 配置导入</span>
      </div>

      {/* 内容区 */}
      <div className="px-6 py-6 min-h-[220px] space-y-4">
        {/* source 变量用于 Task 9 的来源切换器，此处暂只有 fflogs */}
        {step === 1 && source === 'fflogs' && (
          <>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                FFLogs 链接
              </label>
              <input
                ref={inputRef}
                type="text"
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder="https://www.fflogs.com/reports/ABC123#fight=5"
                className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                disabled={isParsing}
              />
              {url && !urlValid && (
                <p className="text-xs text-destructive mt-1">无法识别 FFLogs 链接</p>
              )}
            </div>
            {isParsing && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                正在解析 FFLogs 报告...
              </div>
            )}
            {error && (
              <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                {error}
              </div>
            )}
          </>
        )}

        {step === 2 && parsed && (
          <div className="text-sm text-muted-foreground">
            已解析：{parsed.sourceLabel} · {parsed.damageEvents.length} 伤害 /{' '}
            {parsed.castEvents.length} 技能
            <p className="text-xs mt-2">（Task 9-13 接入配置区与确认按钮）</p>
          </div>
        )}
      </div>

      {/* 底部按钮 */}
      <div className="px-6 pb-6">
        <ModalFooter>
          {step === 2 && (
            <Button variant="outline" onClick={() => setStep(1)} disabled={isParsing}>
              ‹ 上一步
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={isParsing}>
            取消
          </Button>
          <Button onClick={handleNext} disabled={isParsing || (step === 1 && !urlValid)}>
            {nextLabel}
          </Button>
        </ModalFooter>
      </div>
    </Modal>
  )
}
