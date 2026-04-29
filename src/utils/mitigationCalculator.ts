/**
 * 减伤计算引擎（基于状态）
 * 实现核心减伤计算逻辑
 */

import type { HpPool, PartyState } from '@/types/partyState'
import type {
  MitigationStatus,
  MitigationStatusMetadata,
  PerformanceType,
  StatusInterval,
} from '@/types/status'
import type { CastEvent, DamageEvent, DamageType } from '@/types/timeline'
import type { TimelineStatData } from '@/types/statData'
import type { ActionExecutionContext } from '@/types/mitigation'
import type { HealSnapshot } from '@/types/healSnapshot'
import type { HpTimelinePoint } from '@/types/hpTimeline'
import { MITIGATION_DATA } from '@/data/mitigationActions'
import { getStatusById } from '@/utils/statusRegistry'
import { computeMaxHpMultiplier } from '@/executors/healMath'
import { isStatusValidForTank } from './statusFilter'

/**
 * 多坦路径单坦克的计算结果
 */
export interface PerTankResult {
  /** 该坦克玩家 ID */
  playerId: number
  finalDamage: number
  mitigationPercentage: number
  appliedStatuses: MitigationStatus[]
  /** 该分支个性化后的参考 HP（叠乘 maxHP 倍率） */
  referenceMaxHP: number
}

/**
 * HP 池模拟快照（编辑模式非坦事件填充）
 *
 * 坦专事件（tankbuster / auto）走 perVictim 多坦分支，hpSimulation 为 undefined。
 * 回放模式与 hp 池未初始化时同样为 undefined。
 */
export interface HpSimulationSnapshot {
  /** 事件前 HP（cast / HoT 已结算） */
  hpBefore: number
  /** 事件后 HP（已扣段增量 / aoe 全额，clamp 到 [0, max]） */
  hpAfter: number
  /** 当前 HP 上限（含 maxHP buff） */
  hpMax: number
  /** 段内 max（partial 事件填充；非 partial 事件不填） */
  segMax?: number
  /** 溢出伤害 = max(0, 应扣量 - hpBefore)（应扣量：partial = delta、aoe = finalDamage） */
  overkill?: number
}

/**
 * 计算结果
 */
export interface CalculationResult {
  /** 原始伤害 */
  originalDamage: number
  /** 最终伤害（中位数） */
  finalDamage: number
  /** 最大伤害 */
  maxDamage: number
  /** 减伤百分比 */
  mitigationPercentage: number
  /** 应用的状态列表 */
  appliedStatuses: MitigationStatus[]
  /** 更新后的小队状态（盾值消耗后，回放模式下为 undefined） */
  updatedPartyState?: PartyState
  /** 非坦中位血量参考值（编辑模式填充） */
  referenceMaxHP?: number
  /**
   * 多坦路径产出；单路径（aoe / 无坦克）为 undefined。
   * 顶层 finalDamage / appliedStatuses / updatedPartyState 取 perVictim[0]；
   * maxDamage 取 max(perVictim.finalDamage)。
   */
  perVictim?: PerTankResult[]
  /** HP 池模拟快照；编辑模式下非坦事件填充；坦专 / 回放模式 / hp 缺失时为 undefined */
  hpSimulation?: HpSimulationSnapshot
}

/**
 * 计算选项
 */
export interface CalculateOptions {
  /**
   * 事件对应的参考血量（已叠加 maxHP 倍率的 tankReferenceMaxHP / referenceMaxHP）。
   * 用于编辑模式下向 StatusBeforeShieldContext 提供 tank 的理论血量——
   * 死斗等"将 HP 拉到 1"类钩子在 replay 缺字段时以此兜底。
   */
  referenceMaxHP?: number
  /**
   * 基线参考 HP（未叠加 maxHP 倍率）。提供此字段时，calculator 负责按活跃 buff 叠乘。
   */
  baseReferenceMaxHP?: number
  /**
   * 坦专事件的承伤者坦克列表，按 composition 顺序。
   * - 非空 + event.type ∈ {tankbuster, auto} → 多坦路径
   * - 否则 → 单路径（现有行为）
   */
  tankPlayerIds?: number[]
  /** 时间轴内部统计数据，可选；用于 Status*Context.statistics 注入 */
  statistics?: TimelineStatData
  /** simulator 注入的治疗 snapshot 收集器；钩子改 hp 时通过此回调记录 HealSnapshot */
  recordHeal?: (snap: HealSnapshot) => void
  /**
   * 已经过期但快照时刻仍可能 active 的状态（DOT 快照专用）。
   * 主循环按 event.time 单调推进，buff endTime < cur 会被剔除；DOT 的 snapshotTime
   * 落在某个已剔除 buff 的 [start, end] 内时需要靠这个补丁找回。仅参与 Phase 1 % 减伤
   * 计算（Phase 2-5 钩子继续走当前 partyState，避免对已消失的 buff 重复触发）。
   */
  historicalStatuses?: MitigationStatus[]
}

