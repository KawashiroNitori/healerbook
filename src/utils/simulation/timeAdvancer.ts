/**
 * 时间推进器。
 *
 * 从 mitigationCalculator.simulate 抽出：封装 tick 触发（3s 自然回复 + status.onTick）、
 * status 过期裁剪（onExpire + kept/pastStatuses 分流）、以及单个 cast 的执行编排
 * （advance → captureTransition → resolveVariant → executor → recompute）。
 *
 * advanceTo / processCast 的函数体从 mitigationCalculator 逐字迁移，tick 触发、status
 * 过期裁剪、cast 执行编排各段一个字符都不改，保证 simulate 的对外产物（每个
 * DamageEvent 的 CalculationResult、statusTimelineByPlayer、resolvedVariantByCastId、
 * hpTimeline / healSnapshots）与迁移前完全一致。
 *
 * 原闭包捕获的外部依赖全部经 deps 显式传入：statistics / variantMembers / recorder /
 * hp / recordHeal。pastStatuses（advance 剔除但 DOT snapshotTime 仍可能落区间的 buff）
 * 与 resolveVariant 结果（resolvedVariantByCastId）由本模块内部维护，分别经
 * getPastStatuses() / getResolvedVariants() 显式暴露给主循环（前者传 calculate()，后者
 * 进 SimulateOutput）。lastAdvanceTime / castIdx 游标留在 simulate 主循环（编排层职责）：
 * advanceTo(state, from, target) 以显式 from 接收推进起点；processCast(state, cast, from,
 * advanceTarget) 同样显式接收 from，并回传 advanced 标志，让主循环复刻原「parent 缺失时不
 * advance、不推进游标」的语义。
 */

import type { PartyState } from '@/types/partyState'
import type { MitigationStatus } from '@/types/status'
import type { CastEvent } from '@/types/timeline'
import type { TimelineStatData } from '@/types/statData'
import type { ActionExecutionContext, MitigationAction } from '@/types/mitigation'
import type { HealSnapshot } from '@/types/healSnapshot'
import { MITIGATION_DATA } from '@/data/mitigationActions'
import { getStatusById } from '@/utils/statusRegistry'
import { isStatusActiveAt } from '../statusWindow'
import { resolveVariant } from '../placement/resolveVariant'
import type { StatusIntervalRecorder } from './statusIntervalRecorder'
import type { HpPipeline } from './hpPipeline'

const TICK_INTERVAL = 3

/** 时间推进器：tick 触发、status 过期裁剪、cast 执行编排。 */
export interface TimeAdvancer {
  /** 把世界推进到 target 时刻（tick/expire 交替），返回新 state；过期 status 追加进内部 pastStatuses */
  advanceTo(state: PartyState, from: number, target: number): PartyState
  /**
   * 处理单个 cast：advance → captureTransition → resolveVariant → executor → recompute
   * （原 processCast）。返回推进 / 执行后的新 state 及 advanced 标志：resolveVariant 结果
   * 写入内部 resolvedVariantByCastId（经 getResolvedVariants() 暴露）。parent 缺失时原样
   * 返回 state 且 advanced=false —— 保留原 processCast「未 advance 时不推进主循环游标」的
   * 语义，主循环据此决定是否把 lastAdvanceTime 推到 advanceTarget。
   *
   * from 由主循环游标 lastAdvanceTime 提供（游标留在编排层）；原 processCast 内
   * `advanceToTime(state, lastAdvanceTime, advanceTarget)` 的两端由此显式接收。
   */
  processCast(
    state: PartyState,
    cast: CastEvent,
    from: number,
    advanceTarget: number
  ): { state: PartyState; advanced: boolean }
  /** timeAdvancer 产出、calculate 消费的历史 status（DOT 快照找回用） */
  getPastStatuses(): MitigationStatus[]
  /** timeAdvancer 产出：castEvent.id → resolveVariant 解析出的具体变体 actionId */
  getResolvedVariants(): Map<string, number>
}

