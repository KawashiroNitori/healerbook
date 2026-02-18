/**
 * 属性面板组件
 */

import { useTimelineStore } from '@/store/timelineStore'
import { useMitigationStore } from '@/store/mitigationStore'
import { MitigationCalculator } from '@/utils/mitigationCalculator'
import { Trash2 } from 'lucide-react'

const calculator = new MitigationCalculator()

export default function PropertyPanel() {
  const {
    timeline,
    selectedEventId,
    selectedAssignmentId,
    updateDamageEvent,
    removeDamageEvent,
    removeAssignment,
  } = useTimelineStore()
  const { skills } = useMitigationStore()

  if (!timeline) {
    return (
      <div className="w-80 border-l bg-background p-4">
        <p className="text-sm text-muted-foreground">未加载时间轴</p>
      </div>
    )
  }

  // 显示伤害事件属性
  if (selectedEventId) {
    const event = timeline.damageEvents.find((e) => e.id === selectedEventId)
    if (!event) return null

    // 计算该事件的减伤效果
    const eventAssignments = timeline.mitigationAssignments.filter(
      (a) => a.damageEventId === event.id
    )
    const effects = calculator.getActiveEffects(event.time, eventAssignments, skills)
    const result = calculator.calculate(event.damage, effects)

    return (
      <div className="w-80 border-l bg-background flex flex-col h-full">
        {/* Header */}
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="font-semibold">伤害事件</h2>
          <button
            onClick={() => removeDamageEvent(event.id)}
            className="p-1 hover:bg-destructive/10 hover:text-destructive rounded transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>

        {/* Properties */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">事件名称</label>
            <input
              type="text"
              value={event.name}
              onChange={(e) => updateDamageEvent(event.id, { name: e.target.value })}
              className="w-full px-3 py-2 border rounded-md text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">时间 (秒)</label>
            <input
              type="number"
              value={event.time}
              onChange={(e) =>
                updateDamageEvent(event.id, { time: parseFloat(e.target.value) || 0 })
              }
              className="w-full px-3 py-2 border rounded-md text-sm"
              step="0.1"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">原始伤害</label>
            <input
              type="number"
              value={event.damage}
              onChange={(e) =>
                updateDamageEvent(event.id, { damage: parseInt(e.target.value) || 0 })
              }
              className="w-full px-3 py-2 border rounded-md text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">伤害类型</label>
            <select
              value={event.type}
              onChange={(e) =>
                updateDamageEvent(event.id, {
                  type: e.target.value as 'physical' | 'magical' | 'unique',
                })
              }
              className="w-full px-3 py-2 border rounded-md text-sm"
            >
              <option value="physical">物理</option>
              <option value="magical">魔法</option>
              <option value="unique">无属性</option>
            </select>
          </div>

          {/* Mitigation Result */}
          <div className="pt-4 border-t">
            <h3 className="font-medium mb-2">减伤效果</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">原始伤害:</span>
                <span className="font-medium">{result.originalDamage.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">最终伤害:</span>
                <span className="font-medium text-primary">
                  {result.finalDamage.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">减伤比例:</span>
                <span className="font-medium text-green-600">
                  {result.mitigationPercentage.toFixed(1)}%
                </span>
              </div>
            </div>

            {/* Applied Skills */}
            {result.appliedEffects.length > 0 && (
              <div className="mt-4">
                <div className="text-sm font-medium mb-2">已应用技能:</div>
                <div className="space-y-1">
                  {result.appliedEffects.map((effect, index) => {
                    const skill = skills.find((s) => s.id === effect.skillId)
                    return (
                      <div
                        key={index}
                        className="text-xs p-2 bg-muted rounded flex justify-between"
                      >
                        <span>{skill?.name || effect.skillId}</span>
                        <span className="text-muted-foreground">
                          {effect.type === 'shield'
                            ? `${effect.value}`
                            : `${effect.value}%`}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // 显示减伤分配属性
  if (selectedAssignmentId) {
    const assignment = timeline.mitigationAssignments.find((a) => a.id === selectedAssignmentId)
    if (!assignment) return null

    const skill = skills.find((s) => s.id === assignment.skillId)
    const event = timeline.damageEvents.find((e) => e.id === assignment.damageEventId)

    return (
      <div className="w-80 border-l bg-background flex flex-col h-full">
        {/* Header */}
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="font-semibold">减伤分配</h2>
          <button
            onClick={() => removeAssignment(assignment.id)}
            className="p-1 hover:bg-destructive/10 hover:text-destructive rounded transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>

        {/* Properties */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {skill && (
            <>
              <div>
                <label className="block text-sm font-medium mb-1">技能</label>
                <div className="p-3 border rounded-md">
                  <div className="font-medium">{skill.name}</div>
                  <div className="text-xs text-muted-foreground mt-1">{skill.nameEn}</div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">职业</label>
                <div className="text-sm">{assignment.job}</div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">效果</label>
                <div className="text-sm">
                  {skill.type === 'shield'
                    ? `盾值: ${skill.value}`
                    : `减伤: ${skill.value}%`}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">持续时间</label>
                <div className="text-sm">{skill.duration}s</div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">冷却时间</label>
                <div className="text-sm">{skill.cooldown}s</div>
              </div>
            </>
          )}

          {event && (
            <div className="pt-4 border-t">
              <label className="block text-sm font-medium mb-1">目标事件</label>
              <div className="p-3 border rounded-md">
                <div className="font-medium">{event.name}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  时间: {event.time}s | 伤害: {event.damage.toLocaleString()}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  // 默认显示
  return (
    <div className="w-80 border-l bg-background p-4">
      <p className="text-sm text-muted-foreground">选择事件或技能查看属性</p>
    </div>
  )
}
