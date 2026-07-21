/**
 * FFLogs 前端直连导入（仅开发环境 ?client_import=1）。
 * 自 ImportFFLogsDialog 下沉：生产构建 import.meta.env.DEV 常量折叠为 false，
 * 本函数体成为死代码，内部两个 dynamic import 站点一并被 DCE，
 * fflogsClient / fflogsImporter 不进生产 bundle。
 */
import type { Timeline } from '@/types/timeline'
import type { TFunc } from '@/api/parseApiError'
import { createNewTimeline } from '@/utils/timelineStorage'

export interface ClientImportInput {
  reportCode: string
  fightId: number | null
  isLastFight: boolean
  /** 导入来源 URL，写进 description */
  sourceUrl: string
  onStep: (step: string) => void
  /** 由组件传入：本模块在 React 树外，文案经 t 本地化 */
  t: TFunc
}

export async function runClientFFLogsImport(input: ClientImportInput): Promise<Timeline> {
  if (!import.meta.env.DEV) throw new Error('client import is dev-only')

  // 仅在此处异步加载，生产 bundle 不引这两条链路
  const [{ createFFLogsClient }, importer] = await Promise.all([
    import('@/api/fflogsClient'),
    import('@/utils/fflogsImporter'),
  ])
  const { parseFightImport, resolveImportTimelineName } = importer

  // 获取报告数据
  const client = createFFLogsClient()
  const report = await client.getReport(input.reportCode)

  // 确定战斗 ID
  let fightId = input.fightId
  if (input.isLastFight) {
    // 获取最后一个战斗
    if (!report.fights || report.fights.length === 0) {
      throw new Error(input.t('import:importFflogs.noFightsInReport'))
    }
    fightId = report.fights[report.fights.length - 1].id
  }

  // 查找指定的战斗
  const fight = report.fights?.find(f => f.id === fightId)
  if (!fight) {
    throw new Error(input.t('import:importFflogs.fightNotFound', { fightId }))
  }

  // 创建时间轴名称（优先从 raidEncounters.ts 查询副本名称）
  const timelineName = resolveImportTimelineName(fight)

  // 创建新时间轴
  const newTimeline = createNewTimeline(fight.encounterID?.toString() || '0', timelineName)

  // 更新战斗信息
  newTimeline.encounter = {
    id: fight.encounterID || 0,
    name: fight.name,
    displayName: fight.name,
    zone: report.title || '',
    damageEvents: [],
  }

  // 写入 gameZoneId（仅当 FFLogs 返回该字段时）
  if (fight.gameZoneId != null) {
    newTimeline.gameZoneId = fight.gameZoneId
  }

  // 获取伤害事件（自动分页）
  input.onStep(input.t('import:importFflogs.stepFetchingEvents'))

  try {
    const eventsData = await client.getAllEvents(input.reportCode, {
      start: fight.startTime,
      end: fight.endTime,
      lang: report.lang,
    })

    input.onStep(input.t('import:importFflogs.stepParsingData'))

    // 与服务端 /import 共用同一套解析编排
    const { composition, damageEvents, castEvents, syncEvents } = parseFightImport(
      report,
      fight,
      eventsData.events || []
    )
    newTimeline.composition = composition
    newTimeline.damageEvents = damageEvents
    newTimeline.castEvents = castEvents
    newTimeline.syncEvents = syncEvents

    // 设置为回放模式
    newTimeline.isReplayMode = true

    // 预填 description：记录导入来源
    newTimeline.description = input.t('import:importFflogs.importedFrom', { url: input.sourceUrl })

    // 记录 FFLogs 来源（input.reportCode 已在 handleSubmit 开头验证非 null）
    newTimeline.fflogsSource = {
      reportCode: input.reportCode,
      fightId: fightId!,
    }
  } catch (eventError) {
    console.error('Failed to fetch events:', eventError)
    throw eventError
  }

  return newTimeline
}
