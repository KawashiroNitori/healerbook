/**
 * 减伤计算引擎（基于状态）
 * 实现核心减伤计算逻辑
 */

import type { PartyState } from '@/types/partyState'
import type { MitigationStatus, MitigationStatusMetadata, PerformanceType } from '@/types/status'
import type { DamageEvent, DamageType } from '@/types/timeline'
import { getStatusById } from '@/utils/statusRegistry'

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
    const singleMultiplierFilter = (meta: MitigationStatusMetadata) =>
      !(meta.isTankOnly && !includeTankOnly)
    const singleShieldFilter = (meta: MitigationStatusMetadata) =>
      meta.isTankOnly === includeTankOnly

    // referenceMaxHP 优先用 opts.referenceMaxHP（旧调用方已算好），否则由 baseReferenceMaxHP 叠乘
    const referenceMaxHP =
      opts?.referenceMaxHP ??
      this.computeReferenceMaxHP(event, partyState, opts?.baseReferenceMaxHP ?? 0, includeTankOnly)

    const branch = this.runSingleBranch(event, partyState, {
      multiplierFilter: singleMultiplierFilter,
      shieldFilter: singleShieldFilter,
      referenceMaxHP,
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
   * 计算指定事件在给定 includeTankOnly 过滤下的参考 HP（基线 × 活跃 buff maxHP 累乘）。
   */
  private computeReferenceMaxHP(
    event: DamageEvent,
    partyState: PartyState,
    base: number,
    includeTankOnly: boolean
  ): number {
    if (base <= 0) return 0
    const mitigationTime = event.snapshotTime ?? event.time
    let m = 1
    for (const status of partyState.statuses) {
      if (mitigationTime < status.startTime || mitigationTime > status.endTime) continue
      const meta = getStatusById(status.statusId)
      if (!meta) continue
      if (meta.isTankOnly && !includeTankOnly) continue
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
    const { multiplierFilter, shieldFilter, referenceMaxHP } = opts

    // Phase 1: % 减伤
    let multiplier = 1.0
    const appliedStatuses: MitigationStatus[] = []

    for (const status of partyState.statuses) {
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
