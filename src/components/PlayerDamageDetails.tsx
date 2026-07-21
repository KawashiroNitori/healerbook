/**
 * 玩家伤害详情组件
 * 在回放模式下展示每个玩家的详细伤害信息
 */

import { useTranslation } from 'react-i18next'
import type { DamageEvent } from '@/types/timeline'
import { getStatusById, getMultiplierForDamageType } from '@/utils/statusRegistry'
import { getStatusIconUrl, getStatusName } from '@/utils/statusIconUtils'
import { getJobName, sortJobsByOrder } from '@/data/jobs'
import JobIcon from './JobIcon'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

interface PlayerDamageDetailsProps {
  event: DamageEvent
}

export default function PlayerDamageDetails({ event }: PlayerDamageDetailsProps) {
  const { t } = useTranslation(['editor', 'common'])

  if (!event.playerDamageDetails || event.playerDamageDetails.length === 0) {
    return <div className="text-sm text-muted-foreground">{t('editor:playerDamage.noData')}</div>
  }

  // 按照职业顺序排序玩家伤害详情
  const sortedDetails = sortJobsByOrder(event.playerDamageDetails, d => d.job)

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">{t('editor:playerDamage.title')}</h3>

      {sortedDetails.map((detail, i) => {
        // 直接使用 detail.statuses（来自 PlayerDamageDetail）
        const activeStatuses = detail.statuses || []

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
          <div key={`${detail.playerId}-${i}`} className="border rounded-lg p-3 space-y-2 bg-card">
            {/* 玩家信息 */}
            <div className="flex items-center gap-2">
              <JobIcon job={detail.job} size="sm" />
              <span className="text-sm font-medium">{getJobName(detail.job)}</span>
              {(detail.overkill ?? 0) > 0 && !detail.statuses.some(s => s.statusId === 810) && (
                <span className="ml-auto text-xs text-gray-500 font-medium">
                  {t('editor:playerDamage.death')}
                </span>
              )}
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
              const overkill = detail.overkill || 0
              const pctMitigation = Math.max(
                0,
                detail.unmitigatedDamage - detail.finalDamage - overkill - shieldAbsorb
              )
              const total = detail.unmitigatedDamage
              const shieldPct = total > 0 ? (shieldAbsorb / total) * 100 : 0
              const multiplierPct = total > 0 ? (pctMitigation / total) * 100 : 0
              const finalPct = total > 0 ? (detail.finalDamage / total) * 100 : 0
              const overkillPct = total > 0 ? (overkill / total) * 100 : 0
              return (
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">
                      {t('editor:playerDamage.mitigationBreakdown')}
                    </span>
                    <span className="tabular-nums">
                      <span className="font-medium text-red-500">
                        {detail.finalDamage.toLocaleString()}
                      </span>
                      <span className="text-muted-foreground"> / {total.toLocaleString()}</span>
                      {total > 0 && (
                        <span className="text-muted-foreground ml-1">
                          ({(((total - detail.finalDamage) / total) * 100).toFixed(1)}%)
                        </span>
                      )}
                    </span>
                  </div>
                  <TooltipProvider>
                    <div className="h-2.5 bg-secondary rounded-full flex overflow-visible">
                      {(() => {
                        const segments = [
                          ...(overkill > 0
                            ? [
                                {
                                  pct: overkillPct,
                                  color: 'rgb(55, 55, 55)',
                                  label: t('editor:playerDamage.overkillSegment', {
                                    value: overkill.toLocaleString(),
                                    pct: overkillPct.toFixed(1),
                                  }),
                                },
                              ]
                            : []),
                          {
                            pct: finalPct,
                            color: 'rgb(239, 68, 68)',
                            label: t('editor:playerDamage.realDamageSegment', {
                              value: detail.finalDamage.toLocaleString(),
                              pct: finalPct.toFixed(1),
                            }),
                          },
                          {
                            pct: shieldPct,
                            color: 'rgb(234, 179, 8)',
                            label: t('editor:playerDamage.shieldSegment', {
                              value: shieldAbsorb.toLocaleString(),
                              pct: shieldPct.toFixed(1),
                            }),
                          },
                          {
                            pct: multiplierPct,
                            color: 'rgb(59, 130, 246)',
                            label: t('editor:playerDamage.percentSegment', {
                              value: pctMitigation.toLocaleString(),
                              pct: multiplierPct.toFixed(1),
                            }),
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
                  // detail.statuses 是 StatusSnapshot（FFLogs 回放数据），不带 performance 快照字段，
                  // 与 MitigationStatus（编辑模式计算结果）不同，故此处无 snapshot 优先的口径可修
                  const multiplier = getMultiplierForDamageType(meta.performance, damageType)
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
                  const statusName =
                    getStatusName(status.statusId) ||
                    meta?.name ||
                    t('editor:playerDamage.unknownStatus')
                  let mitigationText = ''
                  if (meta?.type === 'multiplier') {
                    // status 是 StatusSnapshot，不带 performance 快照字段，见上方 totalPctMitigation 注释
                    const multiplier = getMultiplierForDamageType(meta.performance, damageType)
                    mitigationText = `${((1 - multiplier) * 100).toFixed(1)}%`
                  } else if (meta?.type === 'absorbed') {
                    mitigationText = t('editor:playerDamage.shieldTooltip', {
                      value: (status.absorb || 0).toLocaleString(),
                    })
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
                            <span className="text-muted-foreground">
                              {t('editor:playerDamage.percentLabel')}
                            </span>
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
                            <span className="text-muted-foreground">
                              {t('editor:playerDamage.shieldLabel')}
                            </span>
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