/**
 * 纯函数模拟输入
 */
export interface SimulateInput {
  castEvents: CastEvent[]
  damageEvents: DamageEvent[]
  initialState: PartyState
  statistics?: TimelineStatData
  /**
   * composition 中的坦克 playerId 列表，按 composition 自然序。
   * 提供时坦专事件走多坦路径；不提供时单路径。由 hook 从 timeline.composition 派生后传入。
   */
  tankPlayerIds?: number[]
  /**
   * 用于多坦路径的基线 max HP（tankReferenceMaxHP，来自 resolveStatData）；
   * 亦透传给 calculator.calculate 的 baseReferenceMaxHP。
   */
  baseReferenceMaxHPForTank?: number
  /**
   * 非坦事件的基线 max HP（referenceMaxHP，来自 resolveStatData），
   * 用于 calculator.calculate 的 baseReferenceMaxHP（单路径路径）。
   */
  baseReferenceMaxHPForAoe?: number
}

/**
 * 纯函数模拟输出
 */
export interface SimulateOutput {
  damageResults: Map<string, CalculationResult>
  /** playerId → statusId → StatusInterval[]；task 5 才填充，本 task 返回空 Map */
  statusTimelineByPlayer: Map<number, Map<number, StatusInterval[]>>
  /**
   * castEvent.id → 该 cast 附着的所有 instance 中实际收束时刻的最大值。
   * 仅在 cast 有 executor 且产生了至少一个新 instance 时进表；
   * seeded buff（sourceCastEventId === ''）不进表。
   * 渲染层用此字段定位绿条末端，miss 时回退到 cast.timestamp + action.duration。
   */
  castEffectiveEndByCastEventId: Map<string, number>
  /** 所有治疗事件（cast + HoT tick）的 snapshot，按 time 升序 */
  healSnapshots: HealSnapshot[]
  /** HP 池演化序列（time 升序）；回放模式 / hp 池未初始化时为空数组 */
  hpTimeline: HpTimelinePoint[]
}

/**
 * 减伤计算器
 */
