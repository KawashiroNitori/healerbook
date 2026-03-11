/**
 * TOP100 数据同步模块
 *
 * 通过 FFLogs V2 API 获取每个副本治疗 HPS 前 100 的战斗记录，存入 Cloudflare KV
 *
 * KV 键格式：top100:encounter:{encounterId}
 */

import { FFLogsClientV2, type RankingEntry } from './fflogsClientV2'
import { ALL_ENCOUNTERS, type RaidEncounter } from '../src/data/raidEncounters'

/** KV 中存储的 TOP100 数据结构 */
export interface Top100Data {
  encounterId: number
  encounterName: string
  entries: RankingEntry[]
  /** ISO 8601 时间戳 */
  updatedAt: string
}

/** 获取 KV 键名 */
export function getTop100KVKey(encounterId: number): string {
  return `top100:encounter:${encounterId}`
}

/**
 * 为单个遭遇战同步 TOP100 数据到 KV
 */
async function syncEncounter(
  encounter: RaidEncounter,
  client: FFLogsClientV2,
  kv: KVNamespace
): Promise<void> {
  console.log(`[TOP100] 同步遭遇战: ${encounter.shortName} (id=${encounter.id})`)

  const result = await client.getEncounterRankings({
    encounterId: encounter.id,
    difficulty: encounter.difficulty,
    page: 1,
  })

  const data: Top100Data = {
    encounterId: encounter.id,
    encounterName: result.encounterName || encounter.name,
    entries: result.entries,
    updatedAt: new Date().toISOString(),
  }

  // 存入 KV，缓存 25 小时（比 Cron 间隔略长，避免短暂空窗）
  await kv.put(getTop100KVKey(encounter.id), JSON.stringify(data), {
    expirationTtl: 25 * 60 * 60,
  })

  console.log(`[TOP100] ${encounter.shortName}: 已同步 ${result.entries.length} 条记录`)
}

/**
 * 同步所有副本的 TOP100 数据
 * 串行执行以避免触发 FFLogs API 限流
 */
export async function syncAllTop100(
  client: FFLogsClientV2,
  kv: KVNamespace
): Promise<{ success: number; failed: number; errors: string[] }> {
  let success = 0
  let failed = 0
  const errors: string[] = []

  for (const encounter of ALL_ENCOUNTERS) {
    try {
      await syncEncounter(encounter, client, kv)
      success++
      // 每次请求后短暂等待，尊重 FFLogs API 限流策略
      await new Promise((resolve) => setTimeout(resolve, 500))
    } catch (err) {
      failed++
      const msg = `${encounter.shortName}: ${err instanceof Error ? err.message : String(err)}`
      errors.push(msg)
      console.error(`[TOP100] 同步失败 - ${msg}`)
    }
  }

  return { success, failed, errors }
}
