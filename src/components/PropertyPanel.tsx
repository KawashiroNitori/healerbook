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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { TimeInput } from '@/components/ui/time-input'
import type { DamageType } from '@/types/timeline'

export default function PropertyPanel() {
  const { timeline, selectedEventId, updateDamageEvent, removeDamageEvent } = useTimelineStore()
  const isReadOnly = useEditorReadOnly()
  const [helpOpen, setHelpOpen] = useState(false)

  // 使用新的伤害计算 Hook（基于状态）
  const eventResults = useDamageCalculation(timeline)

  // 只有在选中伤害事件时才显示面板（不响应技能选中）
  if (!timeline || !selectedEventId) {
    return null
  }

  // 显示伤害事件属性
  const event = timeline.damageEvents.find(e => e.id === selectedEventId)
  if (!event) return null

  // 使用预先计算的结果（可能为空）
  const result = eventResults.get(event.id)

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
              min={-30}
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
            <select
              value={event.damageType || 'physical'}
              onChange={e =>
                updateDamageEvent(event.id, {
                  damageType: e.target.value as DamageType,
                })
              }
              className="w-full px-2.5 py-1.5 border border-border rounded-md text-sm bg-background text-foreground disabled:bg-muted disabled:cursor-not-allowed"
              disabled={isReadOnly}
            >
              <option value="physical">物理</option>
              <option value="magical">魔法</option>
              <option value="darkness">特殊</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">攻击类型</label>
            <select
              value={event.type || 'aoe'}
              onChange={e =>
                updateDamageEvent(event.id, {
                  type: e.target.value as 'aoe' | 'tankbuster',
                })
              }
              className="w-full px-2.5 py-1.5 border border-border rounded-md text-sm bg-background text-foreground disabled:bg-muted disabled:cursor-not-allowed"
              disabled={isReadOnly}
            >
              <option value="aoe">AOE</option>
              <option value="tankbuster">死刑</option>
            </select>
          </div>
        </div>

        {/* Mitigation Result (仅编辑模式，死刑不参与) */}
        {!timeline.isReplayMode && event.type === 'tankbuster' && (
          <div className="pt-4 border-t">
            <p className="text-sm text-muted-foreground">死刑不参与团减计算</p>
          </div>
        )}
        {!timeline.isReplayMode && event.type !== 'tankbuster' && result && (
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

            {/* HP 条（编辑模式） */}
            {(() => {
              const maxHP = result.referenceMaxHP
              if (!maxHP || maxHP <= 0) return null

              const remainHP = Math.max(0, maxHP - result.finalDamage)
              const survivePct = Math.max(0, Math.min(100, (remainHP / maxHP) * 100))
              const damagePct = Math.max(0, Math.min(100, (result.finalDamage / maxHP) * 100))
              const isLethal = result.finalDamage >= maxHP
              const isDangerous = !isLethal && result.finalDamage >= maxHP * 0.95

              return (
                <div className="space-y-1.5">
                  {isLethal && (
                    <div className="flex items-start gap-2 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 px-3 py-2">
                      <Skull className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400 mt-0.5" />
                      <div>
                        <p className="text-xs font-medium text-red-700 dark:text-red-400">致死</p>
                        <p className="text-xs text-red-600/80 dark:text-red-400/80">
                          伤害溢出 {(result.finalDamage - maxHP).toLocaleString()} HP，需要更多减伤
                        </p>
                      </div>
                    </div>
                  )}
                  {isDangerous && (
                    <div className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 px-3 py-2">
                      <TriangleAlert className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
                      <div>
                        <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
                          危险
                        </p>
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
                      <span className="text-red-500 ml-1">
                        (-{result.finalDamage.toLocaleString()})
                      </span>
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
            })()}

            {/* 减伤构成条 */}
            {(() => {
              const total = result.originalDamage
              if (total <= 0) return null

              const maxHP = result.referenceMaxHP || 0
              const shieldAbsorb = (result.appliedStatuses || []).reduce((sum, s) => {
                const meta = getStatusById(s.statusId)
                if (meta?.type !== 'absorbed') return sum
                return sum + (s.remainingBarrier || 0)
              }, 0)
              const pctMitigation = Math.max(0, total - result.finalDamage - shieldAbsorb)
              const overkill = maxHP > 0 ? Math.max(0, result.finalDamage - maxHP) : 0
              const effectiveDamage = result.finalDamage - overkill

              const overkillPct = (overkill / total) * 100
              const effectivePct = (effectiveDamage / total) * 100
              const shieldPct = (shieldAbsorb / total) * 100
              const multiplierPct = (pctMitigation / total) * 100

              return (
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">减伤构成</span>
                    <span className="tabular-nums">
                      <span className="font-medium text-red-500">
                        {result.finalDamage.toLocaleString()}
                      </span>
                      <span className="text-muted-foreground"> / {total.toLocaleString()}</span>
                      <span className="text-muted-foreground ml-1">
                        ({result.mitigationPercentage.toFixed(1)}%)
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
            })()}

            {/* 生效状态图标 */}
            {result.appliedStatuses &&
              result.appliedStatuses.length > 0 &&
              (() => {
                const damageType = event.damageType || 'physical'
                const multiplierStatuses = result.appliedStatuses.filter(
                  s => getStatusById(s.statusId)?.type === 'multiplier'
                )
                const shieldStatuses = result.appliedStatuses.filter(
                  s => getStatusById(s.statusId)?.type === 'absorbed'
                )

                const totalMultiplier = multiplierStatuses.reduce((acc, s) => {
                  const meta = getStatusById(s.statusId)
                  if (!meta) return acc
                  const m =
                    damageType === 'physical'
                      ? meta.performance.physics
                      : damageType === 'magical'
                        ? meta.performance.magic
                        : meta.performance.darkness
                  return acc * m
                }, 1)
                const pctReduction = ((1 - totalMultiplier) * 100).toFixed(1)

                const totalShield = shieldStatuses.reduce(
                  (sum, s) => sum + (s.remainingBarrier || 0),
                  0
                )
                const shieldEquivPct =
                  result.originalDamage > 0
                    ? ((totalShield / result.originalDamage) * 100).toFixed(1)
                    : '0.0'

                const renderIcon = (status: (typeof result.appliedStatuses)[0], index: number) => {
                  const meta = getStatusById(status.statusId)
                  const iconUrl = getStatusIconUrl(status.statusId)
                  const statusName = getStatusName(status.statusId) || meta?.name || '未知状态'
                  let mitigationText = ''
                  if (meta?.type === 'multiplier') {
                    const m =
                      damageType === 'physical'
                        ? meta.performance.physics
                        : damageType === 'magical'
                          ? meta.performance.magic
                          : meta.performance.darkness
                    mitigationText = `${((1 - m) * 100).toFixed(1)}%`
                  } else if (meta?.type === 'absorbed') {
                    mitigationText = `盾: ${(status.remainingBarrier || 0).toLocaleString()}`
                  }
                  return (
                    <Tooltip key={`${status.statusId}-${index}`} delayDuration={0}>
                      <TooltipTrigger asChild>
                        <div className="cursor-default">
                          {iconUrl ? (
                            <img
                              src={iconUrl}
                              alt={statusName}
                              className="w-6 h-6 object-contain"
                            />
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
                            <span className="text-green-500 font-medium tabular-nums">
                              -{pctReduction}%
                            </span>
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
                              <span className="text-muted-foreground ml-1">
                                ({shieldEquivPct}%)
                              </span>
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
              })()}
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
