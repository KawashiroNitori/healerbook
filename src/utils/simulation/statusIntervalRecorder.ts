/**
 * status 生效区间记录器。
 *
 * 从 mitigationCalculator.simulate 抽出：对比相邻 PartyState 快照的 statuses 差异
 * （按 instanceId diff），维护 open 表并落已闭区间，产出 StatusInterval 时间线与
 * castEndEntries（绿条末端原始条目）。
 *
 * instanceId diff 语义（见 CLAUDE.md「Executor 写作规范」）是整个 buff 系统的底座：
 * simulator 用 instanceId diff 判定 buff 的 attach / persist / consume，据此驱动绿条
 * 长度与 status interval 归属。captureTransition / pushInterval 的函数体逐字迁移，
 * 一个字符都不改。
 */

import type { PartyState } from '@/types/partyState'
import type { StatusInterval } from '@/types/status'
import { statusTier, type StatusTier, type CastEndEntry } from '@/utils/castEffectiveEnd'
import { getStatusById } from '@/utils/statusRegistry'

// CastEndEntry 定义在 castEffectiveEnd.ts，此处 re-export 供 recorder 消费者引用。
export type { CastEndEntry }

/** status 生效区间记录器：对比相邻 PartyState 快照的 statuses 差异，产出 StatusInterval 时间线。 */
export interface StatusIntervalRecorder {
  /** 对比 prev/next 的 statuses（按 instanceId diff），维护 open 表并落已闭区间 */
  captureTransition(
    prev: PartyState,
    next: PartyState,
    at: number,
    castEventIdHint?: string,
    castPlayerIdHint?: number
  ): void
  /** 收尾：把仍 open 的记录以 endTime 落表，返回最终产物 */
  finish(): {
    statusTimelineByPlayer: Map<number, Map<number, StatusInterval[]>>
    castEndEntries: CastEndEntry[]
  }
}

export function createStatusIntervalRecorder(): StatusIntervalRecorder {
  const statusTimelineByPlayer: Map<number, Map<number, StatusInterval[]>> = new Map()
  const castEndEntries: CastEndEntry[] = []

  interface OpenRecord {
    statusId: number
    targetPlayerId: number
    sourcePlayerId: number
    sourceCastEventId: string
    from: number
    stacks: number
    endTime: number
    tier: StatusTier
  }
  const open = new Map<string, OpenRecord>()

  const pushInterval = (rec: OpenRecord, to: number) => {
    const byStatus = statusTimelineByPlayer.get(rec.targetPlayerId) ?? new Map()
    const arr = byStatus.get(rec.statusId) ?? []
    arr.push({
      from: rec.from,
      to,
      stacks: rec.stacks,
      sourcePlayerId: rec.sourcePlayerId,
      sourceCastEventId: rec.sourceCastEventId,
    })
    byStatus.set(rec.statusId, arr)
    statusTimelineByPlayer.set(rec.targetPlayerId, byStatus)

    // 维护绿条末端原始条目：seeded buff（sourceCastEventId 为空）跳过；
    // 收尾按 tier 优先合成 castEffectiveEndByCastEventId。
    if (rec.sourceCastEventId !== '') {
      castEndEntries.push({ castId: rec.sourceCastEventId, to, tier: rec.tier })
    }
  }

  // 对比 state → state' 的 status instance 差异：
  //   消失 → pushInterval(rec, to = at)
  //   新增 → open 一条，from = at，sourceCastEventId 取 castEventIdHint（attach 由 cast executor 触发时）
  //   保留 → 刷新 endTime 快照供 finalize 用
  const captureTransition = (
    prev: PartyState,
    next: PartyState,
    at: number,
    castEventIdHint?: string,
    castPlayerIdHint?: number
  ) => {
    const prevIds = new Set(prev.statuses.map(s => s.instanceId))
    const nextIds = new Set(next.statuses.map(s => s.instanceId))

    for (const id of prevIds) {
      if (nextIds.has(id)) continue
      const rec = open.get(id)
      if (rec) {
        // 自然过期时 advanceToTime 会把 endTime < at 的 status 过滤掉，此时 interval 的
        // 实际终点是 endTime；consume 场景下 rec.endTime >= at，at 才是真正的收束时刻。
        pushInterval(rec, Math.min(at, rec.endTime))
        open.delete(id)
      }
    }

    for (const s of next.statuses) {
      if (prevIds.has(s.instanceId)) continue
      const target = s.sourcePlayerId ?? castPlayerIdHint ?? 0
      open.set(s.instanceId, {
        statusId: s.statusId,
        targetPlayerId: target,
        sourcePlayerId: s.sourcePlayerId ?? castPlayerIdHint ?? target,
        sourceCastEventId: castEventIdHint ?? '',
        from: at,
        stacks: s.stack ?? 1,
        endTime: s.endTime,
        tier: statusTier(getStatusById(s.statusId), s),
      })
    }

    for (const s of next.statuses) {
      const rec = open.get(s.instanceId)
      if (!rec) continue
      rec.endTime = s.endTime
      rec.stacks = s.stack ?? rec.stacks
    }
  }

  const finish = () => {
    for (const [, rec] of open) {
      pushInterval(rec, rec.endTime)
    }
    open.clear()

    for (const byStatus of statusTimelineByPlayer.values()) {
      for (const list of byStatus.values()) {
        list.sort((a, b) => a.from - b.from)
      }
    }

    return { statusTimelineByPlayer, castEndEntries }
  }

  return { captureTransition, finish }
}
