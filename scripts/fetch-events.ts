/**
 * FFLogs 事件获取脚本
 *
 * 用法：填写下方 REPORT_CODE、FIGHT_ID 和 filter，然后执行：
 *   pnpm tsx scripts/fetch-events.ts
 *
 * 需要先启动开发服务器（pnpm dev）以提供 /api 代理
 */

import type {
  FFLogsV1Report,
  FFLogsEvent,
  FFLogsEventsResponse,
  FFLogsAbility,
} from '../src/types/fflogs'
import { parseDamageEvents, findFirstDamageTimestamp } from '../src/utils/fflogsImporter'

// ==================== 用户参数 ====================

/** 报告代码（从 FFLogs URL 中获取） */
const REPORT_CODE = 'YC2fM9Fgthbx6BG8'

/** 战斗 ID（从 FFLogs URL 的 fight= 参数获取，留空则取最后一场） */
const FIGHT_ID: number | null = 20

/** 事件过滤函数，返回 true 表示保留 */
const filter = (event: FFLogsEvent): boolean => {
  return (
    !['damage', 'heal', 'cast1', 'buff', 'absorb', 'limitbreak', 'gauge', 'tether'].some(k =>
      event.type.includes(k)
    ) && event.targetID === -1
  )
}

// ==================== 以下无需修改 ====================

const BASE_URL = 'http://localhost:5173/api'

async function fetchJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}/${path}`)
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`HTTP ${res.status}: ${body}`)
  }
  return res.json() as Promise<T>
}

async function main() {
  if (!REPORT_CODE) {
    console.error('请填写 REPORT_CODE')
    process.exit(1)
  }

  // 1. 获取报告元数据
  console.error(`获取报告 ${REPORT_CODE} ...`)
  const report = await fetchJSON<FFLogsV1Report>(`fflogs/report/${REPORT_CODE}`)

  // 2. 确定战斗
  const fightId = FIGHT_ID ?? report.fights[report.fights.length - 1]?.id
  const fight = report.fights.find(f => f.id === fightId)
  if (!fight) {
    console.error(`战斗 #${fightId} 不存在，可用战斗：`)
    for (const f of report.fights) {
      console.error(`  #${f.id} ${f.name} (${f.kill ? '击杀' : '未击杀'})`)
    }
    process.exit(1)
  }
  console.error(`战斗 #${fight.id}: ${fight.name} (${fight.start_time} - ${fight.end_time})`)

  // 3. 获取事件
  console.error('获取事件 ...')
  const data = await fetchJSON<FFLogsEventsResponse>(
    `fflogs/events/${REPORT_CODE}?start=${fight.start_time}&end=${fight.end_time}`
  )
  console.error(`共 ${data.events.length} 个事件`)

  // 4. 过滤
  const filtered = data.events.filter(filter)
  console.error(`过滤后 ${filtered.length} 个事件`)
  console.error(JSON.stringify(filtered, null, 2))

  // 5. 输出事件时间线
  const fightStart = fight.start_time
  for (const e of filtered) {
    const t = ((e.timestamp - fightStart) / 1000).toFixed(2)
    const target = e.targetID ?? '?'
    const abilityGameID = e.abilityGameID ?? '?'
    if (e.type === 'applydebuff') {
      console.error(
        `  [${t}s] applydebuff target=${target} abilityGameID=${abilityGameID} duration=${e.duration}ms`
      )
    } else if (e.type === 'damage') {
      console.error(
        `  [${t}s] damage target=${target} abilityGameID=${abilityGameID} amount=${e.amount ?? 0} unmit=${e.unmitigatedAmount ?? 0} mult=${e.multiplier ?? '?'} tick=${e.tick ?? false}`
      )
    } else if (e.type === 'removedebuff') {
      console.error(`  [${t}s] removedebuff target=${target} abilityGameID=${abilityGameID}`)
    } else if (e.type === 'absorbed') {
      console.error(
        `  [${t}s] absorbed target=${target} abilityGameID=${abilityGameID} amount=${e.amount ?? 0}`
      )
    } else {
      console.error(`  [${t}s] ${e.type} target=${target} abilityGameID=${abilityGameID}`)
    }
  }
  console.error('')

  // 6. 构建辅助映射并用 parseDamageEvents 处理
  const playerMap = new Map<number, { id: number; name: string; type: string }>()
  report.friendlies?.forEach(p => {
    playerMap.set(p.id, { id: p.id, name: p.name, type: p.type })
  })

  const abilityMap = new Map<number, FFLogsAbility>()
  report.abilities?.forEach(a => {
    abilityMap.set(a.gameID, a)
  })

  const fightStartTime = findFirstDamageTimestamp(data.events, fight.start_time)
  console.error(`fightStartTime: ${fightStartTime}`)

  const damageEvents = parseDamageEvents(filtered, fightStartTime, playerMap, abilityMap)
  console.error(`解析出 ${damageEvents.length} 个 DamageEvent`)
  console.log(JSON.stringify(damageEvents, null, 2))
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
