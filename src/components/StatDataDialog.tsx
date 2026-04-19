/**
 * 时间轴数值设置模态框
 * 让用户自定义盾技能数值和安全血量
 *
 * statData 只存储用户覆盖值，未设定的字段留空，
 * placeholder 显示 statistics fallback 值（或硬编码默认值）。
 */

import { useState, useMemo } from 'react'
import { ChevronDown } from 'lucide-react'
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalFooter } from '@/components/ui/modal'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { useTimelineStore } from '@/store/timelineStore'
import { useEditorReadOnly } from '@/hooks/useEditorReadOnly'
import { MITIGATION_DATA } from '@/data/mitigationActions'
import { getJobName, sortJobsByOrder, type Job } from '@/data/jobs'
import JobIcon from '@/components/JobIcon'
import { getFallbackValue, getFallbackMaxHP, getFallbackTankMaxHP } from '@/utils/statDataUtils'
import type { TimelineStatData, StatDataEntry } from '@/types/statData'
import type { MitigationAction } from '@/types/mitigation'
import type { Composition } from '@/types/timeline'
import { getIconUrl } from '@/utils/iconUtils'

interface StatDataDialogProps {
  open: boolean
  onClose: () => void
}

/** statDataEntry type → 显示标签 */
function getEntryLabel(entry: StatDataEntry): string {
  const baseLabels: Record<string, string> = {
    shield: '盾量',
    critShield: '暴击盾量',
    heal: '治疗量',
    critHeal: '暴击治疗量',
  }
  const baseLabel = baseLabels[entry.type] ?? entry.type
  return entry.label ? `${baseLabel} (${entry.label})` : baseLabel
}

/** 从 statData 中读取用户覆盖值，不存在返回 undefined */
function getEntryValue(statData: TimelineStatData, entry: StatDataEntry): number | undefined {
  switch (entry.type) {
    case 'shield':
      return entry.key in statData.shieldByAbility ? statData.shieldByAbility[entry.key] : undefined
    case 'critShield':
      return entry.key in statData.critShieldByAbility
        ? statData.critShieldByAbility[entry.key]
        : undefined
    case 'heal':
      return entry.key in statData.healByAbility ? statData.healByAbility[entry.key] : undefined
    case 'critHeal':
      return entry.key in statData.critHealByAbility
        ? statData.critHealByAbility[entry.key]
        : undefined
  }
}

/** 将值写入 statData 的副本。undefined 表示删除（恢复为 fallback） */
function setEntryValue(
  statData: TimelineStatData,
  entry: StatDataEntry,
  value: number | undefined
): TimelineStatData {
  const result = { ...statData }
  switch (entry.type) {
    case 'shield':
      result.shieldByAbility = { ...result.shieldByAbility }
      if (value !== undefined) {
        result.shieldByAbility[entry.key] = value
      } else {
        delete result.shieldByAbility[entry.key]
      }
      break
    case 'critShield':
      result.critShieldByAbility = { ...result.critShieldByAbility }
      if (value !== undefined) {
        result.critShieldByAbility[entry.key] = value
      } else {
        delete result.critShieldByAbility[entry.key]
      }
      break
    case 'heal':
      result.healByAbility = { ...result.healByAbility }
      if (value !== undefined) {
        result.healByAbility[entry.key] = value
      } else {
        delete result.healByAbility[entry.key]
      }
      break
    case 'critHeal':
      result.critHealByAbility = { ...result.critHealByAbility }
      if (value !== undefined) {
        result.critHealByAbility[entry.key] = value
      } else {
        delete result.critHealByAbility[entry.key]
      }
      break
  }
  return result
}

/** 数值输入组件，支持空值和 placeholder */
function NumberInput({
  value,
  placeholder,
  onChange,
  disabled = false,
}: {
  value: number | undefined
  placeholder: string
  onChange: (value: number | undefined) => void
  disabled?: boolean
}) {
  const [text, setText] = useState(value != null ? String(value) : '')
  const [focused, setFocused] = useState(false)
  const displayValue = value != null ? String(value) : ''

  // 外部 value 变化时同步 text（不在聚焦编辑时覆盖）
  if (!focused && text !== displayValue) {
    setText(displayValue)
  }

  const handleBlur = () => {
    const trimmed = text.trim()
    if (trimmed === '') {
      // 清空 → 删除用户覆盖值
      onChange(undefined)
      return
    }
    const num = parseInt(trimmed, 10)
    if (!isNaN(num) && num >= 0) {
      onChange(num)
      setText(String(num))
    } else {
      // 无效输入 → 恢复
      setText(value != null ? String(value) : '')
    }
  }

  return (
    <input
      type="text"
      value={text}
      placeholder={placeholder}
      disabled={disabled}
      onChange={e => setText(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false)
        handleBlur()
      }}
      onKeyDown={e => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
      className="w-28 px-2 py-1 text-right text-sm tabular-nums border border-border rounded-md bg-background placeholder:text-muted-foreground/50 disabled:cursor-not-allowed disabled:opacity-60"
    />
  )
}

/** 单个技能条目行 */
function ActionEntryRow({
  action,
  entry,
  value,
  placeholder,
  onChange,
  disabled = false,
}: {
  action: MitigationAction
  entry: StatDataEntry
  value: number | undefined
  placeholder: string
  onChange: (value: number | undefined) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <div className="flex items-center gap-2">
        <img
          src={getIconUrl(action.iconHD || action.icon)}
          alt={action.name}
          className="w-7 h-7 rounded"
        />
        <div>
          <div className="text-sm">{action.name}</div>
          <div className="text-xs text-muted-foreground">{getEntryLabel(entry)}</div>
        </div>
      </div>
      <NumberInput
        value={value}
        placeholder={placeholder}
        onChange={onChange}
        disabled={disabled}
      />
    </div>
  )
}

