/**
 * TOP100 参考方案区块
 *
 * 从 Worker API 获取各副本的 TOP100 治疗排行，展示在首页
 */

import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import {
  Clock,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Server,
  Filter,
  Eraser,
  ExternalLink,
  CheckCircle2,
} from 'lucide-react'
import { RAID_TIERS, type RaidEncounter, type RaidTier } from '@/data/raidEncounters'
import { useEncounterTemplate } from '@/hooks/useEncounterTemplate'
import ImportFFLogsDialog from '@/components/ImportFFLogsDialog'
import JobIcon from '@/components/JobIcon'
import { JOB_MAP } from '@/data/jobMap'
import { buildMitigationKey } from '@/utils/rosterUtils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { Job } from '@/types/timeline'
import { track } from '@/utils/analytics'
import { buildFFLogsSourceIndex } from '@/utils/timelineStorage'
import { getTankJobs, getHealerJobs, getDPSJobs, getJobRole, getJobName } from '@/data/jobs'

// ---- 类型定义 ----

interface RankingEntry {
  rank: number
  characterName: string
  jobClass: string
  characterNameTwo: string
  jobClassTwo: string
  amount: number
  duration: number
  reportCode: string
  fightID: number
  startTime: number
  serverName: string
  serverRegion: string
  serverNameTwo: string
  composition: string[]
}

interface Top100Data {
  encounterId: number
  encounterName: string
  entries: RankingEntry[]
  updatedAt: string
}

// ---- API ----

const API_BASE = import.meta.env.VITE_API_BASE_URL?.replace('/fflogs', '') ?? '/api'

