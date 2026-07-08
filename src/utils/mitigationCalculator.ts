/**
 * 减伤计算引擎（基于状态）
 * 实现核心减伤计算逻辑
 */

import type { HpPool, PartyState } from '@/types/partyState'
import type { MitigationStatus, MitigationStatusMetadata } from '@/types/status'
import type { CastEvent, DamageEvent, DamageType } from '@/types/timeline'
import type { TimelineStatData } from '@/types/statData'
import type { MitigationAction } from '@/types/mitigation'
import type { HealSnapshot } from '@/types/healSnapshot'
import type {
  PerTankResult,
  HpSimulationSnapshot,
  CalculationResult,
  CalculateOptions,
  SimulateInput,
  SimulateOutput,
} from '@/types/calculation'

// 过渡兜底 re-export：既有消费者的 '@/utils/mitigationCalculator' 类型 import 路径保持可用
export type {
  PerTankResult,
  HpSimulationSnapshot,
  CalculationResult,
  CalculateOptions,
  SimulateInput,
  SimulateOutput,
}
import { MITIGATION_DATA } from '@/data/mitigationActions'
import { getStatusById, getMultiplierForDamageType } from '@/utils/statusRegistry'
import { computeMaxHpMultiplierFiltered } from '@/executors/healMath'
import { isStatusActiveAt } from './statusWindow'
import { isStatusValidForTank } from './statusFilter'
import { reduceCastEffectiveEnds } from './castEffectiveEnd'
import { formatTimeWithDecimal } from '@/utils/formatters'
import { createStatusIntervalRecorder } from './simulation/statusIntervalRecorder'
import { createHpPipeline } from './simulation/hpPipeline'
import { createTimeAdvancer } from './simulation/timeAdvancer'

/**
 * actionId → action.category 映射（模块级构建一次）。
 * 多坦过滤时用 status.sourceActionId 反查产出它的 action 的 category，
 * 优先于 statusExtras 的 statusId 默认值（见 isStatusValidForTank）。
 */
const ACTION_CATEGORY_BY_ID = new Map(MITIGATION_DATA.actions.map(a => [a.id, a.category]))

/** 解析 status 产出 action 的 category；无可靠归属时返回 undefined 以回落 meta。 */
function actionCategoryOf(status: MitigationStatus) {
  return status.sourceActionId != null
    ? ACTION_CATEGORY_BY_ID.get(status.sourceActionId)
    : undefined
}

/**
 * 计算减伤后的最终伤害
 * 公式: 最终伤害 = 原始伤害 × (1-减伤1%) × (1-减伤2%) × ... - 盾值
 *
 * @param event 伤害事件（提供原始伤害、时间、攻击类型与伤害类型等）
 * @param partyState 小队状态
 * @param opts 可选参数（含 referenceMaxHP 等透传字段）
 * @returns 计算结果
 */