export class MitigationCalculator {
  /**
   * 计算减伤后的最终伤害
   * 公式: 最终伤害 = 原始伤害 × (1-减伤1%) × (1-减伤2%) × ... - 盾值
   *
   * @param event 伤害事件（提供原始伤害、时间、攻击类型与伤害类型等）
   * @param partyState 小队状态
   * @param opts 可选参数（含 referenceMaxHP 等透传字段）
   * @returns 计算结果
   */
  calculate(
    event: DamageEvent,
    partyState: PartyState,
    opts?: CalculateOptions
  ): CalculationResult {
    const originalDamage = event.damage
    const attackType = event.type
    const includeTankOnly = attackType === 'tankbuster' || attackType === 'auto'

    // 单路径两口径 filter（维持旧行为 1:1 等价）：
    //   multiplierFilter（Phase 1/2/5）：`isTankOnly && !includeTankOnly` 时跳过
    //   shieldFilter（Phase 3）：`isTankOnly !== includeTankOnly` 时跳过
    const singleMultiplierFilter = (
      meta: MitigationStatusMetadata,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _status: MitigationStatus
    ) => !(meta.isTankOnly && !includeTankOnly)
    const singleShieldFilter = (
      meta: MitigationStatusMetadata,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _status: MitigationStatus
    ) => meta.isTankOnly === includeTankOnly

    // 多坦路径早返回——如果进入多坦分支，单路径的 referenceMaxHP 计算不会执行
    const tankIds = opts?.tankPlayerIds ?? []
    if (includeTankOnly && tankIds.length >= 1) {
      const base = opts?.baseReferenceMaxHP ?? opts?.referenceMaxHP ?? 0

      const perVictimRaw = tankIds.map(tankId => {
        const tankFilter = (meta: MitigationStatusMetadata, status: MitigationStatus) =>
          isStatusValidForTank(meta, status, tankId)
        // 盾值过滤在 tankFilter 基础上叠加 `meta.isTankOnly`（坦专路径
        // includeTankOnly 恒为 true），复刻旧版 `isTankOnly === includeTankOnly`
        // 口径——一份 partywide 盾代表单玩家份额，不该被坦专事件消耗。
        const tankShieldFilter = (meta: MitigationStatusMetadata, status: MitigationStatus) =>
          meta.isTankOnly && tankFilter(meta, status)
        const refHP = this.computeReferenceMaxHP(event, partyState, base, tankFilter)
        const branch = this.runSingleBranch(event, partyState, {
          multiplierFilter: tankFilter,
          shieldFilter: tankShieldFilter,
          referenceMaxHP: refHP,
          statistics: opts?.statistics,
          recordHeal: opts?.recordHeal,
          historicalStatuses: opts?.historicalStatuses,
        })
        return {
          playerId: tankId,
          finalDamage: branch.finalDamage,
          mitigationPercentage: branch.mitigationPercentage,
          appliedStatuses: branch.appliedStatuses,
          referenceMaxHP: refHP,
          state: branch.updatedPartyState,
        }
      })

      // 按 finalDamage 升序排；Array.sort 在 ES2019+ 保证稳定，相同值保持
      // perVictim 原始索引（composition 顺序）作为 tie-break。
      // 排序后 perVictim[0] 即"最优减伤分支"，代表这波最理想的承伤场景——
      // 后续事件的盾值残量反映这个分支的消耗。
      perVictimRaw.sort((a, b) => a.finalDamage - b.finalDamage)
      const bestBranch = perVictimRaw[0]
      const perVictim: PerTankResult[] = perVictimRaw.map(
        ({ playerId, finalDamage, mitigationPercentage, appliedStatuses, referenceMaxHP }) => ({
          playerId,
          finalDamage,
          mitigationPercentage,
          appliedStatuses,
          referenceMaxHP,
        })
      )
      return {
        originalDamage,
        finalDamage: bestBranch.finalDamage,
        maxDamage: perVictimRaw[perVictimRaw.length - 1].finalDamage,
        mitigationPercentage: bestBranch.mitigationPercentage,
        appliedStatuses: bestBranch.appliedStatuses,
        updatedPartyState: bestBranch.state,
        referenceMaxHP: bestBranch.referenceMaxHP,
        perVictim,
      }
    }

    // 单路径：现在才计算 referenceMaxHP，避免多坦路径时的无谓计算
    const referenceMaxHP =
      opts?.referenceMaxHP ??
      this.computeReferenceMaxHP(
        event,
        partyState,
        opts?.baseReferenceMaxHP ?? 0,
        meta => !(meta.isTankOnly && !includeTankOnly)
      )

    const branch = this.runSingleBranch(event, partyState, {
      multiplierFilter: singleMultiplierFilter,
      shieldFilter: singleShieldFilter,
      referenceMaxHP,
      statistics: opts?.statistics,
      recordHeal: opts?.recordHeal,
      historicalStatuses: opts?.historicalStatuses,
    })

    return {
      originalDamage,
      finalDamage: branch.finalDamage,
      maxDamage: branch.finalDamage,
      mitigationPercentage: branch.mitigationPercentage,
      appliedStatuses: branch.appliedStatuses,
      updatedPartyState: branch.updatedPartyState,
      referenceMaxHP,
    }
  }

  /**
   * 按事件类型扣 HP 池，处理 partial 段累积。
   * 返回新的 PartyState（hp 字段更新）与本次产出的 HpSimulationSnapshot。
   * 坦专事件（tankbuster / auto）不入池，snapshot 为 undefined。
   */
  private applyDamageToHp(
    state: PartyState,
    ev: DamageEvent,
    finalDamage: number
  ): { nextState: PartyState; snapshot?: HpSimulationSnapshot } {
    if (!state.hp) return { nextState: state }
    const hp = state.hp

    if (ev.type === 'tankbuster' || ev.type === 'auto') {
      return { nextState: state }
    }

    const before = hp.current
    let nextCurrent = hp.current
    let nextSegMax = hp.segMax
    let nextInSegment = hp.inSegment
    let dealt = 0
    let snapshotSegMax: number | undefined

    if (ev.type === 'aoe') {
      dealt = finalDamage
      nextCurrent -= finalDamage
      nextSegMax = 0
      nextInSegment = false
    } else if (ev.type === 'partial_aoe' || ev.type === 'partial_final_aoe') {
      if (!nextInSegment) {
        nextSegMax = 0
        nextInSegment = true
      }
      dealt = Math.max(0, finalDamage - nextSegMax)
      nextCurrent -= dealt
      nextSegMax = Math.max(nextSegMax, finalDamage)
      snapshotSegMax = nextSegMax
      if (ev.type === 'partial_final_aoe') {
        nextInSegment = false
      }
    }

    const overkill = Math.max(0, dealt - before)
    nextCurrent = Math.max(0, Math.min(nextCurrent, hp.max))

    return {
      nextState: {
        ...state,
        hp: { ...hp, current: nextCurrent, segMax: nextSegMax, inSegment: nextInSegment },
      },
      snapshot: {
        hpBefore: before,
        hpAfter: nextCurrent,
        hpMax: hp.max,
        segMax: snapshotSegMax,
        overkill: overkill > 0 ? overkill : undefined,
      },
    }
  }

