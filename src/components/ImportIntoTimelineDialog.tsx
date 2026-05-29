/**
 * 导入到当前时间轴 —— 2 步 wizard
 *
 * Step 1: 选择来源（FFLogs 战斗 / 副本模板）+ 输入数据 + 解析
 * Step 2: 数据导入（数据类型 / 时间范围 / 实时预览 / 确认导入）
 *
 * 详见 design/superpowers/specs/2026-05-29-editor-import-design.md
 */

import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { track } from '@/utils/analytics'
import { Modal, ModalHeader, ModalTitle, ModalFooter } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { TimeInput } from '@/components/ui/time-input'
import { Checkbox } from '@/components/ui/checkbox'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { apiClient } from '@/api/apiClient'
import { parseFFLogsUrl } from '@/utils/fflogsParser'
import { parseFromAny } from '@/utils/timelineFormat'
import { parseApiError } from '@/api/parseApiError'
import { generateId } from '@/utils/id'
import {
  extractImportableFromTimeline,
  buildPlayerIdMap,
  dedupeSyncEvents,
  filterByRange,
  validateCastsForImport,
  type ImportableSubset,
  type ImportRange,
} from '@/utils/importAdapter'
import { useTimelineStore } from '@/store/timelineStore'
import { fetchEncounterTemplate } from '@/api/encounterTemplate'
import { useMitigationStore } from '@/store/mitigationStore'
import { DamageCalculationContext } from '@/contexts/DamageCalculationContext'
import { createPlacementEngine } from '@/utils/placement/engine'
import { sortJobsByOrder } from '@/data/jobs'
import JobIcon from '@/components/JobIcon'
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
  const bulkImport = useTimelineStore(s => s.bulkImport)
  const currentEncounter = timeline?.encounter
  const [templateEvents, setTemplateEvents] = useState<DamageEvent[] | null>(null)
  const [templatePrefetching, setTemplatePrefetching] = useState(false)

  // Step 2 配置状态
  const [includeDamage, setIncludeDamage] = useState(true)
  const [includeCast, setIncludeCast] = useState(true)
  const [rangeMode, setRangeMode] = useState<'range' | 'all'>('range')
  const [rangeStart, setRangeStart] = useState(0)
  const [rangeEnd, setRangeEnd] = useState(0)
  const [rangeEndUnlimited, setRangeEndUnlimited] = useState(true)

  const mitigationActions = useMitigationStore(s => s.actions)
  const calc = useContext(DamageCalculationContext)

  const range = useMemo<ImportRange>(
    () =>
      rangeMode === 'all'
        ? { mode: 'all' }
        : { mode: 'range', start: rangeStart, end: rangeEndUnlimited ? null : rangeEnd },
    [rangeMode, rangeStart, rangeEnd, rangeEndUnlimited]
  )

  const encounterMismatch =
    parsed?.encounter && timeline?.encounter && parsed.encounter.id !== timeline.encounter.id

  // 阵容比对：按职业多重集合判断是否一致（FFLogs 与时间轴的玩家 id 体系不同，只能比职业构成）
  const partyMismatch = useMemo(() => {
    if (source !== 'fflogs' || !parsed?.composition || !timeline?.composition) return false
    const jobsKey = (players: Array<{ job: string }>) =>
      players
        .map(p => p.job)
        .sort()
        .join(',')
    return jobsKey(parsed.composition.players) !== jobsKey(timeline.composition.players)
  }, [source, parsed, timeline])

  const preview = useMemo(() => {
    if (!parsed || !timeline) return null
    const damages = includeDamage ? filterByRange(parsed.damageEvents, range, e => e.time) : []
    const filteredCasts = includeCast
      ? filterByRange(parsed.castEvents, range, e => e.timestamp)
      : []
    // 即便 includeCast=false，sync 仍按范围过滤（用户可见不显示，但提交时也带）
    const filteredSyncs = filterByRange(parsed.syncEvents, range, e => e.time)

    const playerIdMap = buildPlayerIdMap(parsed.composition, timeline.composition)

    const castResult = validateCastsForImport({
      incoming: filteredCasts,
      playerIdMap,
      baseTimeline: timeline,
      mitigationActions,
      statusTimelineByPlayer: calc?.statusTimelineByPlayer ?? new Map(),
      createEngine: createPlacementEngine,
    })

    const syncResult = dedupeSyncEvents(filteredSyncs, timeline.syncEvents ?? [])

    return {
      damageCount: damages.length,
      damages,
      castKept: castResult.kept.length,
      castSkipped: castResult.skipped,
      casts: castResult.kept,
      syncs: syncResult.kept,
    }
  }, [parsed, timeline, range, includeDamage, includeCast, mitigationActions, calc])

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

  // 进 Step 2 时初始化时间范围
  useEffect(() => {
    if (step !== 2 || !timeline) return
    const dMax = timeline.damageEvents.reduce((m, e) => Math.max(m, e.time), 0)
    const cMax = timeline.castEvents.reduce((m, e) => Math.max(m, e.timestamp), 0)
    setRangeStart(Math.max(dMax, cMax))
    setRangeEnd(Math.max(dMax, cMax))
    setRangeEndUnlimited(true)
    setRangeMode('range')
    // 模板源没 castEvents，强制取消勾选
    if (source === 'template') {
      setIncludeCast(false)
    } else {
      setIncludeCast(true)
    }
    setIncludeDamage(true)
  }, [step, timeline, source])

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

  const rangeInvalid = rangeMode === 'range' && !rangeEndUnlimited && rangeStart >= rangeEnd
  const typesAllUnchecked = !includeDamage && (source !== 'fflogs' || !includeCast)
  const canConfirm = step === 2 && preview !== null && !rangeInvalid && !typesAllUnchecked

  const canNext =
    step === 1 ? (source === 'fflogs' ? urlValid : (templateEvents?.length ?? 0) > 0) : true

  const handleSourceChange = (s: SourceKind) => {
    if (s === source) return
    setSource(s)
    setParsed(null)
    setParsedKey('')
    setError('')
    setStep(1)
  }

  const handleConfirm = () => {
    if (!preview) return
    bulkImport({
      damageEvents: includeDamage ? preview.damages : [],
      castEvents: source === 'fflogs' && includeCast ? preview.casts : [],
      syncEvents: preview.syncs, // sync 始终静默导入
    })
    track('editor-import', {
      source,
      damageCount: includeDamage ? preview.damageCount : 0,
      castCount: source === 'fflogs' && includeCast ? preview.castKept : 0,
      castSkipped: source === 'fflogs' && includeCast ? preview.castSkipped : 0,
      syncCount: preview.syncs.length,
      rangeMode,
    })
    const segs: string[] = []
    if (includeDamage) segs.push(`${preview.damageCount} 伤害`)
    if (source === 'fflogs' && includeCast) {
      segs.push(
        `${preview.castKept} 技能${preview.castSkipped > 0 ? `（跳过 ${preview.castSkipped}）` : ''}`
      )
    }
    toast.success(`导入完成：${segs.join(' / ')}`)
    onClose()
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
        composition: timeline?.composition ?? { players: [] },
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
      handleConfirm()
    }
  }

  return (
    <Modal open={open} onClose={onClose} disableBackdropClick>
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
        <span className={step === 2 ? 'font-semibold' : 'text-muted-foreground'}>② 数据导入</span>
      </div>

      {/* 内容区 */}
      <div className="px-6 py-6 min-h-[220px] space-y-4">
        {step === 1 && (
          <>
            <p className="text-xs text-muted-foreground leading-relaxed">
              本功能旨在将其他战斗记录所产生的伤害与技能使用快速导入到已有时间轴，由于每场战斗的实际战斗时长和伤害出现时机可能不同，导入后可能会出现重复的伤害事件与技能，请仔细甄别导入结果是否准确，并人工修正可能出现的错误。
            </p>

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
                    云端模板
                  </button>
                </div>
              </div>
            )}

            {/* 始终挂载并占位，模板模式下仅隐藏，避免切换来源时对话框高度突变 */}
            <div
              className={source === 'fflogs' ? '' : 'invisible'}
              aria-hidden={source !== 'fflogs'}
            >
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
                disabled={isParsing || source !== 'fflogs'}
                tabIndex={source === 'fflogs' ? undefined : -1}
              />
              {url && !urlValid && (
                <p className="text-xs text-destructive mt-1">无法识别 FFLogs 链接</p>
              )}
            </div>

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
          <div className="space-y-5">
            {partyMismatch && (
              <div className="rounded-md border border-yellow-300 bg-yellow-50 dark:bg-yellow-950/30 dark:border-yellow-800 px-3 py-2 text-sm text-yellow-800 dark:text-yellow-300 space-y-2">
                <div>
                  ⚠
                  该报告的阵容与当前时间轴阵容不一致，导入的技能可能无法正确归属到对应玩家，请仔细核对
                </div>
                <div className="flex items-center gap-2">
                  <span className="shrink-0 text-xs text-muted-foreground w-16">报告阵容</span>
                  <div className="flex flex-wrap items-center gap-1">
                    {sortJobsByOrder(parsed?.composition?.players ?? [], p => p.job).map((p, i) => (
                      <JobIcon key={i} job={p.job} size="sm" />
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="shrink-0 text-xs text-muted-foreground w-16">时间轴阵容</span>
                  <div className="flex flex-wrap items-center gap-1">
                    {sortJobsByOrder(timeline?.composition?.players ?? [], p => p.job).map(
                      (p, i) => (
                        <JobIcon key={i} job={p.job} size="sm" />
                      )
                    )}
                  </div>
                </div>
              </div>
            )}

            {encounterMismatch && (
              <div className="rounded-md border border-yellow-300 bg-yellow-50 dark:bg-yellow-950/30 dark:border-yellow-800 px-3 py-2 text-sm text-yellow-800 dark:text-yellow-300">
                ⚠ 该报告的副本与当前时间轴的副本不一致
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                数据类型
              </label>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={includeDamage} onCheckedChange={v => setIncludeDamage(!!v)} />
                  伤害事件{' '}
                  <span className="text-muted-foreground">（{parsed.damageEvents.length} 条）</span>
                </label>
                {source === 'fflogs' && (
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={includeCast} onCheckedChange={v => setIncludeCast(!!v)} />
                    技能使用{' '}
                    <span className="text-muted-foreground">（{parsed.castEvents.length} 条）</span>
                  </label>
                )}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                时间范围
              </label>
              <RadioGroup
                value={rangeMode}
                onValueChange={v => setRangeMode(v as 'range' | 'all')}
                className="flex gap-4 mb-2"
              >
                <label className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value="range" /> 时间区间
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value="all" /> 全部
                </label>
              </RadioGroup>

              {rangeMode === 'range' ? (
                <>
                  <div
                    className={`flex items-center gap-2 ${rangeInvalid ? 'ring-1 ring-destructive rounded-md p-1' : ''}`}
                  >
                    <TimeInput
                      value={rangeStart}
                      onChange={setRangeStart}
                      size="sm"
                      className="w-[104px] shrink-0"
                    />
                    <span className="text-muted-foreground">~</span>
                    {rangeEndUnlimited ? (
                      <div className="w-[104px] shrink-0 px-2.5 py-1.5 border border-border rounded-md text-muted-foreground text-sm font-mono text-center">
                        ∞
                      </div>
                    ) : (
                      <TimeInput
                        value={rangeEnd}
                        onChange={setRangeEnd}
                        size="sm"
                        className="w-[104px] shrink-0"
                      />
                    )}
                    <label className="flex items-center gap-2 text-sm ml-2 shrink-0 whitespace-nowrap">
                      <Checkbox
                        checked={rangeEndUnlimited}
                        onCheckedChange={v => setRangeEndUnlimited(!!v)}
                      />
                      至时间轴结尾
                    </label>
                  </div>
                  {rangeInvalid && (
                    <p className="text-xs text-destructive mt-1">起始时间必须小于结束时间</p>
                  )}
                </>
              ) : (
                <div className="rounded-md border border-yellow-300 bg-yellow-50 dark:bg-yellow-950/30 dark:border-yellow-800 px-3 py-2 text-sm text-yellow-800 dark:text-yellow-300">
                  ⚠ 全部模式可能与时间轴已有事件重复。建议改用「时间区间」并选择空白时间段。
                </div>
              )}
            </div>

            {preview && (
              <div className="rounded-md bg-muted/40 px-3 py-2 font-mono text-xs leading-6">
                <div className="text-muted-foreground">本次将导入：</div>
                {includeDamage && (
                  <div>
                    {'　'}
                    伤害事件{'　'}
                    <span className="text-green-600 dark:text-green-400">
                      {preview.damageCount} 条
                    </span>
                  </div>
                )}
                {source === 'fflogs' && includeCast && (
                  <div>
                    {'　'}
                    技能使用{'　'}
                    <span className="text-green-600 dark:text-green-400">
                      {preview.castKept} 条
                    </span>
                    {preview.castSkipped > 0 && (
                      <span className="text-yellow-600 dark:text-yellow-400">
                        {' '}
                        （跳过 {preview.castSkipped} 条）
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
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
          <Button
            onClick={handleNext}
            disabled={isParsing || (step === 1 ? !canNext : !canConfirm)}
          >
            {nextLabel}
          </Button>
        </ModalFooter>
      </div>
    </Modal>
  )
}
