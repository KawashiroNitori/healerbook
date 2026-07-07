/**
 * HP 池演算管道。
 *
 * 从 mitigationCalculator.simulate 抽出：封装 hp.max 同步（recomputeHpMax）、
 * 伤害落池（applyDamageToHp）、治疗 / tick 记录，以及 hpTimeline / healSnapshots
 * 与 lastKnownHp / lastKnownHpMax 影子状态。
 *
 * 影子状态 lastKnownHp / lastKnownHpMax 封装在 createHpPipeline 的工厂闭包内，
 * 不再作为 simulate 的外层局部变量泄漏。recomputeHpMax / applyDamageToHp 的函数体
 * 从 mitigationCalculator 逐字迁移（含盾扣减 / overkill / partial 各分支），一个
 * 字符都不改，保证 simulate 的对外产物（hpTimeline / healSnapshots / 每个
 * DamageEvent 的 HpSimulationSnapshot）与迁移前完全一致。
 */

import type { PartyState } from '@/types/partyState'
import type { DamageEvent } from '@/types/timeline'
import type { HealSnapshot } from '@/types/healSnapshot'
import type { HpTimelinePoint } from '@/types/hpTimeline'
import type { HpSimulationSnapshot } from '@/types/calculation'
import { MITIGATION_DATA } from '@/data/mitigationActions'
import { getStatusById, STATUS_ABILITY_OFFSET } from '@/utils/statusRegistry'
import { computeMaxHpMultiplier } from '@/executors/healMath'
import { formatTimeWithDecimal } from '@/utils/formatters'

/**
 * 重算 hp.max（按 active 非坦专 maxHP buff 累乘），按比例同步伸缩 hp.current。
 * 在每次 status mutation（applyExecutor / advanceToTime expire / onConsume）后调用。
 */
function recomputeHpMax(state: PartyState): PartyState {
  if (!state.hp) return state
  const newMultiplier = computeMaxHpMultiplier(state.statuses, state.timestamp, getStatusById)
  const prevMultiplier = state.hp.max / state.hp.base
  if (Math.abs(newMultiplier - prevMultiplier) < 1e-9) return state

  const ratio = newMultiplier / prevMultiplier
  // Round 后避免浮点误差（Math.round 与 computeReferenceMaxHP 口径一致）。
  // hp.current 也 round——maxHP 缩放是写 hp 的链路之一，与 computeFinalHeal /
  // calculate.finalDamage 出口取整对齐，保证 hp.current 始终整数。
  const newMax = Math.round(state.hp.base * newMultiplier)
  const newCurrent = Math.max(0, Math.min(Math.round(state.hp.current * ratio), newMax))

  return { ...state, hp: { ...state.hp, current: newCurrent, max: newMax } }
}

/**
 * 按事件类型扣 HP 池，处理 partial 段累积；同时维护 partyState.segment。
 *
 * 段累积器读写：
 *   aoe                → 段重置（inSegment=false, segMax/segCandidateMax=0），扣全额
 *   partial_aoe        → 进/留段内，segMax / segCandidateMax 累加 max
 *   partial_final_aoe  → 累加后段结束（inSegment=false, segMax/segCandidateMax=0）
 *   tankbuster / auto  → 段不动，HP 不入池
 *
 * candidateDamage 来自 calculate 输出，用于驱动 segCandidateMax —— partial_final_aoe
 * 的延迟结算需要这个值。partial_aoe 在 Phase 3 走 read-only 路径，event 自身的
 * finalDamage 在盾够大时为 0，不能驱动 segCandidateMax；必须用 candidateDamage。
 *
 * 坦专事件（tankbuster / auto）不入池，snapshot 为 undefined。
 */