async function fetchTop100All(): Promise<Record<string, Top100Data | null>> {
  const res = await fetch(`${API_BASE}/top100`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// ---- 工具函数 ----

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function formatAmount(amount: number): string {
  return amount.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

// 进度条满刻度：20 分钟（超过则进度条封顶不溢出，文字仍显示真实时长）
const PROGRESS_FULL_MS = 20 * 60 * 1000

function formatUpdatedAt(iso: string | null): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function buildFFLogsUrl(reportCode: string, fightID: number): string {
  return `https://www.fflogs.com/reports/${reportCode}#fight=${fightID}`
}

// 检查 subset 是否是 superset 的子序列（两者都已排序）
function isSubsequence(subset: number[], superset: number[]): boolean {
  let i = 0
  let j = 0
  while (i < subset.length && j < superset.length) {
    if (subset[i] === superset[j]) {
      i++
    }
    j++
  }
  return i === subset.length
}

// ---- 子组件 ----

function CompositionFilter({
  selectedJobs,
  onJobsChange,
}: {
  selectedJobs: Job[]
  onJobsChange: (jobs: Job[]) => void
}) {
  const { t } = useTranslation(['home', 'common'])
  const dpsJobs = getDPSJobs()
  const meleeJobs = dpsJobs.filter(job => getJobRole(job) === 'melee')
  const rangedJobs = dpsJobs.filter(job => getJobRole(job) === 'ranged')
  const casterJobs = dpsJobs.filter(job => getJobRole(job) === 'caster')

  const jobsByRole: Record<string, Job[]> = {
    tank: getTankJobs(),
    healer: getHealerJobs(),
    melee: meleeJobs,
    ranged: rangedJobs,
    caster: casterJobs,
  }

  const toggleJob = (job: Job) => {
    if (selectedJobs.includes(job)) {
      onJobsChange(selectedJobs.filter(j => j !== job))
    } else {
      // 限制最多选择 8 个职业
      if (selectedJobs.length >= 8) {
        return
      }
      onJobsChange([...selectedJobs, job])
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold">{t('home:top100.filterTitle')}</h4>
          <p className="text-xs text-muted-foreground">{t('home:top100.filterDescription')}</p>
        </div>
        <div className="flex items-center gap-2">
          {selectedJobs.length > 0 && (
            <>
              <p className="text-xs text-muted-foreground">{selectedJobs.length}/8</p>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => onJobsChange([])}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Eraser className="w-4 h-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{t('home:top100.clear')}</TooltipContent>
              </Tooltip>
            </>
          )}
        </div>
      </div>

      {/* 按职业类型分组 */}
      <div className="space-y-3">
        {Object.entries(jobsByRole).map(([role, jobs]) => (
          <div key={role}>
            <h4 className="text-xs font-medium text-muted-foreground mb-2">
              {t(`home:top100.role.${role}`)}
            </h4>
            <div className="flex flex-wrap gap-2">
              {jobs.map(job => {
                const isSelected = selectedJobs.includes(job)
                const isDisabled = !isSelected && selectedJobs.length >= 8
                return (
                  <Tooltip key={job}>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => toggleJob(job)}
                        disabled={isDisabled}
                        className={`transition-all ${
                          isSelected
                            ? 'opacity-100 scale-100'
                            : isDisabled
                              ? 'opacity-20 cursor-not-allowed'
                              : 'opacity-40 scale-95 hover:opacity-60'
                        }`}
                      >
                        <JobIcon job={job} size="md" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>{getJobName(job)}</TooltipContent>
                  </Tooltip>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function EncounterTable({
  encounter,
  data,
  filterMitigationKey,
  isFiltered,
  importedSources,
  onImport,
  defaultOpen = false,
}: {
  encounter: RaidEncounter
  data: Top100Data | null | undefined
  filterMitigationKey: number[] | null
  isFiltered: boolean
  importedSources: Set<string>
  onImport: (url: string) => void
  /** 选项卡下只有一个榜单时默认展开 */
  defaultOpen?: boolean
}) {
  const { t } = useTranslation(['home', 'common'])
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const [showAll, setShowAll] = useState(false)

  // 应用过滤
  const filteredEntries =
    data?.entries.filter(entry => {
      if (!filterMitigationKey || filterMitigationKey.length === 0) return true
      // 根据 composition 计算 mitigationKey
      const entryMitigationKey = buildMitigationKey(entry.composition)
      return isSubsequence(filterMitigationKey, entryMitigationKey)
    }) ?? []

  const hasData = filteredEntries.length > 0
  const displayEntries = showAll ? filteredEntries : filteredEntries.slice(0, 10)
  const hasMore = filteredEntries.length > 10

  return (
    <div className="border rounded-lg overflow-hidden">
      {/* 表头行（点击展开/收起） */}
      <button
        className="w-full flex items-center justify-between px-4 py-3 bg-muted/50 hover:bg-muted transition-colors text-left"
        onClick={() => {
          if (!isOpen) track('top100-expand', { encounterId: encounter.id })
          setIsOpen(v => !v)
        }}
      >
        <div className="flex items-center gap-3">
          <span className="font-mono font-bold text-sm">{encounter.shortName}</span>
          <span className="text-sm text-muted-foreground">{encounter.name}</span>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </div>
      </button>

      {/* 数据表格 */}
      {isOpen && (
        <div>
          {!hasData ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              {t('home:top100.noData')}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm whitespace-nowrap">
                  <thead>
                    <tr className="border-b bg-muted/20 text-muted-foreground text-xs">
                      <th className="text-right px-3 py-2 w-10">#</th>
                      <th className="text-left px-3 py-2">{t('home:top100.colHealers')}</th>
                      <th className="text-left px-3 py-2">{t('home:top100.colComposition')}</th>
                      <th className="text-right px-3 py-2">{t('home:top100.colTotalRDps')}</th>
                      <th className="text-right px-3 py-2">
                        <Clock className="w-3 h-3 inline mr-1" />
                        {t('home:top100.colDuration')}
                      </th>
                      <th className="text-center px-3 py-2">{t('home:top100.colAction')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayEntries.map(entry => (
                      <tr
                        key={`${entry.reportCode}-${entry.fightID}-${entry.rank}`}
                        className="border-b last:border-0 hover:bg-muted/20 transition-colors"
                      >
                        <td className="text-right px-3 py-2 text-muted-foreground font-mono text-xs align-middle">
                          {entry.rank}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center gap-2">
                                <JobIcon job={JOB_MAP[entry.jobClass] as Job} size="sm" />
                                <span className="font-medium text-sm">{entry.characterName}</span>
                                {entry.serverName && (
                                  <span className="text-xs text-muted-foreground">
                                    <Server className="w-3 h-3 inline mr-0.5" />
                                    {entry.serverName}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <JobIcon job={JOB_MAP[entry.jobClassTwo] as Job} size="sm" />
                                <span className="font-medium text-sm">
                                  {entry.characterNameTwo}
                                </span>
                                {entry.serverNameTwo && (
                                  <span className="text-xs text-muted-foreground">
                                    <Server className="w-3 h-3 inline mr-0.5" />
                                    {entry.serverNameTwo}
                                  </span>
                                )}
                              </div>
                            </div>
                            {importedSources.has(`${entry.reportCode}:${entry.fightID}`) && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                                {t('home:top100.imported')}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 align-middle">
                          {entry.composition.length > 0 ? (
                            <div className="flex gap-0.5">
                              {entry.composition.map((job, index) => (
                                <JobIcon key={`${job}-${index}`} job={job as Job} size="sm" />
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </td>
                        <td className="text-right px-3 py-2 font-mono align-middle">
                          {formatAmount(entry.amount)}{' '}
                        </td>
                        <td className="text-right px-3 py-2 font-mono text-muted-foreground align-middle">
                          {formatDuration(entry.duration)}
                        </td>
                        <td className="text-center px-3 py-2 align-middle">
                          <button
                            onClick={() => {
                              track('top100-import', {
                                encounterId: encounter.id,
                                rank: entry.rank,
                                filtered: isFiltered,
                              })
                              onImport(buildFFLogsUrl(entry.reportCode, entry.fightID))
                            }}
                            className="text-xs px-2 py-1 rounded border hover:bg-accent transition-colors"
                          >
                            {t('home:top100.import')}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* 展开/折叠更多 */}
              {hasMore && (
                <button
                  className="w-full py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/20 transition-colors"
                  onClick={e => {
                    e.stopPropagation()
                    setShowAll(v => !v)
                  }}
                >
                  {showAll
                    ? t('home:top100.collapse')
                    : t('home:top100.expandAll', { count: data?.entries.length ?? 0 })}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// 进度战面板：用于仍在追进度 / 刚通关的绝境战（如绝境战首周）。
// 渲染跑马灯横条 + mogtalk 进度榜单链接 + 后端定时任务获取到的"最长进度/通关时间轴"元信息卡片，
// 并在 TOP100 榜单非空时把通关榜单展示在进度卡片下方。
// 一旦模板来源是击杀（kill），隐藏跑马灯并把时长进度条替换为"已更新完成"。
function ProgressEncounterPanel({
  tier,
  top100Data,
  filterMitigationKey,
  isFiltered,
  importedSources,
  onImport,
}: {
  tier: RaidTier
  top100Data: Record<string, Top100Data | null> | undefined
  filterMitigationKey: number[] | null
  isFiltered: boolean
  importedSources: Set<string>
  onImport: (url: string) => void
}) {
  const { t } = useTranslation(['home', 'common'])
  const encounter = tier.encounters[0]
  const { data, isLoading } = useEncounterTemplate(encounter?.id ?? 0)
  const isKilled = data?.kill === true
  const rankingData = encounter ? top100Data?.[encounter.id] : undefined
  const hasRanking = (rankingData?.entries.length ?? 0) > 0

  return (
    <div className="space-y-4">
      {/* 跑马灯横条（文字无缝循环滚动）。渲染多份铺满容器，位移 -50% 循环无缝。已通关后不再展示 */}
      {!isKilled && (
        <div className="rounded-lg border bg-muted/30 px-4 py-1.5 overflow-hidden whitespace-nowrap">
          <div className="marquee-track">
            {Array.from({ length: 16 }).map((_, i) => (
              <span
                key={i}
                className="text-sm text-muted-foreground inline-flex items-center"
                aria-hidden={i > 0}
              >
                {t('home:top100.marquee')}
                <span className="mx-6 opacity-50">•</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* mogtalk 进度榜单链接 */}
      {tier.mogtalkUrl && (
        <a
          href={tier.mogtalkUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => track('top100-mogtalk', { encounterId: encounter?.id })}
          className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3 hover:bg-accent transition-colors"
        >
          <div>
            <div className="font-medium text-sm">{t('home:top100.mogtalkTitle')}</div>
            <div className="text-xs text-muted-foreground">
              {t('home:top100.mogtalkDescription')}
            </div>
          </div>
          <ExternalLink className="w-4 h-4 text-muted-foreground shrink-0" />
        </a>
      )}

      {/* 进度时间轴元信息卡片：无 template 数据时不展示，加载中显示加载态 */}
      {isLoading && (
        <div className="rounded-lg border px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4 text-muted-foreground" />
            <span className="font-medium text-sm">{t('home:top100.timelineProgress')}</span>
          </div>
          <div className="text-sm text-muted-foreground">{t('home:top100.loading')}</div>
        </div>
      )}
      {/* 已通关：不显示时长进度条，直接显示"已更新完成" */}
      {!isLoading && isKilled && data && (
        <div className="rounded-lg border px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              <span className="font-medium text-sm">{t('home:top100.timelineUpdated')}</span>
            </div>
            <span className="text-xs text-muted-foreground font-mono">
              {t('home:top100.updatedAt', { time: formatUpdatedAt(data.updatedAt) })}
            </span>
          </div>
        </div>
      )}

      {/* 追进度中：显示当前最长进度时长进度条 */}
      {!isLoading && !isKilled && data && data.templateSourceDurationMs != null && (
        <div className="rounded-lg border px-4 py-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <span className="font-medium text-sm">{t('home:top100.timelineProgress')}</span>
            </div>
            <span className="text-xs text-muted-foreground font-mono">
              {t('home:top100.updatedAt', { time: formatUpdatedAt(data.updatedAt) })}
            </span>
          </div>
          <div>
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
              <span>{t('home:top100.duration')}</span>
              <span className="font-mono">{formatDuration(data.templateSourceDurationMs)}</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-cyan-400 to-blue-500 transition-all"
                style={{
                  width: `${Math.min(100, (data.templateSourceDurationMs / PROGRESS_FULL_MS) * 100)}%`,
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* 通关榜单：TOP100 数据非空时展示在进度卡片下方（复用阵容过滤）。仅此一个榜单，默认展开 */}
      {hasRanking && encounter && (
        <EncounterTable
          encounter={encounter}
          data={rankingData}
          filterMitigationKey={filterMitigationKey}
          isFiltered={isFiltered}
          importedSources={importedSources}
          onImport={onImport}
          defaultOpen
        />
      )}
    </div>
  )
}

// ---- 主组件 ----

export default function Top100Section() {
  const { t } = useTranslation(['home', 'common'])
  const [importUrl, setImportUrl] = useState<string | null>(null)
  // 默认最新"已发布"赛季——避免用户打开页面直接落到 comingSoon 占位 Tab。
  const [activeTierIdx, setActiveTierIdx] = useState(() => {
    for (let i = RAID_TIERS.length - 1; i >= 0; i--) {
      if (!RAID_TIERS[i].comingSoon) return i
    }
    return RAID_TIERS.length - 1
  })
  const [refreshTick, setRefreshTick] = useState(0)

  const [importedSources, setImportedSources] = useState<Set<string>>(new Set())
  useEffect(() => {
    let ignore = false
    void buildFFLogsSourceIndex().then(index => {
      if (!ignore) setImportedSources(new Set(index.keys()))
    })
    return () => {
      ignore = true
    }
  }, [refreshTick])

  // 从 LocalStorage 读取已选职业
  const [selectedJobs, setSelectedJobs] = useState<Job[]>(() => {
    try {
      const saved = localStorage.getItem('top100_filter_jobs')
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })

  // 保存到 LocalStorage
  const handleJobsChange = (jobs: Job[]) => {
    if (selectedJobs.length === 0 && jobs.length > 0) {
      track('top100-filter')
    }
    setSelectedJobs(jobs)
    try {
      localStorage.setItem('top100_filter_jobs', JSON.stringify(jobs))
    } catch (error) {
      console.error('Failed to save filter jobs to localStorage:', error)
    }
  }

  const { data, isLoading, isError } = useQuery({
    queryKey: ['top100'],
    queryFn: fetchTop100All,
    staleTime: 5 * 60 * 1000, // 5 分钟前端缓存
    retry: 1,
  })

  const activeTier = RAID_TIERS[activeTierIdx]

  // 计算过滤用的 mitigationKey
  const filterMitigationKey = selectedJobs.length > 0 ? buildMitigationKey(selectedJobs) : null

  return (
    <section>
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-1">
          <h2 className="text-xl font-semibold">{t('home:top100.title')}</h2>
          <TooltipProvider>
            <Popover>
              <Tooltip>
                <TooltipTrigger asChild>
                  <PopoverTrigger asChild>
                    <button
                      className={`flex items-center gap-1.5 text-sm p-1.5 rounded transition-colors ${
                        selectedJobs.length > 0
                          ? 'text-primary bg-primary/10'
                          : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                      }`}
                    >
                      <Filter className="w-4 h-4" />
                      {selectedJobs.length > 0 && (
                        <span className="text-xs">({selectedJobs.length})</span>
                      )}
                    </button>
                  </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent>{t('home:top100.filterTitle')}</TooltipContent>
              </Tooltip>
              <PopoverContent
                align="start"
                className="w-80"
                onOpenAutoFocus={e => e.preventDefault()}
              >
                <CompositionFilter selectedJobs={selectedJobs} onJobsChange={handleJobsChange} />
              </PopoverContent>
            </Popover>
          </TooltipProvider>
        </div>
        <p className="text-sm text-muted-foreground">{t('home:top100.subtitle')}</p>
      </div>

      {/* 赛季 Tab */}
      <div className="flex gap-1 mb-4 border-b">
        {RAID_TIERS.map((tier, idx) => (
          <button
            key={tier.patch}
            onClick={() => setActiveTierIdx(idx)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTierIdx === idx
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tier.patch} {tier.name.split('：')[1]?.split(' ')[0] ?? tier.name}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      {activeTier.comingSoon ? (
        <div className="text-center py-12">
          <span className="rainbow-marquee text-2xl font-bold tracking-wider">
            {t('home:top100.comingSoon')}
          </span>
        </div>
      ) : activeTier.mogtalkUrl ? (
        <ProgressEncounterPanel
          tier={activeTier}
          top100Data={data}
          filterMitigationKey={filterMitigationKey}
          isFiltered={filterMitigationKey !== null}
          importedSources={importedSources}
          onImport={setImportUrl}
        />
      ) : isLoading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
          {t('home:top100.loading')}
        </div>
      ) : isError ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          <p>{t('home:top100.loadFailed')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {activeTier.encounters.map(encounter => (
            <EncounterTable
              key={encounter.id}
              encounter={encounter}
              data={data?.[encounter.id]}
              filterMitigationKey={filterMitigationKey}
              isFiltered={filterMitigationKey !== null}
              importedSources={importedSources}
              onImport={setImportUrl}
              defaultOpen={activeTier.encounters.length === 1}
            />
          ))}
        </div>
      )}

      {/* 导入对话框 */}
      {importUrl && (
        <ImportFFLogsDialog
          open={true}
          initialUrl={importUrl}
          onClose={() => setImportUrl(null)}
          onImported={() => {
            setImportUrl(null)
            setRefreshTick(t => t + 1)
          }}
        />
      )}
    </section>
  )
}
