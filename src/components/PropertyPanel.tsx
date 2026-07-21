/**
 * 属性面板组件
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DAMAGE_EVENT_NAME_MAX_LENGTH } from '@/constants/limits'
import { useTimelineStore } from '@/store/timelineStore'
import { useUIStore } from '@/store/uiStore'
import { useDamageCalculationResults } from '@/contexts/DamageCalculationContext'
import { useEditorReadOnly } from '@/hooks/useEditorReadOnly'
import { getStatusById, getMultiplierForDamageType } from '@/utils/statusRegistry'
import { getStatusIconUrl, getStatusName } from '@/utils/statusIconUtils'
import { Trash2, TriangleAlert, Skull, HelpCircle } from 'lucide-react'
import PlayerDamageDetails from './PlayerDamageDetails'
import TempMitigationSection from './TempMitigationSection'
import JobIcon from './JobIcon'
import { getJobName } from '@/data/jobs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { TimeInput } from '@/components/ui/time-input'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DAMAGE_EVENT_TYPES,
  DAMAGE_EVENT_TYPE_LABELS,
  type DamageType,
  type DamageEventType,
  type DamageEvent,
} from '@/types/timeline'
import type { MitigationStatus } from '@/types/status'
import type { HpSimulationSnapshot } from '@/types/calculation'
import { deriveLethalDangerous } from '@/utils/lethalDanger'

interface BranchViewData {
  finalDamage: number
  mitigationPercentage: number
  appliedStatuses: MitigationStatus[]
  referenceMaxHP?: number
  candidateDamage?: number
}

export default function PropertyPanel() {
  const { t } = useTranslation(['editor', 'common'])
  const timeline = useTimelineStore(s => s.timeline)
  const selectedEventId = useTimelineStore(s => s.selectedEventId)
  const updateDamageEvent = useTimelineStore(s => s.updateDamageEvent)
  const removeDamageEvent = useTimelineStore(s => s.removeDamageEvent)
  const enableHpSimulation = useUIStore(s => s.enableHpSimulation)
  const isReadOnly = useEditorReadOnly()
  const [helpOpen, setHelpOpen] = useState(false)
  // 多坦展示：选中的坦克（绑 eventId，事件切换自动失效 → fallback 到最优减伤分支）。
  // 同一事件内用户选了某坦就保持不变。
  const [tankSelection, setTankSelection] = useState<{
    eventId: string
    tankId: number
  } | null>(null)
  // 平铺开关：关闭时下拉只显示选中的坦克，开启时一次渲染所有坦克
  const [isTiled, setIsTiled] = useState(false)

  // 使用新的伤害计算 Hook（基于状态）
  const eventResults = useDamageCalculationResults()

  // 显示伤害事件属性（event 可能不存在；hooks 必须在 early return 前声明）
  const event = timeline?.damageEvents.find(e => e.id === selectedEventId)

  // 文本框 draft：每次按键不触发 store 更新，失焦时再 commit，避免高频重算时间轴。
  // 切换事件 / 外部 undo-redo 时按 React "Adjusting state when a prop changes" 模式
  // 在 render 期把外部值同步回 draft（用 storedKey 三元组防止覆盖正在编辑的内容）。
  const [nameDraft, setNameDraft] = useState(event?.name ?? '')
  const [damageDraft, setDamageDraft] = useState(event ? String(event.damage) : '')
  // 读条：开始为时间值（TimeInput），时长为浮点秒（普通文本框）。无读条时 castStartTime 缺失，
  // 开始回退显示为判定时间，时长为空。两者由 commitCastWindow 按 both-or-neither 成对写入 / 清除。
  const castDurationOf = (e: DamageEvent): string =>
    e.castStartTime != null && e.castEndTime != null
      ? String(Math.round((e.castEndTime - e.castStartTime) * 100) / 100)
      : ''
  const [castStartValue, setCastStartValue] = useState(event?.castStartTime ?? event?.time ?? 0)
  const [castDurationDraft, setCastDurationDraft] = useState(event ? castDurationOf(event) : '')
  const [syncedKey, setSyncedKey] = useState({
    id: event?.id,
    name: event?.name,
    damage: event?.damage,
    castStartTime: event?.castStartTime,
    castEndTime: event?.castEndTime,
  })
  if (
    event &&
    (event.id !== syncedKey.id ||
      event.name !== syncedKey.name ||
      event.damage !== syncedKey.damage ||
      event.castStartTime !== syncedKey.castStartTime ||
      event.castEndTime !== syncedKey.castEndTime)
  ) {
    setSyncedKey({
      id: event.id,
      name: event.name,
      damage: event.damage,
      castStartTime: event.castStartTime,
      castEndTime: event.castEndTime,
    })
    setNameDraft(event.name)
    setDamageDraft(String(event.damage))
    setCastStartValue(event.castStartTime ?? event.time)
    setCastDurationDraft(castDurationOf(event))
  }

  // 只有在选中伤害事件时才显示面板（不响应技能选中）
  if (!timeline || !selectedEventId) {
    return null
  }

  if (!event) return null

  // 读条 both-or-neither 提交：开始 + 时长(>0) 都有效才成对写入，否则清除成对字段。
  const commitCastWindow = (start: number, durationStr: string) => {
    if (isReadOnly) return
    const dur = parseFloat(durationStr)
    if (Number.isFinite(start) && Number.isFinite(dur) && dur > 0) {
      updateDamageEvent(event.id, { castStartTime: start, castEndTime: start + dur })
    } else if (event.castStartTime != null || event.castEndTime != null) {
      updateDamageEvent(event.id, { castStartTime: undefined, castEndTime: undefined })
    }
  }

  // 使用预先计算的结果（可能为空）
  const result = eventResults.get(event.id)

  // ── Helper render functions ──────────────────────────────────────────────

  /** HP 条（编辑模式） */
  function renderHpBar(branch: BranchViewData) {
    const maxHP = branch.referenceMaxHP
    if (!maxHP || maxHP <= 0) return null

    const remainHP = Math.max(0, maxHP - branch.finalDamage)
    const survivePct = Math.max(0, Math.min(100, (remainHP / maxHP) * 100))
    const damagePct = Math.max(0, Math.min(100, (branch.finalDamage / maxHP) * 100))
    const { isLethal, isDangerous } = deriveLethalDangerous(
      undefined,
      branch.finalDamage,
      maxHP,
      false
    )

    return (
      <div className="space-y-1.5">
        {isLethal && (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 px-3 py-2">
            <Skull className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-red-700 dark:text-red-400">
                {t('editor:propertyPanel.lethal')}
              </p>
              <p className="text-xs text-red-600/80 dark:text-red-400/80">
                {t('editor:propertyPanel.lethalOverflow', {
                  overflow: (branch.finalDamage - maxHP).toLocaleString(),
                })}
              </p>
            </div>
          </div>
        )}
        {isDangerous && (
          <div className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 px-3 py-2">
            <TriangleAlert className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
                {t('editor:propertyPanel.dangerous')}
              </p>
              <p className="text-xs text-amber-600/80 dark:text-amber-400/80">
                {t('editor:propertyPanel.dangerousRemain', {
                  remain: remainHP.toLocaleString(),
                  pct: survivePct.toFixed(1),
                })}
              </p>
            </div>
          </div>
        )}
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">HP</span>
          <span className="tabular-nums">
            <span className="text-foreground">{remainHP.toLocaleString()}</span>
            <span className="text-muted-foreground"> / {maxHP.toLocaleString()}</span>
            <span className="text-red-500 ml-1">(-{branch.finalDamage.toLocaleString()})</span>
          </span>
        </div>
        <div className="h-2.5 bg-secondary rounded-full overflow-hidden flex">
          {/* 剩余 HP */}
          <div
            className="h-full rounded-l-full"
            style={{
              width: `${survivePct}%`,
              backgroundColor: 'rgb(34, 197, 94)',
            }}
          />
          {/* 伤害消耗 */}
          <div
            className="h-full"
            style={{
              width: `${damagePct}%`,
              backgroundColor: 'rgb(239, 68, 68)',
              backgroundImage:
                'repeating-linear-gradient(-45deg, transparent, transparent 2px, rgba(0,0,0,0.2) 2px, rgba(0,0,0,0.2) 4px)',
            }}
          />
        </div>
      </div>
    )
  }

  /** HP 条（累积视角，基于 HpSimulationSnapshot） */
  function renderHpBarAccumulative(snap: HpSimulationSnapshot) {
    const { hpBefore, hpAfter, hpMax, overkill } = snap
    const dealt = hpBefore - hpAfter
    const survivePct = (hpAfter / hpMax) * 100
    const damagePct = (dealt / hpMax) * 100
    const { isLethal, isDangerous } = deriveLethalDangerous(snap, 0, undefined, false)

    return (
      <div className="space-y-1.5">
        {isLethal && (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 px-3 py-2">
            <Skull className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-red-700 dark:text-red-400">
                {t('editor:propertyPanel.lethal')}
              </p>
              <p className="text-xs text-red-600/80 dark:text-red-400/80">
                {t('editor:propertyPanel.lethalOverflowAccumulative', {
                  overflow: (overkill ?? 0).toLocaleString(),
                })}
              </p>
            </div>
          </div>
        )}
        {isDangerous && (
          <div className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 px-3 py-2">
            <TriangleAlert className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
                {t('editor:propertyPanel.dangerous')}
              </p>
              <p className="text-xs text-amber-600/80 dark:text-amber-400/80">
                {t('editor:propertyPanel.dangerousRemain', {
                  remain: hpAfter.toLocaleString(),
                  pct: survivePct.toFixed(1),
                })}
              </p>
            </div>
          </div>
        )}
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">HP</span>
          <span className="tabular-nums">
            <span className="text-foreground">{hpAfter.toLocaleString()}</span>
            <span className="text-muted-foreground"> / {hpMax.toLocaleString()}</span>
            <span className="text-red-500 ml-1">(-{dealt.toLocaleString()})</span>
          </span>
        </div>
        <div className="h-2.5 bg-secondary rounded-full overflow-hidden flex">
          <div
            className="h-full rounded-l-full"
            style={{
              width: `${Math.max(0, Math.min(100, survivePct))}%`,
              backgroundColor: 'rgb(34, 197, 94)',
            }}
          />
          <div
            className="h-full"
            style={{
              width: `${Math.max(0, Math.min(100, damagePct))}%`,
              backgroundColor: 'rgb(239, 68, 68)',
              backgroundImage:
                'repeating-linear-gradient(-45deg, transparent, transparent 2px, rgba(0,0,0,0.2) 2px, rgba(0,0,0,0.2) 4px)',
            }}
          />
        </div>
      </div>
    )
  }

  /** 减伤构成条 */
  function renderMitigationBar(
    branch: BranchViewData,
    originalDamage: number,
    hpSnap: HpSimulationSnapshot | undefined
  ) {
    // 函数声明在 `if (!event) return null` 之后，但 TS 不会把闭包外的窄化保留进 hoist
    // 后的函数体——这里再窄化一次让后续 event.type 访问通过类型检查（运行期不可能进 if）。
    if (!event) return null
    const isPartialAoe = event.type === 'partial_aoe' || event.type === 'partial_final_aoe'
    // partial AOE 段内增量视角（仅 isPartialAoe + hpSnap 启用，HP 模拟关时回落事件级原始
    // 口径）：以"本事件应用伤害" = max(0, event.damage - 段进入本事件前的最大 event.damage)
    // 作为 baseline。各分量走 simulator 段感知的 delta 链，与 HP 条扣血量严格一致：
    //   raw 增量    = settlement                   (= event.damage - segOriginalMaxBefore)
    //   cd 增量     = preShieldDealt              (= candidateDamage - segCandidateMaxBefore)
    //   final 增量  = preClampDealt               (= finalDamage - segMaxBefore)
    //   pctMit_settlement  = raw 增量 - cd 增量   （此事件多扣的 % 减伤部分）
    //   shield_settlement  = cd 增量 - final 增量  （此事件多消耗的盾，盾被段内更大事件
    //                                              占满时为 0 → 与 HP 条扣血对齐）
    //   finalDamage_settlement = preClampDealt    （= HP 模拟实扣的段增量 pre-clamp）
    //   effective + overkill = preClampDealt      （overkill 直接用 hpSnap.overkill）
    // 段被压制（settlement = 0）→ 各段全 0 → denom <= 0 兜底隐藏整块。
    const total =
      isPartialAoe && hpSnap
        ? Math.max(0, originalDamage - (hpSnap.segOriginalMax ?? 0))
        : originalDamage
    const maxHP = branch.referenceMaxHP || 0
    let finalDamageScaled: number
    let shieldAbsorb: number
    let pctMitigation: number
    let overkill: number

    if (isPartialAoe && hpSnap) {
      // settlement view 的 delta 链
      const preClampDealt = hpSnap.hpBefore - hpSnap.hpAfter + (hpSnap.overkill ?? 0)
      const preShieldDealt = hpSnap.preShieldDealt ?? 0
      pctMitigation = Math.max(0, total - preShieldDealt)
      shieldAbsorb = Math.max(0, preShieldDealt - preClampDealt)
      finalDamageScaled = preClampDealt
      overkill = hpSnap.overkill ?? 0
    } else {
      // 事件级口径：用 candidateDamage（盾前伤害）切分盾 / 百分比，使真实盾与临时盾都正确归类。
      // candidate − final = 全部盾吸收量；total − candidate = 全部百分比减免量。
      finalDamageScaled = branch.finalDamage
      overkill = hpSnap?.overkill ?? (maxHP > 0 ? Math.max(0, finalDamageScaled - maxHP) : 0)
      const candidate = branch.candidateDamage ?? finalDamageScaled
      shieldAbsorb = Math.max(0, candidate - finalDamageScaled)
      pctMitigation = Math.max(0, total - candidate)
    }
    const effectiveDamage = finalDamageScaled - overkill

    // 原始伤害为 0（如 FFLogs 完全被盾吸收的事件）或 partial 段被压制（partialScale=0）时，
    // 用各段之和做分母回退；若各段也全为 0，整个块隐藏。
    const denom = total > 0 ? total : effectiveDamage + overkill + shieldAbsorb + pctMitigation
    if (denom <= 0) return null

    const overkillPct = (overkill / denom) * 100
    const effectivePct = (effectiveDamage / denom) * 100
    const shieldPct = (shieldAbsorb / denom) * 100
    const multiplierPct = (pctMitigation / denom) * 100

    return (
      <div className="space-y-1">
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">
            {t('editor:propertyPanel.mitigationComposition')}
          </span>
          <span className="tabular-nums">
            <span className="font-medium text-red-500">
              {Math.round(finalDamageScaled).toLocaleString()}
            </span>
            <span className="text-muted-foreground"> / {Math.round(total).toLocaleString()}</span>
            <span className="text-muted-foreground ml-1">
              ({branch.mitigationPercentage.toFixed(1)}%)
            </span>
          </span>
        </div>
        <TooltipProvider>
          <div className="h-2.5 bg-secondary rounded-full flex overflow-visible">
            {[
              {
                pct: overkillPct,
                color: 'rgb(55, 55, 55)',
                label: t('editor:propertyPanel.segmentOverkill', {
                  value: Math.round(overkill).toLocaleString(),
                  pct: overkillPct.toFixed(1),
                }),
              },
              {
                pct: effectivePct,
                color: 'rgb(239, 68, 68)',
                label: t('editor:propertyPanel.segmentEffective', {
                  value: Math.round(effectiveDamage).toLocaleString(),
                  pct: effectivePct.toFixed(1),
                }),
              },
              {
                pct: shieldPct,
                color: 'rgb(234, 179, 8)',
                label: t('editor:propertyPanel.segmentShield', {
                  value: Math.round(shieldAbsorb).toLocaleString(),
                  pct: shieldPct.toFixed(1),
                }),
              },
              {
                pct: multiplierPct,
                color: 'rgb(59, 130, 246)',
                label: t('editor:propertyPanel.segmentMultiplier', {
                  value: Math.round(pctMitigation).toLocaleString(),
                  pct: multiplierPct.toFixed(1),
                }),
              },
            ]
              .filter(s => s.pct > 0)
              .map((seg, i, arr) => (
                <Tooltip key={seg.color} delayDuration={0}>
                  <TooltipTrigger asChild>
                    <div
                      className={`h-full cursor-default ${i === 0 ? 'rounded-l-full' : ''} ${i === arr.length - 1 ? 'rounded-r-full' : ''}`}
                      style={{
                        width: `${seg.pct}%`,
                        minWidth: 4,
                        backgroundColor: seg.color,
                      }}
                    />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{seg.label}</p>
                  </TooltipContent>
                </Tooltip>
              ))}
          </div>
        </TooltipProvider>
      </div>
    )
  }

  /** 生效状态图标 */
  function renderAppliedStatuses(
    branch: BranchViewData,
    damageType: DamageType,
    originalDamage: number
  ) {
    if (!branch.appliedStatuses || branch.appliedStatuses.length === 0) return null

    // 实例级分桶：有 remainingBarrier 走盾值桶，否则才是百分比桶
    // （统一口径，并把 onBeforeShield 注 barrier 的 multiplier-type 状态归入盾值）
    const shieldStatuses = branch.appliedStatuses.filter(s => s.remainingBarrier !== undefined)
    const multiplierStatuses = branch.appliedStatuses.filter(s => s.remainingBarrier === undefined)

    const totalMultiplier = multiplierStatuses.reduce((acc, s) => {
      const meta = getStatusById(s.statusId)
      if (!meta) return acc
      const perf = s.performance ?? meta.performance
      const m = getMultiplierForDamageType(perf, damageType)
      return acc * m
    }, 1)
    const pctReduction = ((1 - totalMultiplier) * 100).toFixed(1)

    const totalShield = shieldStatuses.reduce((sum, s) => sum + (s.remainingBarrier || 0), 0)
    const shieldEquivPct =
      originalDamage > 0 ? ((totalShield / originalDamage) * 100).toFixed(1) : '0.0'

    const renderIcon = (status: MitigationStatus, index: number) => {
      const meta = getStatusById(status.statusId)
      const iconUrl = getStatusIconUrl(status.statusId)
      const statusName =
        getStatusName(status.statusId) || meta?.name || t('editor:propertyPanel.unknownStatus')
      let mitigationText = ''
      if (status.remainingBarrier !== undefined) {
        mitigationText = t('editor:propertyPanel.shieldValue', {
          value: status.remainingBarrier.toLocaleString(),
        })
      } else if (meta?.type === 'multiplier') {
        const perf = status.performance ?? meta.performance
        const m = getMultiplierForDamageType(perf, damageType)
        mitigationText = `${((1 - m) * 100).toFixed(1)}%`
      }
      return (
        <Tooltip key={`${status.statusId}-${index}`} delayDuration={0}>
          <TooltipTrigger asChild>
            <div className="cursor-default">
              {iconUrl ? (
                <img src={iconUrl} alt={statusName} className="w-6 h-6 object-contain" />
              ) : (
                <div className="w-6 h-6 bg-muted rounded text-[10px] flex items-center justify-center">
                  {statusName.slice(0, 1)}
                </div>
              )}
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>
              {statusName}
              {mitigationText ? ` · ${mitigationText}` : ''}
            </p>
          </TooltipContent>
        </Tooltip>
      )
    }

    return (
      <TooltipProvider>
        <div className="space-y-1.5">
          {multiplierStatuses.length > 0 && (
            <div className="space-y-0.5">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">
                  {t('editor:propertyPanel.percentage')}
                </span>
                <span className="text-green-500 font-medium tabular-nums">-{pctReduction}%</span>
              </div>
              <div className="flex flex-wrap gap-0.5">
                {multiplierStatuses.map((s, i) => renderIcon(s, i))}
              </div>
            </div>
          )}
          {shieldStatuses.length > 0 && (
            <div className="space-y-0.5">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">{t('editor:propertyPanel.shield')}</span>
                <span className="text-yellow-500 font-medium tabular-nums">
                  {totalShield.toLocaleString()}
                  <span className="text-muted-foreground ml-1">({shieldEquivPct}%)</span>
                </span>
              </div>
              <div className="flex flex-wrap gap-0.5">
                {shieldStatuses.map((s, i) => renderIcon(s, i))}
              </div>
            </div>
          )}
        </div>
      </TooltipProvider>
    )
  }

  /** 渲染单个 branch 的三块内容（无 card 包裹） */
  function renderBranchContent(
    branch: BranchViewData,
    damageType: DamageType,
    originalDamage: number
  ) {
    // 非坦事件优先走累积视角；坦专 / 缺失 hpSimulation / HP 模拟开关关 时回退孤立视角
    const hpSnap = enableHpSimulation ? result?.hpSimulation : undefined
    return (
      <>
        {hpSnap ? renderHpBarAccumulative(hpSnap) : renderHpBar(branch)}
        {renderMitigationBar(branch, originalDamage, hpSnap)}
        {renderAppliedStatuses(branch, damageType, originalDamage)}
      </>
    )
  }

  return (
    <div className="fixed right-4 top-[136px] bottom-[112px] w-[22rem] hidden md:flex flex-col bg-background/95 backdrop-blur border rounded-xl shadow-lg z-40 overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b flex items-center justify-between">
        <h2 className="font-semibold">{t('editor:propertyPanel.title')}</h2>
        {!isReadOnly && (
          <button
            onClick={() => removeDamageEvent(event.id)}
            className="p-1 hover:bg-destructive/10 hover:text-destructive rounded transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Properties */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-custom">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">
            {t('editor:propertyPanel.eventName')}
          </label>
          <input
            type="text"
            value={nameDraft}
            onChange={e => setNameDraft(e.target.value)}
            onBlur={() => {
              if (nameDraft !== event.name) {
                updateDamageEvent(event.id, { name: nameDraft })
              }
            }}
            maxLength={DAMAGE_EVENT_NAME_MAX_LENGTH}
            className="w-full px-2.5 py-1.5 border border-border rounded-md text-sm bg-background text-foreground disabled:bg-muted disabled:cursor-not-allowed"
            disabled={isReadOnly}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">
              {t('editor:propertyPanel.time')}
            </label>
            <TimeInput
              value={event.time}
              onChange={v => updateDamageEvent(event.id, { time: v })}
              min={0}
              size="sm"
              disabled={isReadOnly}
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">
              {t('editor:propertyPanel.originalDamage')}
            </label>
            <input
              type="number"
              value={damageDraft}
              onChange={e => setDamageDraft(e.target.value)}
              onBlur={() => {
                const parsed = parseInt(damageDraft) || 0
                if (parsed !== event.damage) {
                  updateDamageEvent(event.id, { damage: parsed })
                } else if (damageDraft !== String(event.damage)) {
                  // draft 是 "" 或 "0a" 等非法输入但 parsed 等于现值；规整显示
                  setDamageDraft(String(event.damage))
                }
              }}
              className="w-full px-2.5 py-1.5 border border-border rounded-md text-sm bg-background text-foreground disabled:bg-muted disabled:cursor-not-allowed"
              disabled={isReadOnly}
            />
          </div>
        </div>

        {/* 读条窗口：开始（时间格式）+ 时长（浮点秒）；both-or-neither */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">咏唱开始</label>
            <TimeInput
              value={castStartValue}
              onChange={v => {
                setCastStartValue(v)
                commitCastWindow(v, castDurationDraft)
              }}
              size="sm"
              disabled={isReadOnly}
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">咏唱时长</label>
            <input
              type="number"
              step="0.1"
              min="0"
              value={castDurationDraft}
              onChange={e => setCastDurationDraft(e.target.value)}
              onBlur={() => commitCastWindow(castStartValue, castDurationDraft)}
              className="w-full px-2.5 py-1.5 border border-border rounded-md text-sm bg-background text-foreground disabled:bg-muted disabled:cursor-not-allowed"
              disabled={isReadOnly}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">
              {t('editor:propertyPanel.damageType')}
            </label>
            <Select
              value={event.damageType || 'physical'}
              onValueChange={v =>
                updateDamageEvent(event.id, {
                  damageType: v as DamageType,
                })
              }
              disabled={isReadOnly}
            >
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="item-aligned">
                <SelectItem value="physical">
                  {t('editor:propertyPanel.damageTypePhysical')}
                </SelectItem>
                <SelectItem value="magical">
                  {t('editor:propertyPanel.damageTypeMagical')}
                </SelectItem>
                <SelectItem value="darkness">
                  {t('editor:propertyPanel.damageTypeSpecial')}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">
              {t('editor:propertyPanel.attackType')}
            </label>
            <Select
              value={event.type || 'aoe'}
              onValueChange={v =>
                updateDamageEvent(event.id, {
                  type: v as DamageEventType,
                })
              }
              disabled={isReadOnly}
            >
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="item-aligned">
                {DAMAGE_EVENT_TYPES.map(t => (
                  <SelectItem key={t} value={t}>
                    {DAMAGE_EVENT_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* DOT 快照设置 */}
        <div className="flex items-center gap-2 h-8">
          <Switch
            checked={event.snapshotTime != null}
            onCheckedChange={checked => {
              if (checked) {
                updateDamageEvent(event.id, { snapshotTime: event.time })
              } else {
                updateDamageEvent(event.id, { snapshotTime: undefined })
              }
            }}
            disabled={isReadOnly}
          />
          <span className="text-xs text-muted-foreground shrink-0">DoT</span>
          {event.snapshotTime != null && (
            <>
              <span className="text-xs text-muted-foreground shrink-0 ml-auto">
                {t('editor:propertyPanel.snapshotTime')}
              </span>
              <TimeInput
                value={event.snapshotTime}
                onChange={v => updateDamageEvent(event.id, { snapshotTime: v })}
                min={0}
                size="sm"
                disabled={isReadOnly}
                className="w-[calc(50%-6px)]"
              />
            </>
          )}
        </div>

        {/* 目标减是否生效 */}
        <div className="flex items-center gap-2 h-8">
          <Switch
            checked={!event.targetMitigationDisabled}
            onCheckedChange={checked =>
              updateDamageEvent(event.id, {
                targetMitigationDisabled: checked ? undefined : true,
              })
            }
            disabled={isReadOnly}
          />
          <span className="text-xs text-muted-foreground shrink-0">
            {t('editor:propertyPanel.targetMitigationEnabled')}
          </span>
          {!event.targetMitigationDisabled && (
            <>
              <span className="text-xs text-muted-foreground shrink-0 ml-auto">
                {t('editor:propertyPanel.damageSource')}
              </span>
              <input
                type="text"
                value={event.damageSource ?? ''}
                onChange={e =>
                  updateDamageEvent(event.id, { damageSource: e.target.value || undefined })
                }
                disabled={isReadOnly}
                className="w-[calc(50%-6px)] h-7 rounded-md border border-input bg-transparent px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              />
            </>
          )}
        </div>

        {/* 部分 AOE 伤害详情（仅编辑模式 + HP 模拟开 + partial AOE + 有段快照） */}
        {!timeline.isReplayMode &&
          result &&
          enableHpSimulation &&
          result.hpSimulation &&
          (event.type === 'partial_aoe' || event.type === 'partial_final_aoe') &&
          (() => {
            // snapshot.segOriginalMax = 段进入本事件前的最大 event.damage（**不含自身**）；
            // 段刚开时为 0。
            // - 显示"最高区间伤害" = max(prior, own)，含自身，即整段（截至本事件）的真实最大
            //   原始伤害；本事件就是段最高时不会显示 0
            // - 显示"本事件应用伤害" = max(0, own - prior)，即"本事件应该处理的原始伤害"
            //   （刷新段最高时 = own - prior 的增量；被段内更大事件压制 / 与最高持平时 = 0）
            const segOriginalMaxBefore = result.hpSimulation.segOriginalMax ?? 0
            const segOriginalMax = Math.max(segOriginalMaxBefore, event.damage)
            const settlement = Math.max(0, event.damage - segOriginalMaxBefore)
            return (
              <div className="pt-3 border-t space-y-2">
                <h3 className="text-sm font-semibold">
                  {t('editor:propertyPanel.partialAoeTitle')}
                </h3>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="space-y-0.5">
                    <div className="text-muted-foreground">
                      {t('editor:propertyPanel.maxSegmentDamage')}
                    </div>
                    <div className="text-sm font-medium tabular-nums">
                      {segOriginalMax.toLocaleString()}
                    </div>
                  </div>
                  <div className="space-y-0.5">
                    <div className="text-muted-foreground">
                      {t('editor:propertyPanel.eventOriginalDamage')}
                    </div>
                    <div className="text-sm font-medium tabular-nums">
                      {event.damage.toLocaleString()}
                    </div>
                  </div>
                  <div className="space-y-0.5">
                    <div className="text-muted-foreground">
                      {t('editor:propertyPanel.eventAppliedDamage')}
                    </div>
                    <div className="text-sm font-medium tabular-nums">
                      {settlement.toLocaleString()}
                    </div>
                  </div>
                </div>
              </div>
            )
          })()}

        {/* Mitigation Result (仅编辑模式；死刑 / 普攻的血量以坦克中位血为基准) */}
        {!timeline.isReplayMode && result && (
          <div className="pt-3 border-t space-y-3">
            <div className="flex items-center gap-1">
              <h3 className="text-sm font-semibold">
                {t('editor:propertyPanel.estimatedMitigation')}
              </h3>
              <Popover open={helpOpen}>
                <PopoverTrigger asChild>
                  <button
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    onMouseEnter={() => setHelpOpen(true)}
                    onMouseLeave={() => setHelpOpen(false)}
                  >
                    <HelpCircle className="w-3.5 h-3.5" />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  side="bottom"
                  align="start"
                  className="w-72"
                  onMouseEnter={() => setHelpOpen(true)}
                  onMouseLeave={() => setHelpOpen(false)}
                >
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {t('editor:propertyPanel.helpTextBefore')}
                    <b>{t('editor:propertyPanel.helpTextEmphasis')}</b>
                    {t('editor:propertyPanel.helpTextAfter')}
                  </p>
                </PopoverContent>
              </Popover>
            </div>

            {/* 多坦模式：下拉选择 + 平铺开关；平铺关闭时只显示选中的坦克 */}
            {result.perVictim && result.perVictim.length >= 2
              ? (() => {
                  const perVictim = result.perVictim
                  const damageType = event.damageType || 'physical'
                  // 仅当 tankSelection 对应当前事件 + 该坦克仍在 perVictim 里时才沿用，
                  // 否则回退到 perVictim[0]（最优减伤分支）
                  const selectedId =
                    tankSelection?.eventId === event.id ? tankSelection.tankId : null
                  const effectiveTankId =
                    perVictim.find(v => v.playerId === selectedId)?.playerId ??
                    perVictim[0].playerId

                  const renderTankCard = (v: (typeof perVictim)[number]) => {
                    const playerMeta = timeline.composition.players.find(p => p.id === v.playerId)
                    const branch: BranchViewData = {
                      finalDamage: v.finalDamage,
                      mitigationPercentage: v.mitigationPercentage,
                      appliedStatuses: v.appliedStatuses,
                      referenceMaxHP: v.referenceMaxHP,
                      candidateDamage: v.candidateDamage,
                    }
                    return (
                      <div key={v.playerId} className="border rounded-lg p-3 space-y-2 bg-card">
                        <div className="flex items-center gap-2">
                          {playerMeta ? (
                            <>
                              <JobIcon job={playerMeta.job} size="sm" />
                              <span className="text-sm font-medium">
                                {getJobName(playerMeta.job)}
                              </span>
                            </>
                          ) : (
                            <span className="text-sm font-medium">P{v.playerId}</span>
                          )}
                        </div>
                        {renderBranchContent(branch, damageType, result.originalDamage)}
                      </div>
                    )
                  }

                  const selected = perVictim.find(v => v.playerId === effectiveTankId)!
                  const selectedBranch: BranchViewData = {
                    finalDamage: selected.finalDamage,
                    mitigationPercentage: selected.mitigationPercentage,
                    appliedStatuses: selected.appliedStatuses,
                    referenceMaxHP: selected.referenceMaxHP,
                    candidateDamage: selected.candidateDamage,
                  }

                  return (
                    <>
                      <div className="flex items-center gap-2">
                        <Select
                          value={String(effectiveTankId)}
                          onValueChange={v =>
                            setTankSelection({ eventId: event.id, tankId: Number(v) })
                          }
                          disabled={isTiled}
                        >
                          <SelectTrigger className="flex-1 h-9">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {perVictim.map(v => {
                              const m = timeline.composition.players.find(p => p.id === v.playerId)
                              return (
                                <SelectItem key={v.playerId} value={String(v.playerId)}>
                                  <span className="flex items-center gap-2">
                                    {m && <JobIcon job={m.job} size="sm" />}
                                    <span>{m ? getJobName(m.job) : `P${v.playerId}`}</span>
                                  </span>
                                </SelectItem>
                              )
                            })}
                          </SelectContent>
                        </Select>
                        <Switch checked={isTiled} onCheckedChange={setIsTiled} />
                        <span className="text-xs text-muted-foreground shrink-0">
                          {t('editor:propertyPanel.tiled')}
                        </span>
                      </div>

                      {isTiled ? (
                        <div className="space-y-3">{perVictim.map(renderTankCard)}</div>
                      ) : (
                        renderBranchContent(selectedBranch, damageType, result.originalDamage)
                      )}
                    </>
                  )
                })()
              : /* 单坦 / AOE / 无坦：原样渲染（无 card 包裹） */
                renderBranchContent(
                  {
                    finalDamage: result.finalDamage,
                    mitigationPercentage: result.mitigationPercentage,
                    appliedStatuses: result.appliedStatuses,
                    referenceMaxHP: result.referenceMaxHP,
                    candidateDamage: result.candidateDamage,
                  },
                  event.damageType || 'physical',
                  result.originalDamage
                )}
          </div>
        )}

        {/* 临时减伤（仅编辑模式 + 有计算结果时显示；组件内部对 isReadOnly 返回 null） */}
        {!timeline.isReplayMode && result && <TempMitigationSection event={event} />}

        {/* Player Damage Details (回放模式) */}
        {timeline.isReplayMode && event.playerDamageDetails && (
          <div className="pt-4 border-t">
            <PlayerDamageDetails event={event} />
          </div>
        )}
      </div>
    </div>
  )
}
