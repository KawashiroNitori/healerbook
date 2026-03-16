/**
 * 属性面板组件
 */

import { useTimelineStore } from '@/store/timelineStore'
import { useDamageCalculation } from '@/hooks/useDamageCalculation'
import { useEditorReadOnly } from '@/hooks/useEditorReadOnly'
import { getStatusById } from '@/utils/statusRegistry'
import { Trash2 } from 'lucide-react'
import PlayerDamageDetails from './PlayerDamageDetails'

export default function PropertyPanel() {
  const { timeline, selectedEventId, updateDamageEvent, removeDamageEvent } = useTimelineStore()
  const isReadOnly = useEditorReadOnly()

  // 使用新的伤害计算 Hook（基于状态）
  const eventResults = useDamageCalculation(timeline)

  // 只有在选中伤害事件时才显示面板（不响应技能选中）
  if (!timeline || !selectedEventId) {
    return null
  }

  // 显示伤害事件属性
  const event = timeline.damageEvents.find(e => e.id === selectedEventId)
  if (!event) return null

  // 使用预先计算的结果
  const result = eventResults.get(event.id)
  if (!result) return null

  return (
    <div className="w-80 border-l bg-background hidden md:flex flex-col h-full">
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
      <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-custom">
        <div>
          <label className="block text-sm font-medium mb-1">事件名称</label>
          <input
            type="text"
            value={event.name}
            onChange={e => updateDamageEvent(event.id, { name: e.target.value })}
            className="w-full px-3 py-2 border rounded-md text-sm disabled:bg-gray-100 disabled:cursor-not-allowed"
            disabled={isReadOnly}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">时间 (秒)</label>
          <input
            type="number"
            value={event.time}
            onChange={e => updateDamageEvent(event.id, { time: parseFloat(e.target.value) || 0 })}
            className="w-full px-3 py-2 border rounded-md text-sm disabled:bg-gray-100 disabled:cursor-not-allowed"
            step="0.1"
            disabled={isReadOnly}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">原始伤害</label>
          <input
            type="number"
            value={event.damage}
            onChange={e => updateDamageEvent(event.id, { damage: parseInt(e.target.value) || 0 })}
            className="w-full px-3 py-2 border rounded-md text-sm disabled:bg-gray-100 disabled:cursor-not-allowed"
            disabled={isReadOnly}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">伤害类型</label>
          <select
            value={event.damageType || 'physical'}
            onChange={e =>
              updateDamageEvent(event.id, {
                damageType: e.target.value as 'physical' | 'magical' | 'special',
              })
            }
            className="w-full px-3 py-2 border rounded-md text-sm disabled:bg-gray-100 disabled:cursor-not-allowed"
            disabled={isReadOnly}
          >
            <option value="physical">物理</option>
            <option value="magical">魔法</option>
            <option value="special">特殊</option>
          </select>
        </div>

        {/* Mitigation Result (仅编辑模式) */}
        {!timeline.isReplayMode && (
          <div className="pt-4 border-t">
            <h3 className="font-medium mb-2">预估减伤效果</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">原始伤害</span>
                <span className="font-medium">{result.originalDamage.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">最终伤害</span>
                <span className="font-medium text-primary">
                  {result.finalDamage.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">减伤比例</span>
                <span className="font-medium text-green-600">
                  {result.mitigationPercentage.toFixed(1)}%
                </span>
              </div>
            </div>

            {/* Applied Statuses */}
            {result.appliedStatuses && result.appliedStatuses.length > 0 && (
              <div className="mt-4">
                <div className="text-sm font-medium mb-2">已应用状态</div>
                <div className="space-y-1">
                  {result.appliedStatuses.map((status, index) => {
                    const statusMeta = getStatusById(status.statusId)
                    if (!statusMeta) return null

                    // 根据伤害类型显示对应的减伤值
                    let displayValue = ''
                    const damageType = event.damageType || 'physical'

                    if (statusMeta.type === 'multiplier') {
                      // 百分比减伤
                      let multiplier = 1.0
                      if (damageType === 'physical') {
                        multiplier = statusMeta.performance.physics
                      } else if (damageType === 'magical') {
                        multiplier = statusMeta.performance.magic
                      } else {
                        multiplier = statusMeta.performance.darkness
                      }
                      const reduction = ((1 - multiplier) * 100).toFixed(1)
                      displayValue = `${reduction}%`
                    } else if (statusMeta.type === 'absorbed') {
                      // 盾值
                      const remaining = status.remainingBarrier || 0
                      displayValue = `盾: ${remaining.toLocaleString()}`
                    }

                    return (
                      <div
                        key={`${status.statusId}-${index}`}
                        className="text-xs p-2 bg-muted rounded flex justify-between items-center gap-2"
                      >
                        <span className="truncate">{statusMeta.name}</span>
                        <span className="text-muted-foreground whitespace-nowrap text-right">
                          {displayValue}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Player Damage Details (回放模式) */}
        {timeline.isReplayMode && event.playerDamageDetails && result.updatedPartyState && (
          <div className="pt-4 border-t">
            <PlayerDamageDetails event={event} partyState={result.updatedPartyState} />
          </div>
        )}
      </div>
    </div>
  )
}
