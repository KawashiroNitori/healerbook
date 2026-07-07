/**
 * FFLogs 导入：从 boss begincast/cast 配对推导伤害事件读条窗口
 */

import type { DamageEvent } from '@/types/timeline'
import type { FFLogsEvent, PlayerMap } from '@/types/fflogs'

/** 把 abilityGameID 解析为技能名（与导入侧伤害事件命名同源）；无法解析返回 undefined。 */
type NameResolver = (abilityGameID: number) => string | undefined

/** 名称兜底匹配的最大回溯窗口（ms）：防止把伤害误配到很久以前的同名咏唱。可调。 */
const NAME_FALLBACK_MAX_LOOKBACK_MS = 5_000

/** 占位 / 空名不参与名称匹配，避免一批未知技能互相误配。 */
function isRealName(name: string | undefined): name is string {
  return !!name && name !== '未知技能' && !/^unknown_/i.test(name)
}

/** 提取 boss/NPC 的 begincast/cast（排除玩家施法），保持原事件顺序（FFLogs 已时间升序）。 */
export function extractBossCasts(events: FFLogsEvent[], playerMap: PlayerMap): FFLogsEvent[] {
  const out: FFLogsEvent[] = []
  for (const ev of events) {
    if (ev.type !== 'begincast' && ev.type !== 'cast') continue
    if (!ev.abilityGameID) continue
    if (ev.sourceID != null && playerMap.has(ev.sourceID)) continue
    out.push(ev)
  }
  return out
}

interface CastPair {
  startMs: number
  endMs: number
}

interface CastPairIndex {
  /** 按咏唱技能 id 索引（精确层） */
  byId: Map<number, CastPair[]>
  /** 按咏唱技能名索引（兜底层，仅收录可解析的真实名） */
  byName: Map<string, CastPair[]>
}

/**
 * 按 (sourceID, abilityGameID) 分流配对 begincast→cast；含 duration 合理性校验。
 * 同时按咏唱技能名建立兜底索引，处理「读条 id ≠ 伤害 id 但同名」的 boss 技能。
 */
function buildCastPairs(bossCasts: FFLogsEvent[], resolveName?: NameResolver): CastPairIndex {
  const byId = new Map<number, CastPair[]>()
  const byName = new Map<string, CastPair[]>()
  const pending = new Map<string, { startMs: number; durationMs: number }>()
  for (const ev of bossCasts) {
    const id = ev.abilityGameID!
    const pk = `${ev.sourceID ?? 0}:${id}`
    if (ev.type === 'begincast') {
      pending.set(pk, { startMs: ev.timestamp, durationMs: ev.duration ?? 0 })
    } else {
      const begin = pending.get(pk)
      if (begin === undefined) continue // 瞬发：无 pending
      pending.delete(pk)
      // 中断悬挂的 begincast 被之后瞬发 cast 误消费时，窗口会远超预期读条时长 → 丢弃
      if (begin.durationMs && ev.timestamp - begin.startMs > begin.durationMs * 1.5 + 1000) continue
      const pair: CastPair = { startMs: begin.startMs, endMs: ev.timestamp }
      let arr = byId.get(id)
      if (!arr) byId.set(id, (arr = []))
      arr.push(pair)
      const name = resolveName?.(id)
      if (isRealName(name)) {
        let narr = byName.get(name)
        if (!narr) byName.set(name, (narr = []))
        narr.push(pair)
      }
    }
  }
  for (const arr of byId.values()) arr.sort((a, b) => a.endMs - b.endMs)
  for (const arr of byName.values()) arr.sort((a, b) => a.endMs - b.endMs)
  return { byId, byName }
}

/**
 * 从（按 endMs 升序的）配对列表中取 endMs ≤ td 的最近一对；超出回溯窗口视为未命中。
 * 传入 used 时跳过已被消费的配对（名称兜底用，保证同一咏唱窗口最多被匹配一次）。
 */
function nearestPair(
  list: CastPair[] | undefined,
  td: number,
  maxLookbackMs: number,
  used?: Set<CastPair>
): CastPair | null {
  if (!list) return null
  for (let k = list.length - 1; k >= 0; k--) {
    const p = list[k]
    if (used?.has(p)) continue
    if (p.endMs <= td) {
      return td - p.endMs <= maxLookbackMs ? p : null
    }
  }
  return null
}

/**
 * 给每个伤害事件回填读条窗口（原地，成对写入）。
 *
 * 分层匹配：先按伤害技能 id 精确匹配咏唱；落空时用伤害事件名（已解析）兜底匹配同名咏唱，
 * 解决 boss 「实际读条技能 id ≠ 产生伤害的技能 id、但两者同名」的情况。
 */
export function attachCastWindows(
  damageEvents: DamageEvent[],
  bossCasts: FFLogsEvent[],
  fightStartTime: number,
  resolveName?: NameResolver
): void {
  const { byId, byName } = buildCastPairs(bossCasts, resolveName)
  const toSec = (ms: number) => Math.round((ms - fightStartTime) / 10) / 100
  // 名称兜底已消费的咏唱窗口：同一窗口最多被兜底匹配一次，避免多个同名伤害抢同一个咏唱窗口。
  // 仅作用于名称兜底层；id 精确层不参与去重（同 id 多个伤害可合理共享同一窗口）。
  const usedByNameFallback = new Set<CastPair>()
  for (const ev of damageEvents) {
    const details = ev.playerDamageDetails
    if (!details || details.length === 0) continue
    let td = Infinity
    let abilityId = 0
    for (const d of details) {
      if (d.timestamp < td) {
        td = d.timestamp
        abilityId = d.abilityId ?? 0
      }
    }
    // 第一层：按伤害技能 id 精确匹配（无回溯上限）
    let hit = nearestPair(byId.get(abilityId), td, Infinity)
    // 第二层：id 落空时，按同名咏唱兜底（限回溯窗口、占位名不参与、同一窗口只消费一次）
    if (!hit && isRealName(ev.name)) {
      hit = nearestPair(byName.get(ev.name), td, NAME_FALLBACK_MAX_LOOKBACK_MS, usedByNameFallback)
      if (hit) usedByNameFallback.add(hit)
    }
    if (!hit) continue
    ev.castStartTime = toSec(hit.startMs)
    ev.castEndTime = toSec(hit.endMs)
  }
}
