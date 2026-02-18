/**
 * FFLogs API 客户端使用示例
 */

import { createFFLogsClient } from './fflogsClient'
import { parseDamageEvents, parseComposition, extractReportCode } from '@/utils/fflogsParser'

/**
 * 示例：从 FFLogs 导入时间轴
 */
export async function importTimelineFromFFLogs(
  reportUrl: string,
  fightId: number,
  apiToken: string
) {
  // 1. 提取报告代码
  const reportCode = extractReportCode(reportUrl)
  if (!reportCode) {
    throw new Error('无效的 FFLogs URL')
  }

  // 2. 创建客户端
  const client = createFFLogsClient(apiToken)

  try {
    // 3. 获取报告信息
    const report = await client.getReport(reportCode)
    console.log('报告标题:', report.title)

    // 4. 查找指定战斗
    const fight = report.fights.find(f => f.id === fightId)
    if (!fight) {
      throw new Error(`战斗 ${fightId} 不存在`)
    }

    console.log('战斗名称:', fight.name)
    console.log('是否击杀:', fight.kill)

    // 5. 获取伤害事件
    const rawEvents = await client.getDamageEvents(reportCode, fightId)
    const damageEvents = parseDamageEvents(rawEvents, 'phase_1')
    console.log('伤害事件数量:', damageEvents.length)

    // 6. 获取队伍阵容
    const compositionData = await client.getComposition(reportCode, fightId)
    const composition = parseComposition(compositionData.masterData.actors)
    console.log('队伍阵容:', composition)

    return {
      report,
      fight,
      damageEvents,
      composition,
    }
  } catch (error) {
    console.error('导入失败:', error)
    throw error
  }
}

/**
 * 示例：获取 TOP100 排名
 */
export async function fetchTop100Rankings(encounterId: number, apiToken: string) {
  const client = createFFLogsClient(apiToken)

  try {
    const rankings = await client.getTop100Rankings(encounterId, 100)
    console.log('TOP100 数据:', rankings)
    return rankings
  } catch (error) {
    console.error('获取 TOP100 失败:', error)
    throw error
  }
}