function applyDamageToHp(
  state: PartyState,
  ev: DamageEvent,
  finalDamage: number,
  candidateDamage: number
): { nextState: PartyState; snapshot?: HpSimulationSnapshot } {
  if (ev.type === 'tankbuster' || ev.type === 'auto') {
    return { nextState: state }
  }

  // 段累积：先把段更新到"含本事件"的状态，再算扣血量
  const prevSegment = state.segment ?? {
    inSegment: false,
    segMax: 0,
    segCandidateMax: 0,
    segOriginalMax: 0,
  }

  let nextSegment = prevSegment
  let snapshotSegOriginalMax: number | undefined
  if (ev.type === 'aoe') {
    nextSegment = { inSegment: false, segMax: 0, segCandidateMax: 0, segOriginalMax: 0 }
  } else if (ev.type === 'partial_aoe' || ev.type === 'partial_final_aoe') {
    const baseSeg = prevSegment.inSegment
      ? prevSegment
      : { inSegment: true, segMax: 0, segCandidateMax: 0, segOriginalMax: 0 }
    // snapshot 暴露给 UI 的"最高区间伤害"= 段进入本事件前的最大 event.damage（不含自身），
    // 否则本事件就是段最大时会退化成"最高 = 原始 = 自身、结算 = 0"，不携带信息。
    // nextSegment.segOriginalMax 仍维护含自身的最大值，给下一事件用。
    snapshotSegOriginalMax = baseSeg.segOriginalMax
    nextSegment = {
      inSegment: ev.type === 'partial_final_aoe' ? false : true,
      segMax: ev.type === 'partial_final_aoe' ? 0 : Math.max(baseSeg.segMax, finalDamage),
      segCandidateMax:
        ev.type === 'partial_final_aoe' ? 0 : Math.max(baseSeg.segCandidateMax, candidateDamage),
      segOriginalMax:
        ev.type === 'partial_final_aoe' ? 0 : Math.max(baseSeg.segOriginalMax, ev.damage),
    }
  }

  if (!state.hp) {
    return { nextState: { ...state, segment: nextSegment } }
  }
  const hp = state.hp

  const before = hp.current
  let nextCurrent = hp.current
  let dealt = 0
  let snapshotSegMax: number | undefined
  let snapshotPreShieldDealt: number | undefined

  if (ev.type === 'aoe') {
    dealt = finalDamage
    nextCurrent -= finalDamage
  } else if (ev.type === 'partial_aoe' || ev.type === 'partial_final_aoe') {
    // 用"段进入本事件前的 segMax / segCandidateMax"算增量；结算事件 nextSegment 已清零。
    const segMaxBefore = prevSegment.inSegment ? prevSegment.segMax : 0
    const segCandidateMaxBefore = prevSegment.inSegment ? prevSegment.segCandidateMax : 0
    const newSegMax = Math.max(segMaxBefore, finalDamage)
    dealt = Math.max(0, finalDamage - segMaxBefore)
    nextCurrent -= dealt
    snapshotSegMax = newSegMax
    snapshotPreShieldDealt = Math.max(0, candidateDamage - segCandidateMaxBefore)
  }

  const overkill = Math.max(0, dealt - before)
  nextCurrent = Math.max(0, Math.min(nextCurrent, hp.max))

  return {
    nextState: {
      ...state,
      hp: { ...hp, current: nextCurrent },
      segment: nextSegment,
    },
    snapshot: {
      hpBefore: before,
      hpAfter: nextCurrent,
      hpMax: hp.max,
      segMax: snapshotSegMax,
      segOriginalMax: snapshotSegOriginalMax,
      preShieldDealt: snapshotPreShieldDealt,
      overkill: overkill > 0 ? overkill : undefined,
    },
  }
}

/**
 * HP 池演算管道：封装 hp.max 同步、伤害扣减、治疗 / tick 记录与
 * hpTimeline / healSnapshots 影子状态。
 */
export interface HpPipeline {
  /** recomputeHpMax + max 变化时记 hpTimeline（原 recomputeAndTrack 闭包） */
  recomputeAndTrack(state: PartyState, time: number): PartyState
  /**
   * 治疗快照回调（原 recordHeal 闭包）；供 SimulateInput 的钩子链使用。
   * skipHpPipeline 时为 undefined，让 executor 的 ctx.recordHeal?.(...) 走 optional
   * chaining 短路，降低无效对象构造与日志开销。
   */
  recordHeal: ((snap: HealSnapshot) => void) | undefined
  /** 伤害落 HP 池（原 applyDamageToHp）+ damage 点记录，返回新 state 与快照 */
  applyDamage(
    state: PartyState,
    ev: DamageEvent,
    finalDamage: number,
    candidateDamage: number
  ): {
    nextState: PartyState
    snapshot: HpSimulationSnapshot | undefined
  }
  /**
   * 显式的 hpTimeline 点记录入口（原 simulate 主循环 body 内对 hpTimeline 的直写，
   * 典型是 init 点）。push 点的同时按 point.hp / point.hpMax 回填影子状态。
   * skipHpPipeline 时短路，不 push、不回填。
   */
  recordTimelinePoint(point: HpTimelinePoint): void
  /** 收尾：按 time 升序排序并返回 hpTimeline / healSnapshots（skipHpPipeline 时为空数组） */
  finish(): { hpTimeline: HpTimelinePoint[]; healSnapshots: HealSnapshot[] }
}