export function createTimeAdvancer(deps: {
  statistics: TimelineStatData | undefined
  variantMembers: Map<number, MitigationAction[]>
  recorder: StatusIntervalRecorder
  hp: HpPipeline
  recordHeal: ((snap: HealSnapshot) => void) | undefined
}): TimeAdvancer {
  const { statistics, variantMembers, recorder, hp, recordHeal } = deps
  const recomputeAndTrack = hp.recomputeAndTrack
  const captureTransition = recorder.captureTransition

  // 已被 advance 剔除（endTime < cur）但 DOT snapshotTime 仍可能落在区间内的 buff。
  // 主循环按 event.time 单调推进，无法回滚状态——靠这个补丁让 Phase 1 % 减伤找回它们。
  const pastStatuses: MitigationStatus[] = []
  // resolveVariant 解析出的具体变体 actionId，按 castEvent.id 记录，供主循环写出。
  const resolvedVariantByCastId = new Map<string, number>()

  const advanceToTime = (state: PartyState, prev: number, cur: number): PartyState => {
    let next = state

    // (prev, cur] 区间的 3s tick 时刻列表
    const tickTimes: number[] = []
    const firstTick = Math.floor(prev / TICK_INTERVAL) * TICK_INTERVAL + TICK_INTERVAL
    for (let t = firstTick; t <= cur; t += TICK_INTERVAL) {
      tickTimes.push(t)
    }

    // 已 fire 过 onExpire 的 instanceId（避免同一 advance 内重复触发）
    const expired = new Set<string>()

    const fireTick = (t: number) => {
      // 对同一个 tick 点，内层 for-of 以这一 tick 开始时刻的 statuses 快照为迭代对象：
      //   ✓ onTick 返回的新 state 会立即影响该 tick 后续 status 读到的 ctx.partyState
      //   ✗ 但新添加的状态不会在同一 tick 立即被遍历到——它们要等下一 tick 才参与
      // 避免了"tick 内自触发"，也让每个 tick 点的 executor 调用次数可预测。
      next = { ...next, timestamp: t }
      next = recomputeAndTrack(next, t)
      for (const status of next.statuses) {
        if (!isStatusActiveAt(status, t, 'closed')) continue
        const meta = getStatusById(status.statusId)
        if (!meta?.executor?.onTick) continue
        const result = meta.executor.onTick({
          status,
          tickTime: t,
          partyState: next,
          statistics,
          recordHeal,
        })
        if (result) {
          next = result
          next = recomputeAndTrack(next, t)
        }
      }

      // 常驻自然回复：每个 3s tick 固定回 1% 上限（写死），clamp 到 hp.max。与所有 status
      // 无关，只要 hp 池存在就触发。记一条 isHotTick 的 HealSnapshot（actionId 1302）让治疗
      // 曲线/统计纳入它；recordHeal 内部据 applied 更新 lastKnownHp 并 push tick 点，故与下面
      // hp.current 的更新保持同步（同 regenStatusExecutor 的"先 record 再写 hp"口径）。
      if (next.hp) {
        const regen = Math.round(next.hp.max * 0.01)
        if (regen > 0) {
          const before = next.hp.current
          const cur = Math.min(before + regen, next.hp.max)
          recordHeal?.({
            castEventId: '',
            actionId: 1302,
            sourcePlayerId: 0,
            time: t,
            baseAmount: regen,
            finalHeal: regen,
            applied: cur - before,
            overheal: regen - (cur - before),
            isHotTick: true,
          })
          next = { ...next, hp: { ...next.hp, current: cur } }
        }
      }
    }

    const fireExpire = (status: MitigationStatus) => {
      expired.add(status.instanceId)
      next = { ...next, timestamp: status.endTime }
      const meta = getStatusById(status.statusId)
      if (!meta?.executor?.onExpire) {
        // 即使没有 onExpire 钩子，timestamp 推进也可能让 maxHP buff active 状态变化
        next = recomputeAndTrack(next, status.endTime)
        return
      }
      const result = meta.executor.onExpire({
        status,
        expireTime: status.endTime,
        partyState: next,
        statistics,
        recordHeal,
      })
      if (result) next = result
      next = recomputeAndTrack(next, status.endTime)
    }

    // 主循环：每轮挑出"最早的下一个 tick"和"最早的下一个待过期 status"，
    // 谁更早就先处理；同时刻 tick 优先（让 buff 在自己 endTime 那一刻仍能 tick 一次）。
    // 通过每轮重算 pending 来捕获 onExpire / onTick 中新加入或被延长的 status，
    // 让它们在同一 advance 内自然走到自己的 endTime。
    let tickIdx = 0
    // 设上限纯防御：脏 executor 引发循环时不至于 UI 卡死
    let safety = 0
    const SAFETY_LIMIT = 4096
    while (safety++ < SAFETY_LIMIT) {
      const pending = next.statuses
        .filter(s => s.endTime < cur && !expired.has(s.instanceId))
        .sort((a, b) => a.endTime - b.endTime)
      const nextExpire = pending[0]
      const nextTick = tickIdx < tickTimes.length ? tickTimes[tickIdx] : null

      if (nextTick === null && nextExpire === undefined) break

      if (nextTick !== null && (nextExpire === undefined || nextTick <= nextExpire.endTime)) {
        fireTick(nextTick)
        tickIdx++
      } else {
        fireExpire(nextExpire!)
      }
    }

    const kept: MitigationStatus[] = []
    for (const s of next.statuses) {
      if (s.endTime >= cur) kept.push(s)
      else pastStatuses.push(s)
    }
    next = {
      ...next,
      statuses: kept,
      timestamp: cur,
    }
    next = recomputeAndTrack(next, cur)
    return next
  }

  // 抽出"处理一个 cast"的逻辑：damage 前 while、damage 后同时刻 while、末尾干推进三处复用。
  // advanceTarget 一律传 cast.timestamp——主循环已统一以 event.time 推进，DOT 快照
  // 由 historicalStatuses（advance 剔除的 buff）在 calculate Phase 1 找回，无需在
  // advance 终点上 hack。
  const processCast = (
    state: PartyState,
    castEvent: CastEvent,
    from: number,
    advanceTarget: number
  ): { state: PartyState; advanced: boolean } => {
    // castEvent.actionId 现在语义是 trackGroup 父 id
    const parent = MITIGATION_DATA.actions.find(a => a.id === castEvent.actionId)
    if (!parent) return { state, advanced: false }
    const prevState = state
    let currentState = advanceToTime(state, from, advanceTarget)
    captureTransition(prevState, currentState, advanceTarget)

    // 用「截至此刻 active 的 buff」推导具体变体（单成员组返回父本身）
    const members = variantMembers.get(parent.id) ?? [parent]
    const action = resolveVariant(
      parent,
      members,
      castEvent.playerId,
      castEvent.timestamp,
      currentState.statuses
    )
    resolvedVariantByCastId.set(castEvent.id, action.id)

    if (!action.executor) return { state: currentState, advanced: true }
    const before = currentState
    currentState = { ...currentState, timestamp: castEvent.timestamp }
    const ctx: ActionExecutionContext = {
      actionId: action.id,
      useTime: castEvent.timestamp,
      partyState: currentState,
      sourcePlayerId: castEvent.playerId,
      statistics,
      castEventId: castEvent.id,
      recordHeal,
    }
    currentState = action.executor(ctx)
    currentState = recomputeAndTrack(currentState, castEvent.timestamp)
    captureTransition(before, currentState, castEvent.timestamp, castEvent.id, castEvent.playerId)
    return { state: currentState, advanced: true }
  }

  return {
    advanceTo: advanceToTime,
    processCast,
    getPastStatuses: () => pastStatuses,
    getResolvedVariants: () => resolvedVariantByCastId,
  }
}
