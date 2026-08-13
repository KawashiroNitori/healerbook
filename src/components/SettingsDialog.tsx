/**
 * 时间轴设置面板
 * 左右两栏：基本（绑定副本 / 等级）、安全血量、技能数值
 *
 * statData 只存储用户覆盖值，未设定的字段留空，
 * placeholder 显示 statistics fallback 值（或硬编码默认值）。
 *
 * 绑定副本与等级是即时生效（直接写 Y.Doc），不受本对话框「保存」按钮管辖——
 * 「保存」只提交 statData 那部分的本地编辑态。
 */

import { useState, useMemo, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { ChevronDown } from 'lucide-react'
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalFooter } from '@/components/ui/modal'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useTimelineStore } from '@/store/timelineStore'
import { useEditorReadOnly } from '@/hooks/useEditorReadOnly'
import { useResolvedActions } from '@/hooks/useResolvedActions'
import { getJobName, sortJobsByOrder, type Job } from '@/data/jobs'
import { RAID_TIERS, getEncounterById } from '@/data/raidEncounters'
import { SUPPORTED_LEVELS, DEFAULT_LEVEL, toLevel, type Level } from '@/types/level'
import JobIcon from '@/components/JobIcon'
import { getFallbackValue, getFallbackMaxHP, getFallbackTankMaxHP } from '@/utils/statDataUtils'
import type { TimelineStatData, StatDataEntry } from '@/types/statData'
import type { MitigationAction } from '@/types/mitigation'
import type { Composition } from '@/types/timeline'
import { GameIcon } from '@/components/GameIcon'

interface SettingsDialogProps {
  open: boolean
  onClose: () => void
}

/**
 * 存量时间轴可能缺 statData（timelineStore.ts 的已知限制，不在本轮修复范围）。
 * 「基本」section（绑定副本 / 等级）与 statData 无关，不应因缺失而无法打开设置——
 * 缺失时用空默认值兜底，「安全血量」「技能数值」两个 section 自然降级为全部显示
 * placeholder（本就是 statData 字段全部留空时的正常渲染路径，无需额外分支）。
 */
const EMPTY_STAT_DATA: TimelineStatData = {
  shieldByAbility: {},
  critShieldByAbility: {},
  healByAbility: {},
  critHealByAbility: {},
}

