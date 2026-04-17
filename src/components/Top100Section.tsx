/**
 * TOP100 参考方案区块
 *
 * 从 Worker API 获取各副本的 TOP100 治疗排行，展示在首页
 */

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Clock, RefreshCw, ChevronDown, ChevronRight, Server, Filter, Eraser } from 'lucide-react'
import { RAID_TIERS, type RaidEncounter } from '@/data/raidEncounters'
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
  const dpsJobs = getDPSJobs()
  const meleeJobs = dpsJobs.filter(job => getJobRole(job) === 'melee')
  const rangedJobs = dpsJobs.filter(job => getJobRole(job) === 'ranged')
  const casterJobs = dpsJobs.filter(job => getJobRole(job) === 'caster')

  const jobsByRole = {
    坦克: getTankJobs(),
    治疗: getHealerJobs(),
    近战: meleeJobs,
    远敏: rangedJobs,
    法系: casterJobs,
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
          <h4 className="text-sm font-semibold">阵容过滤</h4>
          <p className="text-xs text-muted-foreground">只看你们小队有的减伤</p>
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
                <TooltipContent>清空</TooltipContent>
              </Tooltip>
            </>
          )}
        </div>
      </div>

      {/* 按职业类型分组 */}
      <div className="space-y-3">
        {Object.entries(jobsByRole).map(([role, jobs]) => (
          <div key={role}>
            <h4 className="text-xs font-medium text-muted-foreground mb-2">{role}</h4>
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
}: {
  encounter: RaidEncounter
  data: Top100Data | null | undefined
  filterMitigationKey: number[] | null
  isFiltered: boolean
  importedSources: Set<string>
  onImport: (url: string) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
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
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">暂无数据</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm whitespace-nowrap">
                  <thead>
                    <tr className="border-b bg-muted/20 text-muted-foreground text-xs">
                      <th className="text-right px-3 py-2 w-10">#</th>
                      <th className="text-left px-3 py-2">治疗组合</th>
                      <th className="text-left px-3 py-2">阵容</th>
                      <th className="text-right px-3 py-2">合计 rDPS</th>
                      <th className="text-right px-3 py-2">
                        <Clock className="w-3 h-3 inline mr-1" />
                        时长
                      </th>
                      <th className="text-center px-3 py-2">操作</th>
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
                              <span className="font-medium text-sm">{entry.characterNameTwo}</span>
                              {entry.serverNameTwo && (
                                <span className="text-xs text-muted-foreground">
                                  <Server className="w-3 h-3 inline mr-0.5" />
                                  {entry.serverNameTwo}
                                </span>
                              )}
                            </div>
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
                          <div className="inline-flex items-center gap-2">
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
                              导入
                            </button>
                            {importedSources.has(`${entry.reportCode}:${entry.fightID}`) && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                                已导入
                              </span>
                            )}
                          </div>
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
                  {showAll ? `收起（显示前 10 条）` : `展开全部 ${data?.entries.length ?? 0} 条`}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ---- 主组件 ----

export default function Top100Section() {
  const [importUrl, setImportUrl] = useState<string | null>(null)
  const [activeTierIdx, setActiveTierIdx] = useState(RAID_TIERS.length - 1) // 默认最新赛季
  const [refreshTick, setRefreshTick] = useState(0)

  const importedSources = useMemo(() => {
    void refreshTick // 作为重建信号：bump 即失效
    return new Set(buildFFLogsSourceIndex().keys())
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
          <h2 className="text-xl font-semibold">TOP100 参考方案</h2>
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
                <TooltipContent>阵容过滤</TooltipContent>
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
        <p className="text-sm text-muted-foreground">拿不定主意？看看别人怎么做的</p>
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
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
          加载中...
        </div>
      ) : isError ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          <p>加载失败</p>
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
