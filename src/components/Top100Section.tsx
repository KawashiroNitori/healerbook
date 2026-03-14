/**
 * TOP100 参考方案区块
 *
 * 从 Worker API 获取各副本的 TOP100 治疗排行，展示在首页
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Clock, RefreshCw, ChevronDown, ChevronRight, Server } from 'lucide-react'
import { RAID_TIERS, type RaidEncounter } from '@/data/raidEncounters'
import ImportFFLogsDialog from '@/components/ImportFFLogsDialog'
import JobIcon from '@/components/JobIcon'
import { JOB_MAP } from '@/data/jobMap'
import type { Job } from '@/types/timeline'

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
  mitigationKey: string
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

// ---- 子组件 ----

function EncounterTable({
  encounter,
  data,
  onImport,
}: {
  encounter: RaidEncounter
  data: Top100Data | null | undefined
  onImport: (url: string) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [showAll, setShowAll] = useState(false)

  const hasData = data && data.entries.length > 0
  const displayEntries = showAll ? (data?.entries ?? []) : (data?.entries ?? []).slice(0, 10)
  const hasMore = (data?.entries.length ?? 0) > 10

  return (
    <div className="border rounded-lg overflow-hidden">
      {/* 表头行（点击展开/收起） */}
      <button
        className="w-full flex items-center justify-between px-4 py-3 bg-muted/50 hover:bg-muted transition-colors text-left"
        onClick={() => setIsOpen((v) => !v)}
      >
        <div className="flex items-center gap-3">
          <span className="font-mono font-bold text-sm">{encounter.shortName}</span>
          <span className="text-sm text-muted-foreground">{encounter.name}</span>
          {hasData && (
            <span className="text-xs text-muted-foreground">
              {data.entries.length} 条记录
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          {hasData && (
            <span className="text-xs">
              {new Date(data.updatedAt).toLocaleDateString('zh-CN')} 更新
            </span>
          )}
          {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </div>
      </button>

      {/* 数据表格 */}
      {isOpen && (
        <div>
          {!hasData ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              暂无数据，Cron 任务尚未运行或该副本数据为空
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
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
                    {displayEntries.map((entry) => (
                      <tr key={`${entry.reportCode}-${entry.fightID}-${entry.rank}`} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
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
                                  <Server className="w-3 h-3 inline mr-0.5" />{entry.serverName}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <JobIcon job={JOB_MAP[entry.jobClassTwo] as Job} size="sm" />
                              <span className="font-medium text-sm">{entry.characterNameTwo}</span>
                              {entry.serverNameTwo && (
                                <span className="text-xs text-muted-foreground">
                                  <Server className="w-3 h-3 inline mr-0.5" />{entry.serverNameTwo}
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
                          {formatAmount(entry.amount)}                        </td>
                        <td className="text-right px-3 py-2 font-mono text-muted-foreground align-middle">
                          {formatDuration(entry.duration)}
                        </td>
                        <td className="text-center px-3 py-2 align-middle">
                          <button
                            onClick={() =>
                              onImport(buildFFLogsUrl(entry.reportCode, entry.fightID))
                            }
                            className="text-xs px-2 py-1 rounded border hover:bg-accent transition-colors"
                          >
                            导入
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
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowAll((v) => !v)
                  }}
                >
                  {showAll
                    ? `收起（显示前 10 条）`
                    : `展开全部 ${data.entries.length} 条`}
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

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['top100'],
    queryFn: fetchTop100All,
    staleTime: 5 * 60 * 1000, // 5 分钟前端缓存
    retry: 1,
  })

  const activeTier = RAID_TIERS[activeTierIdx]

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-semibold">TOP100 参考方案</h2>
          <p className="text-sm text-muted-foreground">
            来自 FFLogs 的治疗合计 DPS 前 100 战斗记录，每日自动更新
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground px-3 py-1.5 rounded border hover:bg-accent transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
          刷新
        </button>
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
          <p>加载失败，数据可能尚未同步</p>
          <p className="text-xs mt-1">Cron 任务每日 02:00 UTC 自动运行</p>
        </div>
      ) : (
        <div className="space-y-2">
          {activeTier.encounters.map((encounter) => (
            <EncounterTable
              key={encounter.id}
              encounter={encounter}
              data={data?.[encounter.id]}
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
          onImported={() => setImportUrl(null)}
        />
      )}
    </section>
  )
}