/** statDataEntry type → 显示标签 */
function getEntryLabel(entry: StatDataEntry, t: TFunction): string {
  const baseLabels: Record<string, string> = {
    shield: t('editor:statData.entryShield'),
    critShield: t('editor:statData.entryCritShield'),
    heal: t('editor:statData.entryHeal'),
    critHeal: t('editor:statData.entryCritHeal'),
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
  const { t } = useTranslation(['editor', 'common'])
  return (
    <div className="flex items-center justify-between py-1.5">
      <div className="flex items-center gap-2">
        <GameIcon
          input={action.iconHD || action.icon}
          alt={action.name}
          className="w-7 h-7 rounded"
        />
        <div>
          <div className="text-sm">{action.name}</div>
          <div className="text-xs text-muted-foreground">{getEntryLabel(entry, t)}</div>
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

interface SettingsDialogInnerProps {
  initialData: TimelineStatData
  composition: Composition
  onSave: (data: TimelineStatData) => void
  onClose: () => void
  isReadOnly: boolean
}

/**
 * section id 的声明顺序即视觉从上到下顺序。抽到组件外做成稳定引用：
 * IntersectionObserver 回调需要按此顺序挑"最靠上的可见 section"，若改用组件内
 * 随每次渲染重建的 SECTIONS（label 依赖 t()），会触发 exhaustive-deps 且无法
 * 安全地放进只跑一次的 useEffect。
 */
const SECTION_IDS = ['basic', 'safeHp', 'actionValues'] as const
type SectionId = (typeof SECTION_IDS)[number]

function SettingsDialogInner({
  initialData,
  composition,
  onSave,
  onClose,
  isReadOnly,
}: SettingsDialogInnerProps) {
  const { t } = useTranslation(['editor', 'common'])
  const statistics = useTimelineStore(state => state.statistics)

  const SECTIONS: { id: SectionId; label: string }[] = [
    { id: 'basic', label: t('editor:settings.navBasic') },
    { id: 'safeHp', label: t('editor:settings.navSafeHp') },
    { id: 'actionValues', label: t('editor:settings.navActionValues') },
  ]

  const level = useTimelineStore(s => s.timeline?.level) ?? DEFAULT_LEVEL
  const encounterId = useTimelineStore(s => s.timeline?.encounter.id) ?? 0
  const setLevel = useTimelineStore(s => s.setLevel)
  const updateEncounter = useTimelineStore(s => s.updateEncounter)

  // 改绑副本：更新副本元信息 + gameZoneId，等级自动跳到新副本的等级
  const handleEncounterChange = (nextId: number) => {
    // 解除绑定：没有副本可供推导，保留用户当前等级不动
    if (nextId === 0) {
      updateEncounter(0)
      return
    }
    const encounter = getEncounterById(nextId)
    if (!encounter) return
    updateEncounter(nextId)
    setLevel(toLevel(encounter.level))
  }

  // 本地编辑态，从 initialData 初始化（组件每次挂载时重新初始化）
  const [localStatData, setLocalStatData] = useState<TimelineStatData>({
    referenceMaxHP: initialData.referenceMaxHP,
    tankReferenceMaxHP: initialData.tankReferenceMaxHP,
    shieldByAbility: { ...initialData.shieldByAbility },
    critShieldByAbility: { ...initialData.critShieldByAbility },
    healByAbility: { ...initialData.healByAbility },
    critHealByAbility: { ...initialData.critHealByAbility },
  })

  const { actions: resolvedActions } = useResolvedActions()

  // 按职业分组的技能列表
  const groupedActions = useMemo(() => {
    if (!composition) return []

    const jobs = new Set(composition.players.map(p => p.job))
    const actionsWithEntries = resolvedActions.filter(
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
  }, [composition, resolvedActions])

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

  const scrollRef = useRef<HTMLDivElement>(null)
  const sectionRefs = useRef<Record<SectionId, HTMLDivElement | null>>({
    basic: null,
    safeHp: null,
    actionValues: null,
  })
  const [activeSection, setActiveSection] = useState<SectionId>('basic')

  // 右侧滚动 → 左侧高亮跟随。
  // IntersectionObserver 回调的 entries 只包含"本次状态发生变化"的 target，不含仍
  // 保持原状态的 section。若直接从 entries 里挑最靠上的可见项，会漏掉"仍在可视带内、
  // 只是没变化因此不在本次 entries 里"的 section——高亮误跳到刚进入可视带的那个，
  // 尽管前者在视觉上更靠上。因此维护一份完整的可见状态映射，每次回调只更新变化项，
  // 再从完整映射里按 SECTIONS 声明顺序（即从上到下的视觉顺序）挑最靠上的可见 section。
  const visibleSectionsRef = useRef<Set<SectionId>>(new Set())
  useEffect(() => {
    const root = scrollRef.current
    if (!root) return
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          const id = entry.target.getAttribute('data-section') as SectionId
          if (entry.isIntersecting) visibleSectionsRef.current.add(id)
          else visibleSectionsRef.current.delete(id)
        }
        const topmost = SECTION_IDS.find(id => visibleSectionsRef.current.has(id))
        if (topmost) setActiveSection(topmost)
      },
      { root, rootMargin: '0px 0px -70% 0px', threshold: 0 }
    )
    for (const el of Object.values(sectionRefs.current)) if (el) observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const jumpTo = (id: SectionId) => {
    sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <>
      <div className="flex-1 flex flex-col sm:flex-row min-h-0 gap-4">
        {/* 左侧大纲：窄屏折成顶部横向 chip 条 */}
        <nav className="flex sm:flex-col gap-1 sm:w-32 shrink-0 overflow-x-auto sm:overflow-x-visible">
          {SECTIONS.map(s => (
            <button
              key={s.id}
              type="button"
              onClick={() => jumpTo(s.id)}
              className={`text-sm text-left whitespace-nowrap px-2 py-1.5 rounded-md transition-colors ${
                activeSection === s.id
                  ? 'bg-accent text-accent-foreground font-medium'
                  : 'text-muted-foreground hover:bg-accent/50'
              }`}
            >
              {s.label}
            </button>
          ))}
        </nav>

        {/* 右侧连续滚动容器 */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-4 px-0.5 min-h-0">
          <div
            ref={el => {
              sectionRefs.current.basic = el
            }}
            data-section="basic"
          >
            <div className="text-sm font-medium mb-1.5">{t('editor:settings.basicTitle')}</div>
            <div className="flex items-center justify-between py-1.5">
              <span className="text-sm text-muted-foreground">
                {t('editor:settings.encounter')}
              </span>
              <Select
                value={String(encounterId)}
                onValueChange={v => handleEncounterChange(Number(v))}
                disabled={isReadOnly}
              >
                <SelectTrigger className="w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">{t('editor:settings.encounterNone')}</SelectItem>
                  {RAID_TIERS.filter(tier => !tier.comingSoon).map(tier => (
                    <SelectGroup key={tier.zone}>
                      <SelectLabel>{tier.name}</SelectLabel>
                      {tier.encounters.map(e => (
                        <SelectItem key={e.id} value={String(e.id)}>
                          {e.shortName} - {e.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <span className="text-sm text-muted-foreground">{t('editor:settings.level')}</span>
              <Select
                value={String(level)}
                onValueChange={v => setLevel(Number(v) as Level)}
                disabled={isReadOnly}
              >
                <SelectTrigger className="w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUPPORTED_LEVELS.map(lv => (
                    <SelectItem key={lv} value={String(lv)}>
                      {lv} {t('editor:settings.levelUnit')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="h-px bg-border" />

          <div
            ref={el => {
              sectionRefs.current.safeHp = el
            }}
            data-section="safeHp"
          >
            {/* 安全血量 */}
            <div className="text-sm font-medium mb-1.5">{t('editor:statData.safeHpTitle')}</div>
            <div className="flex items-center justify-between py-1.5">
              <span className="text-sm text-muted-foreground">
                {t('editor:statData.nonTankMinHp')}
              </span>
              <NumberInput
                value={localStatData.referenceMaxHP}
                placeholder={String(getFallbackMaxHP(statistics))}
                onChange={v => setLocalStatData(prev => ({ ...prev, referenceMaxHP: v }))}
                disabled={isReadOnly}
              />
            </div>
            <div className="flex items-center justify-between py-1.5">
              <span className="text-sm text-muted-foreground">
                {t('editor:statData.tankMinHp')}
              </span>
              <NumberInput
                value={localStatData.tankReferenceMaxHP}
                placeholder={String(getFallbackTankMaxHP(statistics))}
                onChange={v => setLocalStatData(prev => ({ ...prev, tankReferenceMaxHP: v }))}
                disabled={isReadOnly}
              />
            </div>
          </div>

          <div className="h-px bg-border" />

          <div
            ref={el => {
              sectionRefs.current.actionValues = el
            }}
            data-section="actionValues"
          >
            {/* 盾技能数值 */}
            <div className="text-sm font-medium">{t('editor:statData.actionValuesTitle')}</div>

            {groupedActions.length === 0 && (
              <p className="text-sm text-muted-foreground">{t('editor:statData.noActions')}</p>
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
                  {/* 宽度足够时（lg 起，此时对话框已达 max-w-4xl 满宽）技能条目排两列。
                      每个职业分组内各自分列，组与组之间不跨列，避免折叠展开时列高错位。 */}
                  <div className="ml-7 grid grid-cols-1 lg:grid-cols-2 lg:gap-x-8">
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
        </div>
      </div>

      <ModalFooter>
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 border rounded-md hover:bg-accent transition-colors"
        >
          {t('common:cancel')}
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={isReadOnly}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-primary"
        >
          {t('editor:statData.save')}
        </button>
      </ModalFooter>
    </>
  )
}

export default function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const { t } = useTranslation(['editor', 'common'])
  const timeline = useTimelineStore(s => s.timeline)
  const updateStatData = useTimelineStore(s => s.updateStatData)
  const composition = timeline?.composition
  const isReadOnly = useEditorReadOnly()

  return (
    <Modal open={open} onClose={onClose} maxWidth="4xl">
      <ModalContent className="max-h-[80vh] flex flex-col">
        <ModalHeader>
          <ModalTitle>{t('editor:settings.title')}</ModalTitle>
        </ModalHeader>
        {open && composition && (
          <SettingsDialogInner
            key={open ? 'open' : 'closed'}
            initialData={timeline?.statData ?? EMPTY_STAT_DATA}
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