  /**
   * 重算 hp.max（按 active 非坦专 maxHP buff 累乘），按比例同步伸缩 hp.current。
   * 在每次 status mutation（applyExecutor / advanceToTime expire / onConsume）后调用。
   */
  private recomputeHpMax(state: PartyState): PartyState {
    if (!state.hp) return state
    const newMultiplier = computeMaxHpMultiplier(state.statuses, state.timestamp)
    const prevMultiplier = state.hp.max / state.hp.base
    if (Math.abs(newMultiplier - prevMultiplier) < 1e-9) return state

    const ratio = newMultiplier / prevMultiplier
    // Round 后避免浮点误差（Math.round 与 computeReferenceMaxHP 口径一致）
    const newMax = Math.round(state.hp.base * newMultiplier)
    const newCurrent = Math.max(0, Math.min(state.hp.current * ratio, newMax))

    return { ...state, hp: { ...state.hp, current: newCurrent, max: newMax } }
  }

  /**
   * 纯函数版全时间轴模拟。产出每个 damageEvent 的计算结果与
   * （下一 task 起）statusTimelineByPlayer。编辑模式专用，不走回放路径。
   *
   * PlacementEngine 在处理 excludeCastEventId 时会以过滤后的 castEvents 重新调用，
   * 因此本方法必须是纯函数，不读/写调用方状态。
   */
  simulate(input: SimulateInput): SimulateOutput {
    const TICK_INTERVAL = 3
    const {
      castEvents,
      damageEvents,
      initialState,
      statistics,
      tankPlayerIds = [],
      baseReferenceMaxHPForTank = 0,
      baseReferenceMaxHPForAoe = 0,
    } = input

    const damageResults = new Map<string, CalculationResult>()
    const statusTimelineByPlayer: Map<number, Map<number, StatusInterval[]>> = new Map()
    const castEffectiveEndByCastEventId = new Map<string, number>()
    const healSnapshots: HealSnapshot[] = []
    const hpTimeline: HpTimelinePoint[] = []
    // 已被 advance 剔除（endTime < cur）但 DOT snapshotTime 仍可能落在区间内的 buff。
    // 主循环按 event.time 单调推进，无法回滚状态——靠这个补丁让 Phase 1 % 减伤找回它们。
    const pastStatuses: MitigationStatus[] = []
    // 闭包变量：跟踪"最近已知 hp 值"，让 recordHeal 在钩子还未 return 新 state 时也能正确回填
    let lastKnownHp = 0
    let lastKnownHpMax = 0
    const recomputeAndTrack = (state: PartyState, time: number): PartyState => {
      const next = this.recomputeHpMax(state)
      if (state.hp && next.hp && state.hp.max !== next.hp.max) {
        lastKnownHp = next.hp.current
        lastKnownHpMax = next.hp.max
        hpTimeline.push({
          time,
          hp: lastKnownHp,
          hpMax: lastKnownHpMax,
          kind: 'maxhp-change',
        })
      }
      return next
    }
    const recordHeal = (snap: HealSnapshot) => {
      healSnapshots.push(snap)
      // 治疗后 hp = 当前已知 hp + applied（钩子里还没 return，所以 lastKnown 还是治疗前的 hp.current）
      const hpAfter = Math.min(lastKnownHp + snap.applied, lastKnownHpMax)
      hpTimeline.push({
        time: snap.time,
        hp: hpAfter,
        hpMax: lastKnownHpMax,
        kind: snap.isHotTick ? 'tick' : 'heal',
        // castEventId 为空字符串时转 undefined，与 refEventId 语义一致（无来源 cast）
        refEventId: snap.castEventId || undefined,
      })
      lastKnownHp = hpAfter
    }

    interface OpenRecord {
      statusId: number
      targetPlayerId: number
      sourcePlayerId: number
      sourceCastEventId: string
      from: number
      stacks: number
      endTime: number
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

      // 维护 castEffectiveEnd：sourceCastEventId 为空（seeded buff）跳过；否则取 max
      if (rec.sourceCastEventId !== '') {
        const prev = castEffectiveEndByCastEventId.get(rec.sourceCastEventId) ?? -Infinity
        castEffectiveEndByCastEventId.set(rec.sourceCastEventId, Math.max(prev, to))
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
        })
      }

