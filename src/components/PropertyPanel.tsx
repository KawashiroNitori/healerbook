/**
 * 属性面板组件
 */

import { useState } from 'react'
import { DAMAGE_EVENT_NAME_MAX_LENGTH } from '@/constants/limits'
import { useTimelineStore } from '@/store/timelineStore'
import { useDamageCalculation } from '@/hooks/useDamageCalculation'
import { useEditorReadOnly } from '@/hooks/useEditorReadOnly'
import { getStatusById } from '@/utils/statusRegistry'
import { getStatusIconUrl, getStatusName } from '@/utils/statusIconUtils'
import { Trash2, TriangleAlert, Skull, HelpCircle } from 'lucide-react'
import PlayerDamageDetails from './PlayerDamageDetails'
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
import type { HpSimulationSnapshot } from '@/utils/mitigationCalculator'

interface BranchViewData {
  finalDamage: number
  mitigationPercentage: number
  appliedStatuses: MitigationStatus[]
  referenceMaxHP?: number
}

export default function PropertyPanel() {
  const { timeline, selectedEventId, updateDamageEvent, removeDamageEvent } = useTimelineStore()
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
  const { results: eventResults } = useDamageCalculation(timeline)

  // 只有在选中伤害事件时才显示面板（不响应技能选中）
  if (!timeline || !selectedEventId) {
    return null
  }

  // 显示伤害事件属性
  const event = timeline.damageEvents.find(e => e.id === selectedEventId)
  if (!event) return null

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
    const isLethal = branch.finalDamage >= maxHP
    const isDangerous = !isLethal && branch.finalDamage >= maxHP * 0.95

    return (
      <div className="space-y-1.5">
        {isLethal && (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 px-3 py-2">
            <Skull className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-red-700 dark:text-red-400">致死</p>
              <p className="text-xs text-red-600/80 dark:text-red-400/80">
                伤害溢出 {(branch.finalDamage - maxHP).toLocaleString()} HP，需要更多减伤
              </p>
            </div>
          </div>
        )}
        {isDangerous && (
          <div className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 px-3 py-2">
            <TriangleAlert className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-amber-700 dark:text-amber-300">危险</p>
              <p className="text-xs text-amber-600/80 dark:text-amber-400/80">
                伤害后仅剩 {remainHP.toLocaleString()} HP（{survivePct.toFixed(1)}%）
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
    const isLethal = hpAfter === 0 && (overkill ?? 0) > 0
    const isDangerous = !isLethal && survivePct < 5

    return (
      <div className="space-y-1.5">
        {isLethal && (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 px-3 py-2">
            <Skull className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-red-700 dark:text-red-400">致死</p>
              <p className="text-xs text-red-600/80 dark:text-red-400/80">
                伤害溢出 {(overkill ?? 0).toLocaleString()} HP，需要更多减伤 / 治疗
              </p>
            </div>
          </div>
        )}
        {isDangerous && (
          <div className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 px-3 py-2">
            <TriangleAlert className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-amber-700 dark:text-amber-300">危险</p>
              <p className="text-xs text-amber-600/80 dark:text-amber-400/80">
                伤害后仅剩 {hpAfter.toLocaleString()} HP（{survivePct.toFixed(1)}%）
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

  /** partial AOE 段累积信息 */
  function renderPartialSegInfo(snap: HpSimulationSnapshot, ev: DamageEvent) {
    if (snap.segMax === undefined) return null
    const dealt = snap.hpBefore - snap.hpAfter
    const isFinal = ev.type === 'partial_final_aoe'

    return (
      <div className="space-y-1 text-xs border-t pt-2 mt-2">
        <div className="flex justify-between">
          <span className="text-muted-foreground">段累积</span>
          <span className="tabular-nums text-foreground">
            {snap.segMax.toLocaleString()}
            {isFinal && <span className="ml-1 text-amber-600">（段结束）</span>}
          </span>
        </div>
        <div className="text-muted-foreground">
          本次扣血 = max(0, {ev.damage.toLocaleString()} - {(snap.segMax - dealt).toLocaleString()})
          = {dealt.toLocaleString()}
        </div>
      </div>
    )
  }

  /** 减伤构成条 */
  function renderMitigationBar(branch: BranchViewData, originalDamage: number) {
    const total = originalDamage
    const maxHP = branch.referenceMaxHP || 0
    // 按实例级 remainingBarrier 判盾（与 calculator Phase 3 口径一致）
    // 覆盖 meta.type='multiplier' 但被 onBeforeShield 注入 barrier 的场景（如死斗）
    const shieldAbsorb = (branch.appliedStatuses || []).reduce(
      (sum, s) => sum + (s.remainingBarrier ?? 0),
      0
    )
    const pctMitigation = Math.max(0, total - branch.finalDamage - shieldAbsorb)
    const overkill =
      result?.hpSimulation?.overkill ?? (maxHP > 0 ? Math.max(0, branch.finalDamage - maxHP) : 0)
    const effectiveDamage = branch.finalDamage - overkill

    // 原始伤害为 0（如 FFLogs 完全被盾吸收的事件）时，用各段之和做分母回退，
    // 避免除零；若各段也全为 0，整个块隐藏。
    const denom = total > 0 ? total : effectiveDamage + overkill + shieldAbsorb + pctMitigation
    if (denom <= 0) return null

    const overkillPct = (overkill / denom) * 100
    const effectivePct = (effectiveDamage / denom) * 100
    const shieldPct = (shieldAbsorb / denom) * 100
    const multiplierPct = (pctMitigation / denom) * 100

    return (
      <div className="space-y-1">
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">减伤构成</span>
          <span className="tabular-nums">
            <span className="font-medium text-red-500">{branch.finalDamage.toLocaleString()}</span>
            <span className="text-muted-foreground"> / {total.toLocaleString()}</span>
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
                label: `溢出伤害 ${overkill.toLocaleString()} (${overkillPct.toFixed(1)}%)`,
              },
              {
                pct: effectivePct,
                color: 'rgb(239, 68, 68)',
                label: `有效伤害 ${effectiveDamage.toLocaleString()} (${effectivePct.toFixed(1)}%)`,
              },
              {
                pct: shieldPct,
                color: 'rgb(234, 179, 8)',
                label: `护盾减免 ${shieldAbsorb.toLocaleString()} (${shieldPct.toFixed(1)}%)`,
              },
              {
                pct: multiplierPct,
                color: 'rgb(59, 130, 246)',
                label: `百分比减免 ${pctMitigation.toLocaleString()} (${multiplierPct.toFixed(1)}%)`,
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
      const m =
        damageType === 'physical'
          ? perf.physics
          : damageType === 'magical'
            ? perf.magic
            : perf.darkness
      return acc * m
    }, 1)
    const pctReduction = ((1 - totalMultiplier) * 100).toFixed(1)

    const totalShield = shieldStatuses.reduce((sum, s) => sum + (s.remainingBarrier || 0), 0)
    const shieldEquivPct =
      originalDamage > 0 ? ((totalShield / originalDamage) * 100).toFixed(1) : '0.0'

    const renderIcon = (status: MitigationStatus, index: number) => {
      const meta = getStatusById(status.statusId)
      const iconUrl = getStatusIconUrl(status.statusId)
      const statusName = getStatusName(status.statusId) || meta?.name || '未知状态'
      let mitigationText = ''
      if (status.remainingBarrier !== undefined) {
        mitigationText = `盾: ${status.remainingBarrier.toLocaleString()}`
      } else if (meta?.type === 'multiplier') {
        const perf = status.performance ?? meta.performance
        const m =
          damageType === 'physical'
            ? perf.physics
            : damageType === 'magical'
              ? perf.magic
              : perf.darkness
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
                <span className="text-muted-foreground">百分比</span>
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
                <span className="text-muted-foreground">盾</span>
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
    // 非坦事件优先走累积视角；坦专 / 缺失 hpSimulation 时回退孤立视角
    const hpSnap = result?.hpSimulation
    return (
      <>
        {hpSnap ? renderHpBarAccumulative(hpSnap) : renderHpBar(branch)}
        {renderMitigationBar(branch, originalDamage)}
        {renderAppliedStatuses(branch, damageType, originalDamage)}
        {hpSnap &&
          (event!.type === 'partial_aoe' || event!.type === 'partial_final_aoe') &&
          renderPartialSegInfo(hpSnap, event!)}
      </>
    )
  }

  return (
    <div className="fixed right-4 top-[136px] bottom-[112px] w-[22rem] hidden md:flex flex-col bg-background/95 backdrop-blur border rounded-xl shadow-lg z-40 overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b flex items-center justify-between">
        <h2 className="font-semibold">伤害事件</h2>
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
          <label className="block text-xs text-muted-foreground mb-1">事件名称</label>
          <input
            type="text"
            value={event.name}
            onChange={e => updateDamageEvent(event.id, { name: e.target.value })}
            maxLength={DAMAGE_EVENT_NAME_MAX_LENGTH}
            className="w-full px-2.5 py-1.5 border border-border rounded-md text-sm bg-background text-foreground disabled:bg-muted disabled:cursor-not-allowed"
            disabled={isReadOnly}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">时间</label>
            <TimeInput
              value={event.time}
              onChange={v => updateDamageEvent(event.id, { time: v })}
              min={0}
              size="sm"
              disabled={isReadOnly}
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">原始伤害</label>
            <input
              type="number"
              value={event.damage}
              onChange={e => updateDamageEvent(event.id, { damage: parseInt(e.target.value) || 0 })}
              className="w-full px-2.5 py-1.5 border border-border rounded-md text-sm bg-background text-foreground disabled:bg-muted disabled:cursor-not-allowed"
              disabled={isReadOnly}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">伤害类型</label>
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
                <SelectItem value="physical">物理</SelectItem>
                <SelectItem value="magical">魔法</SelectItem>
                <SelectItem value="darkness">特殊</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">攻击类型</label>
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
              <span className="text-xs text-muted-foreground shrink-0 ml-auto">快照时刻</span>
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

        {/* Mitigation Result (仅编辑模式；死刑 / 普攻的血量以坦克中位血为基准) */}
        {!timeline.isReplayMode && result && (
          <div className="pt-3 border-t space-y-3">
            <div className="flex items-center gap-1">
              <h3 className="text-sm font-semibold">预估减伤效果</h3>
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
                    该计算结果为基于部分统计数据的<b>估算效果</b>
                    ，除部分技能（如秘策）外并未计算暴击、增疗等因素，与游戏中的实际伤害可能会有较大差异，仅供参考。
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
                        <span className="text-xs text-muted-foreground shrink-0">平铺</span>
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
                  },
                  event.damageType || 'physical',
                  result.originalDamage
                )}
          </div>
        )}

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
