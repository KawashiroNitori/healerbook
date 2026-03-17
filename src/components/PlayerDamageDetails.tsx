/**
 * 玩家伤害详情组件
 * 在回放模式下展示每个玩家的详细伤害信息
 */

import type { DamageEvent } from '@/types/timeline'
import { getStatusById } from '@/utils/statusRegistry'
import { getStatusIconUrl, getStatusName } from '@/utils/statusIconUtils'
import { getJobName, JOB_METADATA } from '@/data/jobs'
import JobIcon from './JobIcon'

interface PlayerDamageDetailsProps {
  event: DamageEvent
}

export default function PlayerDamageDetails({ event }: PlayerDamageDetailsProps) {
  if (!event.playerDamageDetails || event.playerDamageDetails.length === 0) {
    return <div className="text-sm text-muted-foreground">没有玩家伤害详情数据</div>
  }

  // 按照职业顺序排序玩家伤害详情
  const sortedDetails = [...event.playerDamageDetails].sort((a, b) => {
    const orderA = JOB_METADATA[a.job]?.order ?? 999
    const orderB = JOB_METADATA[b.job]?.order ?? 999
    return orderA - orderB
  })

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">玩家伤害详情</h3>

      {sortedDetails.map(detail => {
        // 直接使用 detail.statuses（来自 PlayerDamageDetail）
        const activeStatuses = detail.statuses || []

        return (
          <div key={detail.playerId} className="border rounded-lg p-3 space-y-2 bg-card">
            {/* 玩家信息 */}
            <div className="flex items-center gap-2">
              <JobIcon job={detail.job} size="sm" />
              <span className="text-sm font-medium">{getJobName(detail.job)}</span>
            </div>

            {/* 伤害信息 */}
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div>
                <div className="text-muted-foreground">原始伤害</div>
                <div className="font-medium">{detail.unmitigatedDamage.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-muted-foreground">盾值抵消</div>
                <div className="font-medium text-blue-600">
                  {detail.statuses
                    .reduce((sum, status) => sum + (status.absorb || 0), 0)
                    .toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">最终伤害</div>
                <div className="font-medium text-red-600">
                  {detail.finalDamage.toLocaleString()}
                </div>
              </div>
            </div>

            {/* 减伤百分比 */}
            {detail.unmitigatedDamage > 0 && (
              <div className="text-xs">
                <span className="text-muted-foreground">减伤率: </span>
                <span className="font-medium text-green-600">
                  {(
                    ((detail.unmitigatedDamage - detail.finalDamage) / detail.unmitigatedDamage) *
                    100
                  ).toFixed(1)}
                  %
                </span>
              </div>
            )}

            {/* 生效状态 */}
            {activeStatuses.length > 0 && (
              <div className="space-y-1">
                <div className="flex flex-wrap gap-1">
                  {activeStatuses.map((status, index) => {
                    const meta = getStatusById(status.statusId)
                    const iconUrl = getStatusIconUrl(status.statusId)
                    const statusName = getStatusName(status.statusId) || meta?.name || '未知状态'

                    // 计算减伤幅度显示文本
                    let mitigationText = ''
                    if (meta) {
                      if (meta.type === 'multiplier') {
                        // 百分比减伤，根据伤害类型选择对应的减伤值
                        let multiplier = 1.0
                        const damageType = event.damageType || 'physical'

                        if (damageType === 'physical') {
                          multiplier = meta.performance.physics
                        } else if (damageType === 'magical') {
                          multiplier = meta.performance.magic
                        } else {
                          multiplier = meta.performance.darkness
                        }

                        const reduction = ((1 - multiplier) * 100).toFixed(1)
                        mitigationText = `${reduction}%`
                      } else if (meta.type === 'absorbed') {
                        // 盾值减伤
                        const absorb = status.absorb || 0
                        mitigationText = `盾: ${absorb.toLocaleString()}`
                      }
                    }

                    return (
                      <div
                        key={`${status.statusId}-${index}`}
                        className="flex items-center gap-1 px-2 py-1 bg-secondary rounded text-xs"
                        title={mitigationText}
                      >
                        {iconUrl && (
                          <img
                            src={iconUrl}
                            alt={mitigationText}
                            className="w-4 h-4 object-contain"
                          />
                        )}
                        <span>{statusName}</span>
                        {status.absorb && status.absorb > 0 && (
                          <span className="text-blue-600 ml-1">
                            ({status.absorb.toLocaleString()})
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
