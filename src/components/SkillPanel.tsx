/**
 * 技能面板组件
 */

import { useEffect } from 'react'
import { useMitigationStore } from '@/store/mitigationStore'
import type { Job } from '@/types/timeline'

export default function SkillPanel() {
  const { skills, loadSkills, filters, setJobFilter, getFilteredSkills } = useMitigationStore()

  useEffect(() => {
    if (skills.length === 0) {
      loadSkills()
    }
  }, [skills.length, loadSkills])

  const filteredSkills = getFilteredSkills()

  const jobGroups: Job[] = ['WHM', 'SCH', 'AST', 'SGE', 'PLD', 'WAR', 'DRK', 'GNB']

  const handleJobToggle = (job: Job) => {
    const newJobs = filters.jobs.includes(job)
      ? filters.jobs.filter((j) => j !== job)
      : [...filters.jobs, job]
    setJobFilter(newJobs)
  }

  return (
    <div className="w-64 border-r bg-background flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b">
        <h2 className="font-semibold">减伤技能</h2>
        <p className="text-xs text-muted-foreground mt-1">拖拽到时间轴分配</p>
      </div>

      {/* Filters */}
      <div className="p-4 border-b">
        <div className="text-sm font-medium mb-2">职业筛选</div>
        <div className="flex flex-wrap gap-1">
          {jobGroups.map((job) => (
            <button
              key={job}
              onClick={() => handleJobToggle(job)}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                filters.jobs.includes(job)
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted hover:bg-muted/80'
              }`}
            >
              {job}
            </button>
          ))}
        </div>
      </div>

      {/* Skills List */}
      <div className="flex-1 overflow-y-auto p-4">
        {filteredSkills.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            {filters.jobs.length > 0 ? '无匹配技能' : '选择职业查看技能'}
          </p>
        ) : (
          <div className="space-y-2">
            {filteredSkills.map((skill) => (
              <div
                key={skill.id}
                className="p-3 border rounded-lg hover:border-primary cursor-move transition-colors"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('skillId', skill.id)
                }}
              >
                <div className="flex items-start gap-2">
                  {/* Icon placeholder */}
                  <div className="w-8 h-8 bg-muted rounded flex-shrink-0" />

                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{skill.name}</div>
                    <div className="text-xs text-muted-foreground">{skill.job}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {skill.type === 'shield'
                        ? `盾值: ${skill.value}`
                        : `减伤: ${skill.value}%`}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      CD: {skill.cooldown}s | 持续: {skill.duration}s
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
