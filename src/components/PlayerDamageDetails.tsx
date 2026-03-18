/**
 * 玩家伤害详情组件
 * 在回放模式下展示每个玩家的详细伤害信息
 */

import type { DamageEvent } from '@/types/timeline'
import { getStatusById } from '@/utils/statusRegistry'
import { getStatusIconUrl, getStatusName } from '@/utils/statusIconUtils'
import { getJobName, sortJobsByOrder } from '@/data/jobs'
import JobIcon from './JobIcon'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

interface PlayerDamageDetailsProps {
  event: DamageEvent
}

export default function PlayerDamageDetails({ event }: PlayerDamageDetailsProps) {
  if (!event.playerDamageDetails || event.playerDamageDetails.length === 0) {
    return <div className="text-sm text-muted-foreground">没有玩家伤害详情数据</div>
  }

  // 按照职业顺序排序玩家伤害详情
  const sortedDetails = sortJobsByOrder(event.playerDamageDetails, d => d.job)

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">玩家伤害详情</h3>

      {sortedDetails.map(detail => {
        // 直接使用 detail.statuses（来自 PlayerDamageDetail）
        const activeStatuses = detail.statuses || []

        if (detail.unmitigatedDamage === 0) return null

        // 计算生命条数据
        const maxHP = detail.maxHitPoints
        const currentHP = detail.hitPoints ?? 0
        const hpBar =
          maxHP && maxHP > 0
            ? {
                survivePct: Math.max(0, Math.min(100, (currentHP / maxHP) * 100)),
                damagePct: Math.max(0, Math.min(100, (detail.finalDamage / maxHP) * 100)),
              }
            : null

        return (
          <div key={detail.playerId} className="border rounded-lg p-3 space-y-2 bg-card">
            {/* 玩家信息 */}
            <div className="flex items-center gap-2">
              <JobIcon job={detail.job} size="sm" />
              <span className="text-sm font-medium">{getJobName(detail.job)}</span>
            </div>

            {/* 生命条 */}
            {hpBar !== null && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">HP</span>
                  <span className="tabular-nums">
                    <span className="text-foreground">{detail.hitPoints?.toLocaleString()}</span>
                    <span className="text-muted-foreground">
                      {' '}
                      / {detail.maxHitPoints?.toLocaleString()}
                    </span>
                    <span className="text-red-500 ml-1">
                      (-{detail.finalDamage.toLocaleString()})
                    </span>
                  </span>
                </div>
                <div className="h-2.5 bg-secondary rounded-full overflow-hidden flex">
                  {/* 伤害后剩余 HP */}
                  <div
                    className="h-full rounded-l-full"
                    style={{
                      width: `${hpBar.survivePct}%`,
                      backgroundColor: 'rgb(34, 197, 94)',
                    }}
                  />
                  {/* 本次伤害消耗 */}
                  <div
                    className="h-full"
                    style={{
                      width: `${hpBar.damagePct}%`,
                      backgroundColor: 'rgb(239, 68, 68)',
                      backgroundImage:
                        'repeating-linear-gradient(-45deg, transparent, transparent 2px, rgba(0,0,0,0.2) 2px, rgba(0,0,0,0.2) 4px)',
                    }}
                  />
                </div>
              </div>
            )}

            {/* 伤害构成 */}
            {(() => {
              const shieldAbsorb = detail.statuses.reduce((sum, s) => sum + (s.absorb || 0), 0)
              const pctMitigation = Math.max(
                0,
                detail.unmitigatedDamage - detail.finalDamage - shieldAbsorb
              )
              const total = detail.unmitigatedDamage
              const shieldPct = total > 0 ? (shieldAbsorb / total) * 100 : 0
              const pctPct = total > 0 ? (pctMitigation / total) * 100 : 0
              const finalPct = total > 0 ? (detail.finalDamage / total) * 100 : 0
              return (
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">减伤构成</span>
                    <span className="tabular-nums">
                      <span className="font-medium text-red-500">
                        {detail.finalDamage.toLocaleString()}
                      </span>
                      <span className="text-muted-foreground"> / {total.toLocaleString()}</span>
                      <span className="text-muted-foreground ml-1">
                        ({(((total - detail.finalDamage) / total) * 100).toFixed(1)}%)
                      </span>
                    </span>
                  </div>
                  <TooltipProvider>
                    <div className="h-2.5 bg-secondary rounded-full flex overflow-visible">
                      {(() => {
                        const segments = [
                          {
                            pct: finalPct,
                            color: 'rgb(239, 68, 68)',
                            label: `真实伤害 ${detail.finalDamage.toLocaleString()} (${finalPct.toFixed(1)}%)`,
                          },
                          {
                            pct: shieldPct,
                            color: 'rgb(234, 179, 8)',
                            label: `盾值减免 ${shieldAbsorb.toLocaleString()} (${shieldPct.toFixed(1)}%)`,
                          },
                          {
                            pct: pctPct,
                            color: 'rgb(59, 130, 246)',
                            label: `百分比减免 ${pctMitigation.toLocaleString()} (${pctPct.toFixed(1)}%)`,
                          },
                        ].filter(s => s.pct > 0)
                        return segments.map((seg, i) => (
                          <Tooltip key={seg.color} delayDuration={0}>
                            <TooltipTrigger asChild>
                              <div
                                className={`h-full cursor-default ${i === 0 ? 'rounded-l-full' : ''} ${i === segments.length - 1 ? 'rounded-r-full' : ''}`}
                                style={{ width: `${seg.pct}%`, backgroundColor: seg.color }}
                              />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>{seg.label}</p>
                            </TooltipContent>
                          </Tooltip>
                        ))
                      })()}
                    </div>
                  </TooltipProvider>
                </div>
              )
            })()}

            {/* 生效状态 */}
            {activeStatuses.length > 0 &&
              (() => {
                const damageType = event.damageType || 'physical'

                const multiplierStatuses = activeStatuses.filter(
                  s => getStatusById(s.statusId)?.type === 'multiplier'
                )
                const shieldStatuses = activeStatuses.filter(
                  s => getStatusById(s.statusId)?.type === 'absorbed' && (s.absorb || 0) > 0
                )

                const totalPctMitigation = multiplierStatuses.reduce((acc, s) => {
                  const meta = getStatusById(s.statusId)
                  if (!meta) return acc
                  const multiplier =
                    damageType === 'physical'
                      ? meta.performance.physics
                      : damageType === 'magical'
                        ? meta.performance.magic
                        : meta.performance.darkness
                  return acc * multiplier
                }, 1)
                const pctReduction = ((1 - totalPctMitigation) * 100).toFixed(1)

                const totalShield = shieldStatuses.reduce((sum, s) => sum + (s.absorb || 0), 0)
                const shieldEquivPct =
                  detail.unmitigatedDamage > 0
                    ? ((totalShield / detail.unmitigatedDamage) * 100).toFixed(1)
                    : '0.0'

                const renderIcon = (status: (typeof activeStatuses)[0], index: number) => {
                  const meta = getStatusById(status.statusId)
                  const iconUrl = getStatusIconUrl(status.statusId)
                  const statusName = getStatusName(status.statusId) || meta?.name || '未知状态'
                  let mitigationText = ''
                  if (meta?.type === 'multiplier') {
                    const multiplier =
                      damageType === 'physical'
                        ? meta.performance.physics
                        : damageType === 'magical'
                          ? meta.performance.magic
                          : meta.performance.darkness
                    mitigationText = `${((1 - multiplier) * 100).toFixed(1)}%`
                  } else if (meta?.type === 'absorbed') {
                    mitigationText = `盾: ${(status.absorb || 0).toLocaleString()}`
                  }
                  return (
                    <Tooltip key={`${status.statusId}-${index}`} delayDuration={0}>
                      <TooltipTrigger asChild>
                        <div className="cursor-default">
                          {iconUrl && (
                            <img
                              src={iconUrl}
                              alt={statusName}
                              className="w-6 h-6 object-contain"
                            />
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
                              <span className="text-muted-foreground ml-1">
                                (
                                {Math.round(
                                  detail.unmitigatedDamage * (1 - totalPctMitigation)
                                ).toLocaleString()}
                                )
                              </span>
                            </span>
                          </div>
                          <div className="flex flex-wrap0">
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
                          <div className="flex flex-wrap">
                            {shieldStatuses.map((s, i) => renderIcon(s, i))}
                          </div>
                        </div>
                      )}
                    </div>
                  </TooltipProvider>
                )
              })()}
          </div>
        )
      })}
    </div>
  )
}
