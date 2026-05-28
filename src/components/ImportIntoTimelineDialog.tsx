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
import { useTimelineStore } from '@/store/timelineStore'
import { fetchEncounterTemplate } from '@/api/encounterTemplate'
import type { DamageEvent } from '@/types/timeline'

interface ImportIntoTimelineDialogProps {
  open: boolean
  onClose: () => void
}

type Step = 1 | 2
type SourceKind = 'fflogs' | 'template'

export default function ImportIntoTimelineDialog({ open, onClose }: ImportIntoTimelineDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>(1)
  const [source, setSource] = useState<SourceKind>('fflogs')
  const [url, setUrl] = useState('')
  const [isParsing, setIsParsing] = useState(false)
  const [error, setError] = useState('')
  const [parsed, setParsed] = useState<ImportableSubset | null>(null)
  /** parsed 对应的 key，用于检测来源变动后是否需要重新解析 */
  const [parsedKey, setParsedKey] = useState<string>('')

  const timeline = useTimelineStore(s => s.timeline)
  const currentEncounter = timeline?.encounter
  const [templateEvents, setTemplateEvents] = useState<DamageEvent[] | null>(null)
  const [templatePrefetching, setTemplatePrefetching] = useState(false)

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
      setSource('fflogs')
    }
  }, [open])

  // prefetch 副本模板
  useEffect(() => {
    if (!open || !currentEncounter?.id) {
      setTemplateEvents(null)
      return
    }
    setTemplatePrefetching(true)
    let ignore = false
    void fetchEncounterTemplate(currentEncounter.id)
      .then(res => {
        if (!ignore) setTemplateEvents(res.events)
      })
      .catch(() => {
        if (!ignore) setTemplateEvents([])
      })
      .finally(() => {
        if (!ignore) setTemplatePrefetching(false)
      })
    return () => {
      ignore = true
    }
  }, [open, currentEncounter?.id])

  const parsedUrl = url ? parseFFLogsUrl(url) : null
  const urlValid = !!parsedUrl?.reportCode

  const templateAvailable = (templateEvents?.length ?? 0) > 0
  const showSegmented = !!currentEncounter && templateAvailable

  const reparseKey = source === 'fflogs' ? url : `template:${currentEncounter?.id ?? ''}`
  const needReparse = parsed !== null && parsedKey !== reparseKey

  const nextLabel =
    step === 1
      ? source === 'template'
        ? '下一步'
        : parsed && !needReparse
          ? '下一步'
          : '解析'
      : '确认导入'

  const canNext =
    step === 1 ? (source === 'fflogs' ? urlValid : (templateEvents?.length ?? 0) > 0) : true // Step 2 由 Task 13 接管

  const handleSourceChange = (s: SourceKind) => {
    if (s === source) return
    setSource(s)
    setParsed(null)
    setParsedKey('')
    setError('')
    setStep(1)
  }

  const handleParse = async () => {
    setError('')
    if (source === 'fflogs') {
      if (!parsedUrl?.reportCode) return
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
    } else {
      // template
      if (!templateEvents) return
      setParsed({
        damageEvents: templateEvents,
        castEvents: [],
        syncEvents: [],
        encounter: currentEncounter ?? null,
        sourceLabel: `模板「${currentEncounter?.name ?? ''}」`,
      })
      setParsedKey(`template:${currentEncounter?.id}`)
      setStep(2)
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
        {step === 1 && (
          <>
            {showSegmented && (
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  来源
                </label>
                <div className="inline-flex border border-border rounded-md p-0.5 bg-muted/30">
                  <button
                    type="button"
                    onClick={() => handleSourceChange('fflogs')}
                    className={`px-3 py-1 rounded text-xs ${source === 'fflogs' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
                  >
                    FFLogs 战斗
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSourceChange('template')}
                    className={`px-3 py-1 rounded text-xs ${source === 'template' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
                  >
                    副本模板
                  </button>
                </div>
              </div>
            )}

            {source === 'fflogs' && (
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
            )}

            {source === 'template' && currentEncounter && (
              <div className="rounded-md bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 px-3 py-2 text-sm text-blue-700 dark:text-blue-300">
                将从模板「{currentEncounter.name}」导入（按当前时间轴 encounter 自动选择）
              </div>
            )}

            {(isParsing || templatePrefetching) && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                {isParsing ? '正在解析...' : '正在加载模板...'}
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
          <Button onClick={handleNext} disabled={isParsing || !canNext}>
            {nextLabel}
          </Button>
        </ModalFooter>
      </div>
    </Modal>
  )
}