export function calculate(
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
        isStatusValidForTank(meta, status, tankId, actionCategoryOf(status))
      // 盾值过滤在 tankFilter 基础上叠加 `meta.isTankOnly`（坦专路径
      // includeTankOnly 恒为 true），复刻旧版 `isTankOnly === includeTankOnly`
      // 口径——一份 partywide 盾代表单玩家份额，不该被坦专事件消耗。
      const tankShieldFilter = (meta: MitigationStatusMetadata, status: MitigationStatus) =>
        meta.isTankOnly && tankFilter(meta, status)
      const refHP = computeReferenceMaxHP(event, partyState, base, tankFilter)
      const branch = runSingleBranch(event, partyState, {
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
        candidateDamage: branch.candidateDamage,
      }
    })

    // 按 finalDamage 升序排；Array.sort 在 ES2019+ 保证稳定，相同值保持
    // perVictim 原始索引（composition 顺序）作为 tie-break。
    // 排序后 perVictim[0] 即"最优减伤分支"，代表这波最理想的承伤场景——
    // 后续事件的盾值残量反映这个分支的消耗。
    perVictimRaw.sort((a, b) => a.finalDamage - b.finalDamage)
    const bestBranch = perVictimRaw[0]
    const perVictim: PerTankResult[] = perVictimRaw.map(
      ({
        playerId,
        finalDamage,
        mitigationPercentage,
        appliedStatuses,
        referenceMaxHP,
        candidateDamage,
      }) => ({
        playerId,
        finalDamage,
        mitigationPercentage,
        appliedStatuses,
        referenceMaxHP,
        candidateDamage,
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
      candidateDamage: bestBranch.candidateDamage,
    }
  }

  // 单路径：现在才计算 referenceMaxHP，避免多坦路径时的无谓计算
  const referenceMaxHP =
    opts?.referenceMaxHP ??
    computeReferenceMaxHP(
      event,
      partyState,
      opts?.baseReferenceMaxHP ?? 0,
      meta => !(meta.isTankOnly && !includeTankOnly)
    )

  const branch = runSingleBranch(event, partyState, {
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
    candidateDamage: branch.candidateDamage,
    mitigationPercentage: branch.mitigationPercentage,
    appliedStatuses: branch.appliedStatuses,
    updatedPartyState: branch.updatedPartyState,
    referenceMaxHP,
  }
}

/**
 * 纯函数版全时间轴模拟。产出每个 damageEvent 的计算结果与
 * （下一 task 起）statusTimelineByPlayer。编辑模式专用，不走回放路径。
 *
 * PlacementEngine 在处理 excludeCastEventId 时会以过滤后的 castEvents 重新调用，
 * 因此本方法必须是纯函数，不读/写调用方状态。
 */
export function simulate(input: SimulateInput): SimulateOutput {
  const {
    castEvents,
    damageEvents,
    initialState,
    statistics,
    tankPlayerIds = [],
    baseReferenceMaxHPForTank = 0,
    baseReferenceMaxHPForAoe = 0,
    skipHpPipeline = false,
  } = input

  const damageResults = new Map<string, CalculationResult>()
  const castEffectiveEndByCastEventId = new Map<string, number>()
  // 预建 trackGroup 成员表：父 id → members
  const variantMembers = new Map<number, MitigationAction[]>()
  for (const a of MITIGATION_DATA.actions) {
    const gid = a.trackGroup ?? a.id
    const arr = variantMembers.get(gid) ?? []
    arr.push(a)
    variantMembers.set(gid, arr)
  }
  // HP 池演算管道：hp.max 同步、伤害落池、治疗 / tick 记录与 hpTimeline / healSnapshots /
  // lastKnownHp / lastKnownHpMax 影子状态全部封装在此。recomputeAndTrack / recordHeal
  // 只是管道方法的本地别名，简化下方主循环的调用点。
  const hp = createHpPipeline({ skipHpPipeline })
  const recomputeAndTrack = hp.recomputeAndTrack
  const recordHeal = hp.recordHeal

  // status 生效区间记录：instanceId diff 语义（attach/persist/consume）已下沉到
  // simulation/statusIntervalRecorder。simulate 只在状态迁移处调 captureTransition，
  // 收尾调 finish() 取 statusTimelineByPlayer 与 castEndEntries。
  const recorder = createStatusIntervalRecorder()
  const captureTransition = recorder.captureTransition

  // 时间推进器：tick 触发 / status 过期裁剪 / 单 cast 执行编排已下沉到
  // simulation/timeAdvancer。advance 剔除但 DOT snapshotTime 仍落区间的 buff（pastStatuses）
  // 与 resolveVariant 结果（resolvedVariantByCastId）由 advancer 内部维护，经
  // getPastStatuses() / getResolvedVariants() 暴露。lastAdvanceTime 游标留在本主循环。
  const advancer = createTimeAdvancer({
    statistics,
    variantMembers,
    recorder,
    hp,
    recordHeal,
  })

  const sortedDamage = [...damageEvents].sort((a, b) => a.time - b.time)
  const sortedCasts = [...castEvents].sort((a, b) => a.timestamp - b.timestamp)

  const initialHpPool: HpPool | undefined =
    !skipHpPipeline && baseReferenceMaxHPForAoe > 0
      ? {
          current: baseReferenceMaxHPForAoe,
          max: baseReferenceMaxHPForAoe,
          base: baseReferenceMaxHPForAoe,
        }
      : undefined

  let currentState: PartyState = {
    statuses: [...initialState.statuses],
    timestamp: initialState.timestamp,
    hp: initialHpPool,
    segment: { inSegment: false, segMax: 0, segCandidateMax: 0, segOriginalMax: 0 },
  }
  // 初始 state 已挂的 maxHP buff 立即同步 hp.max / hp.current
  currentState = recomputeAndTrack(currentState, currentState.timestamp)
  if (currentState.hp) {
    hp.recordTimelinePoint({
      time: currentState.timestamp,
      hp: currentState.hp.current,
      hpMax: currentState.hp.max,
      kind: 'init',
    })
  }
  // 初始 state 的 open 区间（用户 seeded buff 等）：sourceCastEventId = ''（空字符串）
  captureTransition({ statuses: [], timestamp: 0 }, currentState, 0)

  let lastAdvanceTime = 0
  let castIdx = 0

  // 处理一个 cast（damage 前 while、damage 后同时刻 while、末尾干推进三处复用）：委托
  // advancer.processCast 做 advance → captureTransition → resolveVariant → executor →
  // recompute，本层只维护 lastAdvanceTime 游标。advanceTarget 一律传 cast.timestamp——主循环
  // 已统一以 event.time 推进，DOT 快照由 historicalStatuses（advance 剔除的 buff）在
  // calculate Phase 1 找回，无需在 advance 终点上 hack。
  const processCast = (castEvent: CastEvent, advanceTarget: number) => {
    const { state, advanced } = advancer.processCast(
      currentState,
      castEvent,
      lastAdvanceTime,
      advanceTarget
    )
    currentState = state
    // parent 缺失（advanced=false）时原 processCast 不 advance、不推进游标——保持一致。
    if (advanced) lastAdvanceTime = advanceTarget
  }

  for (const event of sortedDamage) {
    // 主循环的时间推进、状态收束、HP 演化全部以 event.time 为准。
    // event.snapshotTime（DOT 快照时刻）只影响 calculate 内 Phase 1 % 减伤计算——
    // mitigationTime = snapshotTime ?? event.time，用 historicalStatuses（advance 已剔除
    // 的 buff）找回快照时刻 active 的过期 buff。其他所有处理（advance / captureTransition /
    // Phase 4 onConsume / Phase 5 onAfterDamage 钩子）一律用 event.time，避免 DOT 语义
    // 渗透到不该影响的链路（典型 bug：礼仪之铃 stack 在 onAfterDamage 里 removeStatus，
    // 用 filterTime 收束 → 绿条在 snapshotTime 提前断）。
    while (castIdx < sortedCasts.length && sortedCasts[castIdx].timestamp < event.time) {
      const castEvent = sortedCasts[castIdx]
      processCast(castEvent, castEvent.timestamp)
      castIdx++
    }

    const beforeAdvance = currentState
    currentState = advancer.advanceTo(currentState, lastAdvanceTime, event.time)
    captureTransition(beforeAdvance, currentState, event.time)
    lastAdvanceTime = event.time

    const includeTankOnly = event.type === 'tankbuster' || event.type === 'auto'
    const baseReferenceMaxHP = includeTankOnly
      ? baseReferenceMaxHPForTank
      : baseReferenceMaxHPForAoe
    const tankIds = includeTankOnly ? tankPlayerIds : []

    const beforeCalc = currentState
    const result = calculate(event, currentState, {
      baseReferenceMaxHP,
      tankPlayerIds: tankIds,
      statistics,
      recordHeal,
      // 仅 DOT 事件（snapshotTime 显式给出）需要找回过期 buff；普通事件不传，避免歧义。
      historicalStatuses: event.snapshotTime !== undefined ? advancer.getPastStatuses() : undefined,
    })
    if (result.updatedPartyState) {
      // calculate 内 phase 2 onBeforeShield / phase 4 onConsume 钩子允许改 hp.current
      // （如反应式治疗 buff），主循环信任并接受 calculate 输出的 hp 状态。
      currentState = result.updatedPartyState
      currentState = recomputeAndTrack(currentState, event.time)
      captureTransition(beforeCalc, currentState, event.time)
    }

    // calculate 之后扣 HP 池；applyDamage 内部维护影子状态并 push damage 点。
    // hpSimulation 在 set 时一次性合并，避免放进 Map 后再 mutate
    const { nextState: stateAfterHp, snapshot: hpSnap } = hp.applyDamage(
      currentState,
      event,
      result.finalDamage,
      result.candidateDamage ?? result.finalDamage
    )
    damageResults.set(event.id, { ...result, hpSimulation: hpSnap })
    // 调试日志：仅 DEV 构建保留；生产期 import.meta.env.DEV 折叠成 false → 整段 DCE。
    if (import.meta.env.DEV && !skipHpPipeline && hpSnap) {
      const dealt = hpSnap.hpBefore - hpSnap.hpAfter
      const overkillNote = hpSnap.overkill ? ` (overkill ${hpSnap.overkill})` : ''
      console.log(
        `[hp-sim damage] ${formatTimeWithDecimal(event.time)} [${event.type}] ${event.name}: ${hpSnap.hpBefore} → ${hpSnap.hpAfter} (-${dealt})${overkillNote}`
      )
    }
    currentState = stateAfterHp

    // Phase 5 onAfterDamage：在 applyDamageToHp 之后跑，让反应式治疗（如礼仪之铃）看到
    // hp_after_damage 而非 hp_before。死刑 / 普攻是坦专伤害（includeTankOnly），非 T 不吃，
    // partywide 反应式钩子（礼仪之铃回血 / 大宇宙累计）一律不应在这类事件上触发——故整段
    // phase 5 只在非坦专事件（全员 / 部分 AOE）上跑，由这里统一收口，钩子内无需各自重复
    // 排除 tankbuster / auto。多坦下也只按"最优分支后的共享 partyState"跑一次，避免按 tank
    // 分支重复触发让 stack 加倍消耗。
    if (!includeTankOnly) {
      const beforePhase5 = currentState
      let phase5State = currentState
      for (const status of currentState.statuses) {
        const meta = getStatusById(status.statusId)
        if (!meta?.executor?.onAfterDamage) continue
        if (meta.isTankOnly) continue // 坦专 buff 不挂在非 T 身上，不参与 AOE 路径
        if (!isStatusActiveAt(status, event.time, 'closed')) continue
        const phase5Result = meta.executor.onAfterDamage({
          status,
          event,
          partyState: phase5State,
          candidateDamage: result.candidateDamage ?? result.finalDamage,
          finalDamage: result.finalDamage,
          statistics,
          recordHeal,
        })
        if (phase5Result) phase5State = phase5Result
      }
      if (phase5State !== currentState) {
        currentState = recomputeAndTrack(phase5State, event.time)
        captureTransition(beforePhase5, currentState, event.time)
      }
    }

    // 同时刻 cast 推迟到 damage 之后处理：先扣再回，hp 曲线/日志顺序与计算流程一致。
    // state 已经在 event.time，advanceTarget 传 cast.timestamp（=== event.time）即 no-op。
    while (castIdx < sortedCasts.length && sortedCasts[castIdx].timestamp === event.time) {
      const castEvent = sortedCasts[castIdx]
      processCast(castEvent, castEvent.timestamp)
      castIdx++
    }
  }

  // 处理最后一个 damage event 之后的剩余 casts：damage event 的 for-of 循环只追到
  // timestamp <= event.time 的 cast。如果没有 damage event、或 damage 都在某个 cast
  // 之前，该 cast 永远不会被 executor 执行，statusTimelineByPlayer 就会漏掉它 attach
  // 的状态。这里补一轮"干推进"，把剩余 casts 按时序处理完。
  while (castIdx < sortedCasts.length) {
    const castEvent = sortedCasts[castIdx]
    processCast(castEvent, castEvent.timestamp)
    castIdx++
  }

  // recorder 收尾：flush 仍 open 的记录、按 from 排序，取出最终产物。
  const { statusTimelineByPlayer, castEndEntries } = recorder.finish()

  for (const [castId, end] of reduceCastEffectiveEnds(castEndEntries)) {
    castEffectiveEndByCastEventId.set(castId, end)
  }

  // hp 管道收尾：按 time 升序排序（详见 hpPipeline.finish）并取出 hpTimeline / healSnapshots。
  const { hpTimeline, healSnapshots } = hp.finish()

  return {
    damageResults,
    statusTimelineByPlayer,
    castEffectiveEndByCastEventId,
    resolvedVariantByCastId: advancer.getResolvedVariants(),
    healSnapshots,
    hpTimeline,
  }
}

/**
 * 计算指定事件在给定过滤条件下的参考 HP（基线 × 活跃 buff maxHP 累乘）。
 *
 * @internal 导出仅供 simulation/ 兄弟模块使用，不属于公共 API。
 */
export function computeReferenceMaxHP(
  event: DamageEvent,
  partyState: PartyState,
  base: number,
  filter: (meta: MitigationStatusMetadata, status: MitigationStatus) => boolean
): number {
  if (base <= 0) return 0
  // referenceMaxHP 按 event.time 算（与 simulate 主循环维护的 hp.max 同步）。
  // snapshotTime 只决定 Phase 1 % 减伤的 buff 选择，与 HP 上限无关——DOT 期间
  // 已过期的 maxHP buff 不应继续把坦克"理论 HP 上限"撑大。
  const m = computeMaxHpMultiplierFiltered(partyState.statuses, event.time, 'closed', filter)
  return Math.round(base * m)
}

/**
 * 执行单条路径的五阶段减伤 pipeline。
 * 多坦路径（后续 task 实现）将两个 filter 都传同一个 isStatusValidForTank(…, tankId)；
 * 单路径分别复刻旧口径：
 *   multiplierFilter（Phase 1/2/5）→ !(isTankOnly && !includeTankOnly)
 *   shieldFilter（Phase 3）→ isTankOnly === includeTankOnly
 *
 * @internal 导出仅供 simulation/ 兄弟模块使用，不属于公共 API。
 */
export function runSingleBranch(
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
  candidateDamage: number
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
    // 目标减开关：本事件关闭目标减时，跳过所有 boss debuff（不乘、不计入 appliedStatuses）
    if (event.targetMitigationDisabled && meta.category?.includes('boss')) continue

    if (meta.type === 'multiplier') {
      if (isStatusActiveAt(status, mitigationTime, 'closed')) {
        // instance 的 performance 优先（snapshot-on-apply 覆盖），不在则取 metadata
        const performance = status.performance ?? meta.performance
        const damageMultiplier = getMultiplierForDamageType(performance, damageType)
        multiplier *= damageMultiplier
        appliedStatuses.push(status)
      }
    }
  }

  // 临时减伤（仅本事件）：百分比在此乘算折入 multiplier；盾（type='shield'）由 Phase 3 真实盾
  // 之后单独减算（见下文 Phase 3）。两者都不进 appliedStatuses——临时减伤由 UI 独立 section 展示。
  for (const tm of event.tempMitigations ?? []) {
    if (tm.type === 'percent') {
      const pct = Math.min(100, Math.max(0, tm.value))
      multiplier *= 1 - pct / 100
    }
  }

  const candidateDamage = Math.round(originalDamage * multiplier)

  // Phase 2: onBeforeShield — 状态可在此阶段新增/修改状态
  let workingState: PartyState = partyState
  for (const status of partyState.statuses) {
    const meta = getStatusById(status.statusId)
    if (!meta?.executor?.onBeforeShield) continue
    if (!multiplierFilter(meta, status)) continue
    // 用 event.time（不是 mitigationTime）：snapshotTime 只决定 Phase 1 % 减伤的 buff
    // 选择，"buff 是否在伤害实际发生时 active"应按 event.time 判定。
    if (!isStatusActiveAt(status, time, 'closed')) continue

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
  //
  // partial_aoe 走 read-only 路径：算 absorbed 给 finalDamage 显示，但不真正扣 remainingBarrier、
  // 不收集 consumedShields。partial_final_aoe 在阶段 A 按自身 candidateDamage 走完整 mutation，
  // 阶段 B 再按"段最坏一次"对剩余盾补刀。aoe / 坦专保持单次 mutation。
  const shieldStatuses: MitigationStatus[] = []
  for (const status of workingState.statuses) {
    const meta = getStatusById(status.statusId)
    if (!meta) continue
    // 盾的 isTankOnly 需与事件类型匹配：坦专盾只进死刑/普攻，群盾只进 aoe
    // 原因：一个盾状态实例的 remainingBarrier 代表单玩家一份，单体事件不该消耗"全队的份"
    if (!shieldFilter(meta, status)) continue
    if (status.remainingBarrier === undefined || status.remainingBarrier <= 0) continue
    if (isStatusActiveAt(status, time, 'closed')) {
      shieldStatuses.push(status)
    }
  }
  shieldStatuses.sort((a, b) => a.startTime - b.startTime)

  const statusUpdates = new Map<string, Partial<MitigationStatus>>()
  const consumedShields: Array<{ status: MitigationStatus; absorbed: number }> = []
  let playerDamage = candidateDamage

  // 阶段 A：本事件自身的"显示口径"扣盾——所有事件类型都跑，决定 finalDamage / appliedStatuses。
  // partial_aoe 在这里只 read，不写 statusUpdates / consumedShields；其它事件走完整 mutation。
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

    if (event.type !== 'partial_aoe') {
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
    }

    if (playerDamage <= 0) break
  }

  let damage = playerDamage

  // 临时盾减伤（仅本事件）：真实盾扣完后再扣，不动任何真实 status 的 remainingBarrier，
  // 不触发 onConsume、不进 appliedStatuses（有独立 section 展示）。candidateDamage 不变，
  // 故 candidateDamage − finalDamage 自然包含临时盾吸收量，供色块归类。
  const tempShieldTotal = (event.tempMitigations ?? [])
    .filter(tm => tm.type === 'shield')
    .reduce((sum, tm) => sum + Math.max(0, tm.value), 0)
  if (tempShieldTotal > 0) {
    damage = Math.max(0, damage - tempShieldTotal)
  }

  // 阶段 B（仅 partial_final_aoe）：按 max(自身 cd, segCandidateMax) 给剩余盾补差额。
  // 阶段 A 已按 candidateDamage 实扣过一遍，这里只补"effectiveDamage - candidateDamage"那部分。
  // displayed finalDamage（即 `damage`）不受影响——event.damage 是用户输入的单一权威。
  if (event.type === 'partial_final_aoe') {
    const segCandidateMax = partyState.segment?.segCandidateMax ?? 0
    const effectiveDamage = Math.max(candidateDamage, segCandidateMax)
    let extra = effectiveDamage - candidateDamage
    if (extra > 0) {
      for (const status of shieldStatuses) {
        const partial = statusUpdates.get(status.instanceId)
        const currentBarrier = partial?.remainingBarrier ?? status.remainingBarrier!
        if (currentBarrier <= 0) continue
        const absorbed = Math.min(extra, currentBarrier)
        extra -= absorbed
        const newBarrier = currentBarrier - absorbed
        if (newBarrier <= 0 && status.stack && status.stack > 1 && status.initialBarrier) {
          // stack 衰减不算"消耗殆尽"——与阶段 A 语义对齐
          statusUpdates.set(status.instanceId, {
            remainingBarrier: status.initialBarrier,
            stack: status.stack - 1,
          })
        } else {
          statusUpdates.set(status.instanceId, { remainingBarrier: newBarrier })
          if (newBarrier <= 0) {
            const alreadyMarked = consumedShields.some(
              c => c.status.instanceId === status.instanceId
            )
            if (!alreadyMarked) {
              // 阶段 A 在该 status 上扣的量 = 原始 remainingBarrier - 阶段 A 后的值
              const aAbsorb = status.remainingBarrier! - currentBarrier
              consumedShields.push({ status, absorbed: aAbsorb + absorbed })
            }
          }
        }
        if (extra <= 0) break
      }
    }
  }

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

  // Phase 5 onAfterDamage 由 simulate 主循环在 applyDamageToHp 之后跑——让反应式
  // 治疗（如礼仪之铃）看到 hp_after_damage 而非 hp_before，符合"先扣再回"语义。
  // calculate 输出 candidateDamage 让 simulate 拿到 phase 5 钩子需要的中间值。

  const mitigationPercentage =
    originalDamage > 0 ? ((originalDamage - damage) / originalDamage) * 100 : 0

  return {
    finalDamage: Math.max(0, Math.round(damage)),
    mitigationPercentage: Math.round(mitigationPercentage * 10) / 10,
    appliedStatuses,
    updatedPartyState,
    candidateDamage,
  }
}