export function createHpPipeline(opts: {
  skipHpPipeline: boolean
  /** 保留以对齐 brief 契约；影子状态由 recordTimelinePoint(init) 首次回填，此处不消费。 */
  initialState: PartyState
}): HpPipeline {
  const { skipHpPipeline } = opts

  const healSnapshots: HealSnapshot[] = []
  const hpTimeline: HpTimelinePoint[] = []
  // 闭包变量：跟踪"最近已知 hp 值"，让 recordHeal 在钩子还未 return 新 state 时也能正确回填
  let lastKnownHp = 0
  let lastKnownHpMax = 0

  const recomputeAndTrack = (state: PartyState, time: number): PartyState => {
    const next = recomputeHpMax(state)
    if (!skipHpPipeline && state.hp && next.hp && state.hp.max !== next.hp.max) {
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

  // skipHpPipeline 时 recordHeal 设为 undefined：让 executor 的 ctx.recordHeal?.(...)
  // 调用直接走 optional chaining 短路；降低无效对象构造与日志开销。
  const recordHeal = skipHpPipeline
    ? undefined
    : (snap: HealSnapshot) => {
        healSnapshots.push(snap)
        // 治疗后 hp = 当前已知 hp + applied（钩子里还没 return，所以 lastKnown 还是治疗前的 hp.current）
        const prevHp = lastKnownHp
        const hpAfter = Math.min(prevHp + snap.applied, lastKnownHpMax)
        hpTimeline.push({
          time: snap.time,
          hp: hpAfter,
          hpMax: lastKnownHpMax,
          kind: snap.isHotTick ? 'tick' : 'heal',
          // castEventId 为空字符串时转 undefined，与 refEventId 语义一致（无来源 cast）
          refEventId: snap.castEventId || undefined,
        })
        lastKnownHp = hpAfter

        // 调试日志：每次治疗的时间 / 技能名 / prevHP / afterHP / 变化量。
        // actionId 形如 1e6+statusId（healByAbility 中 buff 类治疗的 key 形式，如全大赦
        // 给医治追加的附属治疗 amountSourceId=1001219）时反查 statusRegistry 拿 buff 名。
        // 仅 DEV 构建保留；生产期 import.meta.env.DEV 常量折叠成 false → 整段 DCE，
        // 包含 actionName 反查（每条 snap 一次 MITIGATION_DATA.actions.find）的运行期开销。
        if (import.meta.env.DEV) {
          const actionName = (() => {
            const action = MITIGATION_DATA.actions.find(a => a.id === snap.actionId)
            if (action) return action.name
            if (snap.actionId >= STATUS_ABILITY_OFFSET) {
              const status = getStatusById(snap.actionId - STATUS_ABILITY_OFFSET)
              if (status) return status.name
            }
            return `action#${snap.actionId}`
          })()
          const tag = snap.isHotTick ? 'HoT' : 'cast'
          const overhealNote = snap.overheal > 0 ? ` (overheal ${snap.overheal})` : ''
          console.log(
            `[hp-sim heal] ${formatTimeWithDecimal(snap.time)} [${tag}] ${actionName}: ${prevHp} → ${hpAfter} (+${snap.applied})${overhealNote}`
          )
        }
      }

  const applyDamage = (
    state: PartyState,
    ev: DamageEvent,
    finalDamage: number,
    candidateDamage: number
  ): { nextState: PartyState; snapshot: HpSimulationSnapshot | undefined } => {
    const { nextState: stateAfterHp, snapshot: hpSnap } = applyDamageToHp(
      state,
      ev,
      finalDamage,
      candidateDamage
    )
    if (!skipHpPipeline && stateAfterHp.hp) {
      lastKnownHp = stateAfterHp.hp.current
      lastKnownHpMax = stateAfterHp.hp.max
      hpTimeline.push({
        time: ev.time,
        hp: lastKnownHp,
        hpMax: lastKnownHpMax,
        kind: 'damage',
        refEventId: ev.id,
      })
    }
    return { nextState: stateAfterHp, snapshot: hpSnap }
  }

  const recordTimelinePoint = (point: HpTimelinePoint): void => {
    if (skipHpPipeline) return
    lastKnownHp = point.hp
    lastKnownHpMax = point.hpMax
    hpTimeline.push(point)
  }

  const finish = (): { hpTimeline: HpTimelinePoint[]; healSnapshots: HealSnapshot[] } => {
    // 按 time 升序：cast / HoT tick 自然按主循环时序入列，但 calculate 内部钩子（onConsume /
    // onAfterDamage）的 recordHeal 与同时刻 advanceToTime 先 fire 的 onTick 入列顺序依赖
    // 主循环执行顺序，出口处显式排序避免下游消费者依赖隐式约定。
    // skipHpPipeline 下两个数组都是空，跳排序。
    if (!skipHpPipeline) {
      healSnapshots.sort((a, b) => a.time - b.time)
      // JS Array.sort 是稳定排序（ES2019+），同时刻 push 顺序（主循环内序）得以保留。
      hpTimeline.sort((a, b) => a.time - b.time)
    }
    return { hpTimeline, healSnapshots }
  }

  return { recomputeAndTrack, recordHeal, applyDamage, recordTimelinePoint, finish }
}