interface StatDataDialogInnerProps {
  initialData: TimelineStatData
  composition: Composition
  onSave: (data: TimelineStatData) => void
  onClose: () => void
  isReadOnly: boolean
}

function StatDataDialogInner({
  initialData,
  composition,
  onSave,
  onClose,
  isReadOnly,
}: StatDataDialogInnerProps) {
  const statistics = useTimelineStore(state => state.statistics)

  // 本地编辑态，从 initialData 初始化（组件每次挂载时重新初始化）
  const [localStatData, setLocalStatData] = useState<TimelineStatData>({
    referenceMaxHP: initialData.referenceMaxHP,
    tankReferenceMaxHP: initialData.tankReferenceMaxHP,
    shieldByAbility: { ...initialData.shieldByAbility },
    critShieldByAbility: { ...initialData.critShieldByAbility },
    healByAbility: { ...initialData.healByAbility },
    critHealByAbility: { ...initialData.critHealByAbility },
  })

  // 按职业分组的技能列表
  const groupedActions = useMemo(() => {
    if (!composition) return []

    const jobs = new Set(composition.players.map(p => p.job))
    const actionsWithEntries = MITIGATION_DATA.actions.filter(
      a => a.statDataEntries && a.statDataEntries.length > 0 && a.jobs.some(j => jobs.has(j))
    )

    // 按职业分组
    const groups = new Map<Job, { action: MitigationAction; entry: StatDataEntry }[]>()
    for (const action of actionsWithEntries) {
      const job = action.jobs.find(j => jobs.has(j))
      if (!job) continue
      if (!groups.has(job)) groups.set(job, [])
      for (const entry of action.statDataEntries!) {
        groups.get(job)!.push({ action, entry })
      }
    }

    const sortedJobs = sortJobsByOrder([...groups.keys()])
    return sortedJobs.map(job => ({
      job,
      entries: groups.get(job)!,
    }))
  }, [composition])

  // 折叠状态 — 默认全部展开
  const [collapsedJobs, setCollapsedJobs] = useState<Set<Job>>(new Set())
  const toggleCollapse = (job: Job) => {
    setCollapsedJobs(prev => {
      const next = new Set(prev)
      if (next.has(job)) next.delete(job)
      else next.add(job)
      return next
    })
  }

  const handleSave = () => {
    onSave(localStatData)
    onClose()
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto space-y-4 px-0.5">
        {/* 安全血量 */}
        <div>
          <div className="text-sm font-medium mb-1.5">安全血量</div>
          <div className="flex items-center justify-between py-1.5">
            <span className="text-sm text-muted-foreground">非坦职业最低 HP</span>
            <NumberInput
              value={localStatData.referenceMaxHP}
              placeholder={String(getFallbackMaxHP(statistics))}
              onChange={v => setLocalStatData(prev => ({ ...prev, referenceMaxHP: v }))}
              disabled={isReadOnly}
            />
          </div>
          <div className="flex items-center justify-between py-1.5">
            <span className="text-sm text-muted-foreground">坦克职业最低 HP</span>
            <NumberInput
              value={localStatData.tankReferenceMaxHP}
              placeholder={String(getFallbackTankMaxHP(statistics))}
              onChange={v => setLocalStatData(prev => ({ ...prev, tankReferenceMaxHP: v }))}
              disabled={isReadOnly}
            />
          </div>
        </div>

        <div className="h-px bg-border" />

        {/* 盾技能数值 */}
        <div className="text-sm font-medium">技能数值</div>

        {groupedActions.length === 0 && (
          <p className="text-sm text-muted-foreground">当前阵容中没有需要指定数值的技能</p>
        )}

        {groupedActions.map(({ job, entries }) => (
          <Collapsible
            key={job}
            open={!collapsedJobs.has(job)}
            onOpenChange={() => toggleCollapse(job)}
          >
            <CollapsibleTrigger className="flex items-center gap-2 w-full py-1 hover:bg-accent rounded-md px-1 -mx-1">
              <ChevronDown
                className={`w-4 h-4 transition-transform ${collapsedJobs.has(job) ? '-rotate-90' : ''}`}
              />
              <JobIcon job={job} size="sm" />
              <span className="text-sm font-medium">{getJobName(job)}</span>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="ml-7">
                {entries.map(({ action, entry }) => (
                  <ActionEntryRow
                    key={`${action.id}-${entry.type}-${entry.key}`}
                    action={action}
                    entry={entry}
                    value={getEntryValue(localStatData, entry)}
                    placeholder={String(getFallbackValue(statistics, entry.type, entry.key))}
                    onChange={v => setLocalStatData(prev => setEntryValue(prev, entry, v))}
                    disabled={isReadOnly}
                  />
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        ))}
      </div>

      <ModalFooter>
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 border rounded-md hover:bg-accent transition-colors"
        >
          取消
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={isReadOnly}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-primary"
        >
          保存
        </button>
      </ModalFooter>
    </>
  )
}

export default function StatDataDialog({ open, onClose }: StatDataDialogProps) {
  const { timeline, updateStatData } = useTimelineStore()
  const statData = timeline?.statData
  const composition = timeline?.composition
  const isReadOnly = useEditorReadOnly()

  return (
    <Modal open={open} onClose={onClose}>
      <ModalContent className="max-h-[80vh] flex flex-col">
        <ModalHeader>
          <ModalTitle>数值设置</ModalTitle>
        </ModalHeader>
        {open && statData && composition && (
          <StatDataDialogInner
            key={open ? 'open' : 'closed'}
            initialData={statData}
            composition={composition}
            onSave={updateStatData}
            onClose={onClose}
            isReadOnly={isReadOnly}
          />
        )}
      </ModalContent>
    </Modal>
  )
}