      for (const s of next.statuses) {
        const rec = open.get(s.instanceId)
        if (!rec) continue
        rec.endTime = s.endTime
        rec.stacks = s.stack ?? rec.stacks
      }
    }

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
          if (status.startTime > t || status.endTime < t) continue
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

    const sortedDamage = [...damageEvents].sort((a, b) => a.time - b.time)
    const sortedCasts = [...castEvents].sort((a, b) => a.timestamp - b.timestamp)

    const initialHpPool: HpPool | undefined =
      baseReferenceMaxHPForAoe > 0
        ? {
            current: baseReferenceMaxHPForAoe,
            max: baseReferenceMaxHPForAoe,
            base: baseReferenceMaxHPForAoe,
            segMax: 0,
            inSegment: false,
          }
        : undefined

    let currentState: PartyState = {
      statuses: [...initialState.statuses],
      timestamp: initialState.timestamp,
      hp: initialHpPool,
    }
    // 初始 state 已挂的 maxHP buff 立即同步 hp.max / hp.current
    currentState = recomputeAndTrack(currentState, currentState.timestamp)
    if (currentState.hp) {
      lastKnownHp = currentState.hp.current
      lastKnownHpMax = currentState.hp.max
      hpTimeline.push({
        time: currentState.timestamp,
        hp: lastKnownHp,
        hpMax: lastKnownHpMax,
        kind: 'init',
      })
    }
    // 初始 state 的 open 区间（用户 seeded buff 等）：sourceCastEventId = ''（空字符串）
    captureTransition({ statuses: [], timestamp: 0 }, currentState, 0)

    let lastAdvanceTime = 0
    let castIdx = 0

    for (const event of sortedDamage) {
      const filterTime = event.snapshotTime ?? event.time
      while (castIdx < sortedCasts.length && sortedCasts[castIdx].timestamp <= event.time) {
        const castEvent = sortedCasts[castIdx]
        const action = MITIGATION_DATA.actions.find(a => a.id === castEvent.actionId)
        if (action) {
          // 保留 DOT 快照兼容：推进到 cast 时间点和快照时间点的较早者，
          // 避免在 cast 时刻已过期但快照时刻仍需保留的 DOT 状态被提前清理
          const castAdvanceTarget = Math.min(castEvent.timestamp, filterTime)
          const prevState = currentState
          currentState = advanceToTime(currentState, lastAdvanceTime, castAdvanceTarget)
          captureTransition(prevState, currentState, castAdvanceTarget)
          lastAdvanceTime = castAdvanceTarget

          if (action.executor) {
            const before = currentState
            currentState = { ...currentState, timestamp: castEvent.timestamp }
            const ctx: ActionExecutionContext = {
              actionId: castEvent.actionId,
              useTime: castEvent.timestamp,
              partyState: currentState,
              sourcePlayerId: castEvent.playerId,
              statistics,
              castEventId: castEvent.id,
              recordHeal,
            }
            currentState = action.executor(ctx)
            currentState = recomputeAndTrack(currentState, castEvent.timestamp)
            captureTransition(
              before,
              currentState,
              castEvent.timestamp,
              castEvent.id,
              castEvent.playerId
            )
          }
        }
        castIdx++
      }

      const beforeAdvance = currentState
      currentState = advanceToTime(currentState, lastAdvanceTime, filterTime)
      captureTransition(beforeAdvance, currentState, filterTime)
      lastAdvanceTime = filterTime

      const includeTankOnly = event.type === 'tankbuster' || event.type === 'auto'
      const baseReferenceMaxHP = includeTankOnly
        ? baseReferenceMaxHPForTank
        : baseReferenceMaxHPForAoe
      const tankIds = includeTankOnly ? tankPlayerIds : []

      const beforeCalc = currentState
      const result = this.calculate(event, currentState, {
        baseReferenceMaxHP,
        tankPlayerIds: tankIds,
        statistics,
        recordHeal,
        // 仅 DOT 事件（snapshotTime 显式给出）需要找回过期 buff；普通事件不传，避免歧义。
        historicalStatuses: event.snapshotTime !== undefined ? pastStatuses : undefined,
      })
      if (result.updatedPartyState) {
        // calculate 内部钩子（onBeforeShield / onConsume / onAfterDamage）允许改 hp.current
        // （如反应式治疗 buff），主循环信任并接受 calculate 输出的 hp 状态。
        // calculate 内所有 PartyState 重建均通过 spread 透传 hp 字段，因此不会丢失。
        currentState = result.updatedPartyState
        currentState = recomputeAndTrack(currentState, filterTime)
        captureTransition(beforeCalc, currentState, filterTime)
      }

      // DOT 快照与实际伤害时刻分离：% 减伤已在 filterTime（snapshotTime）算完，
      // 扣血时刻仍是 event.time——把状态推到 event.time，让中间的 HoT tick / 状态过期
      // 在扣血之前生效（hpBefore 反映 event.time 而非 snapshotTime 的血量）。
      if (event.time > filterTime) {
        const beforeFinalAdvance = currentState
        currentState = advanceToTime(currentState, filterTime, event.time)
        captureTransition(beforeFinalAdvance, currentState, event.time)
        lastAdvanceTime = event.time
      }

      // calculate 之后扣 HP 池；hpSimulation 在 set 时一次性合并，避免放进 Map 后再 mutate
      const { nextState: stateAfterHp, snapshot: hpSnap } = this.applyDamageToHp(
        currentState,
        event,
        result.finalDamage
      )
      damageResults.set(event.id, { ...result, hpSimulation: hpSnap })
      if (stateAfterHp.hp) {
        lastKnownHp = stateAfterHp.hp.current
        lastKnownHpMax = stateAfterHp.hp.max
        hpTimeline.push({
          time: event.time,
          hp: lastKnownHp,
          hpMax: lastKnownHpMax,
          kind: 'damage',
          refEventId: event.id,
        })
      }
      currentState = stateAfterHp
    }

    // 处理最后一个 damage event 之后的剩余 casts：damage event 的 for-of 内部 while 循环
    // 只追到 timestamp <= event.time 的 cast。如果没有 damage event、或 damage 都在某个
    // cast 之前，该 cast 永远不会被 executor 执行，statusTimelineByPlayer 就会漏掉它
    // attach 的状态。这里补一轮"干推进"，把剩余 casts 按时序处理完。
    while (castIdx < sortedCasts.length) {
      const castEvent = sortedCasts[castIdx]
      const action = MITIGATION_DATA.actions.find(a => a.id === castEvent.actionId)
      if (action) {
        const prevState = currentState
        currentState = advanceToTime(currentState, lastAdvanceTime, castEvent.timestamp)
        captureTransition(prevState, currentState, castEvent.timestamp)
        lastAdvanceTime = castEvent.timestamp

        if (action.executor) {
          const before = currentState
          currentState = { ...currentState, timestamp: castEvent.timestamp }
          const ctx: ActionExecutionContext = {
            actionId: castEvent.actionId,
            useTime: castEvent.timestamp,
            partyState: currentState,
            sourcePlayerId: castEvent.playerId,
            statistics,
            castEventId: castEvent.id,
            recordHeal,
          }
          currentState = action.executor(ctx)
          currentState = recomputeAndTrack(currentState, castEvent.timestamp)
          captureTransition(
            before,
            currentState,
            castEvent.timestamp,
            castEvent.id,
            castEvent.playerId
          )
        }
      }
      castIdx++
    }

    for (const [, rec] of open) {
      pushInterval(rec, rec.endTime)
    }
    open.clear()

    for (const byStatus of statusTimelineByPlayer.values()) {
      for (const list of byStatus.values()) {
        list.sort((a, b) => a.from - b.from)
      }
    }

    // 按 time 升序：cast / HoT tick 自然按主循环时序入列，但 calculate 内部钩子（onConsume /
    // onAfterDamage）的 recordHeal 与同时刻 advanceToTime 先 fire 的 onTick 入列顺序依赖
    // 主循环执行顺序，出口处显式排序避免下游消费者依赖隐式约定。
    healSnapshots.sort((a, b) => a.time - b.time)
    // JS Array.sort 是稳定排序（ES2019+），同时刻 push 顺序（主循环内序）得以保留。
    hpTimeline.sort((a, b) => a.time - b.time)

    return {
      damageResults,
      statusTimelineByPlayer,
      castEffectiveEndByCastEventId,
      healSnapshots,
      hpTimeline,
    }
  }

  /**
   * 计算指定事件在给定过滤条件下的参考 HP（基线 × 活跃 buff maxHP 累乘）。
   */
  private computeReferenceMaxHP(
    event: DamageEvent,
    partyState: PartyState,
    base: number,
    filter: (meta: MitigationStatusMetadata, status: MitigationStatus) => boolean
  ): number {
    if (base <= 0) return 0
    const mitigationTime = event.snapshotTime ?? event.time
    let m = 1
    for (const status of partyState.statuses) {
      if (mitigationTime < status.startTime || mitigationTime > status.endTime) continue
      const meta = getStatusById(status.statusId)
      if (!meta) continue
      if (!filter(meta, status)) continue
      const perf = status.performance ?? meta.performance
      const mm = perf.maxHP ?? 1
      if (mm !== 1) m *= mm
    }
    return Math.round(base * m)
  }

  /**
   * 执行单条路径的五阶段减伤 pipeline。
   * 多坦路径（后续 task 实现）将两个 filter 都传同一个 isStatusValidForTank(…, tankId)；
   * 单路径分别复刻旧口径：
   *   multiplierFilter（Phase 1/2/5）→ !(isTankOnly && !includeTankOnly)
   *   shieldFilter（Phase 3）→ isTankOnly === includeTankOnly
   */
  private runSingleBranch(
    event: DamageEvent,
    partyState: PartyState,
    opts: {
      multiplierFilter: (meta: MitigationStatusMetadata, status: MitigationStatus) => boolean
      shieldFilter: (meta: MitigationStatusMetadata, status: MitigationStatus) => boolean
      referenceMaxHP: number
      statistics?: TimelineStatData
      recordHeal?: (snap: HealSnapshot) => void
      historicalStatuses?: MitigationStatus[]
    }
  ): {
    finalDamage: number
    mitigationPercentage: number
    appliedStatuses: MitigationStatus[]
    updatedPartyState: PartyState
  } {
    const originalDamage = event.damage
    const time = event.time
    const damageType: DamageType = event.damageType || 'physical'
    const snapshotTime = event.snapshotTime
    const mitigationTime = snapshotTime ?? time
    const { multiplierFilter, shieldFilter, referenceMaxHP, statistics, recordHeal } = opts

    // Phase 1: % 减伤
    // 同时遍历 partyState.statuses 与 historicalStatuses（已被主循环 advance 剔除但
    // snapshotTime 仍落在区间内的 buff），让 DOT 快照能找回已"过期"但应快照的 buff。
    // Phase 2-5 钩子继续只跑 partyState.statuses，避免对消失的 buff 重复触发副作用。
    let multiplier = 1.0
    const appliedStatuses: MitigationStatus[] = []

    const phase1Statuses = opts.historicalStatuses
      ? [...partyState.statuses, ...opts.historicalStatuses]
      : partyState.statuses

    for (const status of phase1Statuses) {
      const meta = getStatusById(status.statusId)
      if (!meta) continue
      if (!multiplierFilter(meta, status)) continue

      if (meta.type === 'multiplier') {
        if (mitigationTime >= status.startTime && mitigationTime <= status.endTime) {
          // instance 的 performance 优先（snapshot-on-apply 覆盖），不在则取 metadata
          const performance = status.performance ?? meta.performance
          const damageMultiplier = this.getDamageMultiplier(performance, damageType)
          multiplier *= damageMultiplier
          appliedStatuses.push(status)
        }
      }
    }

    const candidateDamage = Math.round(originalDamage * multiplier)

    // Phase 2: onBeforeShield — 状态可在此阶段新增/修改状态
    let workingState: PartyState = partyState
    for (const status of partyState.statuses) {
      const meta = getStatusById(status.statusId)
      if (!meta?.executor?.onBeforeShield) continue
      if (!multiplierFilter(meta, status)) continue
      if (mitigationTime < status.startTime || mitigationTime > status.endTime) continue

      const result = meta.executor.onBeforeShield({
        status,
        event,
        partyState: workingState,
        candidateDamage,
        referenceMaxHP,
        statistics,
        recordHeal,
      })
      if (result) workingState = result
    }

    // Phase 3: 盾值吸收（基于 workingState，含 onBeforeShield 阶段的修改）
    // 判定依据是 **实例级** `remainingBarrier > 0`，不看 metadata 类型 ——
    // 这样 buff 类 executor（如死斗）通过 onBeforeShield 给自己挂 transient barrier 也能参与吸收。
    const shieldStatuses: MitigationStatus[] = []
    for (const status of workingState.statuses) {
      const meta = getStatusById(status.statusId)
      if (!meta) continue
      // 盾的 isTankOnly 需与事件类型匹配：坦专盾只进死刑/普攻，群盾只进 aoe
      // 原因：一个盾状态实例的 remainingBarrier 代表单玩家一份，单体事件不该消耗"全队的份"
      if (!shieldFilter(meta, status)) continue
      if (status.remainingBarrier === undefined || status.remainingBarrier <= 0) continue
      if (time >= status.startTime && time <= status.endTime) {
        shieldStatuses.push(status)
      }
    }
    shieldStatuses.sort((a, b) => a.startTime - b.startTime)

    const statusUpdates = new Map<string, Partial<MitigationStatus>>()
    const consumedShields: Array<{ status: MitigationStatus; absorbed: number }> = []
    let playerDamage = candidateDamage

    for (const status of shieldStatuses) {
      const absorbed = Math.min(playerDamage, status.remainingBarrier!)
      playerDamage -= absorbed

      // 已被 Phase 1 push 过的同 instance（典型：死斗是 multiplier meta，
      // Phase 1 先以无 barrier 引用进表）需要替换为带 barrier 的 Phase 3 实例，
      // 否则 UI 读到旧引用以为它没盾
      const existingIdx = appliedStatuses.findIndex(s => s.instanceId === status.instanceId)
      if (existingIdx >= 0) {
        appliedStatuses[existingIdx] = status
      } else {
        appliedStatuses.push(status)
      }

      const newRemainingBarrier = status.remainingBarrier! - absorbed

      if (newRemainingBarrier <= 0 && status.stack && status.stack > 1 && status.initialBarrier) {
        statusUpdates.set(status.instanceId, {
          remainingBarrier: status.initialBarrier,
          stack: status.stack - 1,
        })
      } else {
        statusUpdates.set(status.instanceId, {
          remainingBarrier: newRemainingBarrier,
        })
        if (newRemainingBarrier <= 0) {
          // 仅 stack <= 1 且被打穿的盾算"消耗殆尽"，会触发 onConsume
          consumedShields.push({ status, absorbed })
        }
      }

      if (playerDamage <= 0) break
    }

    const damage = playerDamage

    let updatedPartyState: PartyState = {
      ...workingState,
      statuses: workingState.statuses
        .map(s => {
          if (statusUpdates.has(s.instanceId)) {
            const updates = statusUpdates.get(s.instanceId)!
            return { ...s, ...updates }
          }
          return s
        })
        // barrier 归 0 时：仅 `removeOnBarrierBreak: true` 的实例被自动清除（原生盾）。
        // 其它（如死斗/出死入生借 onBeforeShield 挂的 transient barrier）保留 buff 本体，
        // 让 duration / 其它钩子管它的生命周期，后续事件仍能再次触发 onBeforeShield。
        .filter(s => {
          if (s.remainingBarrier === undefined || s.remainingBarrier > 0) return true
          return !s.removeOnBarrierBreak
        }),
    }

    // Phase 4: onConsume — 刚被打穿的盾触发后续变化
    for (const { status, absorbed } of consumedShields) {
      const meta = getStatusById(status.statusId)
      if (!meta?.executor?.onConsume) continue
      const result = meta.executor.onConsume({
        status,
        event,
        partyState: updatedPartyState,
        absorbedAmount: absorbed,
        statistics,
        recordHeal,
      })
      if (result) updatedPartyState = result
    }

    // Phase 5: onAfterDamage — 盾吸收后的通用收尾
    // 遍历 partyState.statuses（原始活跃集合），不遍历 updatedPartyState：
    //   ✓ 本事件 onBeforeShield/onConsume 新添的状态不会在同一事件立即触发自己的 onAfterDamage；
    //   ✗ 代价：status 参数是原始实例快照，其 remainingBarrier / stack / data 等字段可能与
    //     updatedPartyState 里同 instanceId 的最新值不一致。需要读自身最新状态的 executor 应从
    //     ctx.partyState.statuses.find(s => s.instanceId === ctx.status.instanceId) 取。
    for (const status of partyState.statuses) {
      const meta = getStatusById(status.statusId)
      if (!meta?.executor?.onAfterDamage) continue
      if (!multiplierFilter(meta, status)) continue
      if (mitigationTime < status.startTime || mitigationTime > status.endTime) continue

      const result = meta.executor.onAfterDamage({
        status,
        event,
        partyState: updatedPartyState,
        candidateDamage,
        finalDamage: Math.max(0, Math.round(damage)),
        statistics,
        recordHeal,
      })
      if (result) updatedPartyState = result
    }

    const mitigationPercentage =
      originalDamage > 0 ? ((originalDamage - damage) / originalDamage) * 100 : 0

    return {
      finalDamage: Math.max(0, Math.round(damage)),
      mitigationPercentage: Math.round(mitigationPercentage * 10) / 10,
      appliedStatuses,
      updatedPartyState,
    }
  }

  /**
   * 根据伤害类型获取减伤倍率
   * @param performance 状态性能数据
   * @param damageType 伤害类型
   * @returns 减伤倍率（0-1）
   */
  private getDamageMultiplier(performance: PerformanceType, damageType: DamageType): number {
    switch (damageType) {
      case 'physical':
        return performance.physics
      case 'magical':
        return performance.magic
      case 'darkness':
        return performance.darkness
      default:
        return 1.0
    }
  }
}

/**
 * 创建减伤计算器实例
 */
export function createMitigationCalculator(): MitigationCalculator {
  return new MitigationCalculator()
}
