/**
 * 状态元数据本地补充表
 *
 * 3rd party `keigenns` 提供基础数据（id / name / type / performance / isFriendly 等），
 * 本表按 statusId 提供本地扩展字段的覆盖值；同名 base 字段也可在此覆盖（extras 优先）。
 *
 * 当 statusId 在第三方 keigenns 中不存在时，本表条目必须自带 `name` / `isFriendly`
 * 两项基础字段，registry 初始化时会校验并 fail-fast；`type` 可缺省（视为不参与
 * % 减伤、不算盾的 executor-only 状态）；`performance` 缺省视为
 * `{ physics: 1, magic: 1, darkness: 1 }`（不减伤）。
 */

import type {
  KeigennType,
  PerformanceType as ExternalPerformanceType,
} from '../../3rdparty/ff14-overlay-vue/src/types/keigennRecord2'
import type {
  MitigationStatus,
  MitigationStatusMetadata,
  StatusBeforeShieldContext,
  StatusExecutor,
} from '@/types/status'
import type { MitigationCategory } from '@/types/mitigation'
import type { PartyState } from '@/types/partyState'
import type { TimelineStatData } from '@/types/statData'
import type { HealSnapshot } from '@/types/healSnapshot'
import { addStatus, removeStatus, updateStatus, updateStatusData } from '@/executors/statusHelpers'
import { isStatusValidForTank } from '@/utils/statusFilter'
import { regenStatusExecutor } from '@/executors/regenStatusExecutor'
import { applyDirectHeal } from '@/executors/applyDirectHeal'
import { computeFinalHeal } from '@/executors/healMath'

/**
 * 创建"按需生成盾值"的 onBeforeShield 钩子。
 *
 * 在编辑模式下假设坦克满血，盾值 = candidateDamage − 已有坦专盾 − referenceMaxHP + 1，
 * 即刚好让坦克活下来的最小值；若已有盾值足够则不分配。
 *
 * 已有坦专盾的统计需按 self/target 过滤到"真正罩在持有本无敌的坦克身上"的那部分，
 * 与 calculator 多坦路径 Phase 3 的 `meta.isTankOnly && isStatusValidForTank(..., tankId)`
 * 口径保持一致，避免把另一个坦克身上的坦专盾误算进来。
 */
export function createSurvivalBarrierHook() {
  return (ctx: StatusBeforeShieldContext) => {
    const protectedTankId = ctx.status.sourcePlayerId
    const tankOnlyShield = ctx.partyState.statuses
      .filter(s => {
        if (s.remainingBarrier === undefined || s.remainingBarrier <= 0) return false
        if (ctx.event.time < s.startTime || ctx.event.time > s.endTime) return false
        const extras = STATUS_EXTRAS[s.statusId]
        if (extras?.isTankOnly !== true) return false
        if (protectedTankId === undefined) return true
        return isStatusValidForTank(
          { category: extras.category } as MitigationStatusMetadata,
          s,
          protectedTankId
        )
      })
      .reduce((sum, s) => sum + (s.remainingBarrier ?? 0), 0)

    const requiredShield = ctx.candidateDamage - tankOnlyShield - ctx.referenceMaxHP + 1

    if (requiredShield <= 0) return ctx.partyState

    return {
      ...ctx.partyState,
      statuses: ctx.partyState.statuses.map(s =>
        s.instanceId === ctx.status.instanceId
          ? {
              ...s,
              remainingBarrier: requiredShield,
              initialBarrier: requiredShield,
            }
          : s
      ),
    }
  }
}

/**
 * status 钩子内触发一次性直接治疗的 helper。
 *
 * 等价于 createHealExecutor，但作用域是 status 钩子（onAfterDamage / onConsume / onExpire 等）：
 *   - baseAmount 取 statistics.healByAbility[healActionId]
 *   - castEventId / sourcePlayerId 从 ctx.status 读（创建该 status 的 cast 在 data.castEventId 里）
 *   - 触发时刻取 ctx.partyState.timestamp——simulate 在每种钩子触发前都把 timestamp 推进到
 *     当前时刻（onTick → tickTime、onExpire → expireTime、Phase 2-5 钩子 → event.time），
 *     不需要调用方再显式传时间
 *   - 调用 applyDirectHeal 走 buff 倍率 + recordHeal 链路
 *
 * 不处理 stack / 冷却 / 移除——这些由调用方钩子自己负责（与本 helper 解耦）。
 */
function triggerStatusHeal(
  ctx: {
    status: MitigationStatus
    partyState: PartyState
    statistics?: TimelineStatData
    recordHeal?: (snap: HealSnapshot) => void
  },
  opts: { healActionId: number }
): PartyState {
  const baseAmount = ctx.statistics?.healByAbility?.[opts.healActionId] ?? 0
  return applyDirectHeal(
    ctx.partyState,
    baseAmount,
    {
      castEventId: (ctx.status.data?.castEventId as string | undefined) ?? '',
      actionId: opts.healActionId,
      sourcePlayerId: ctx.status.sourcePlayerId ?? 0,
      time: ctx.partyState.timestamp,
    },
    ctx.recordHeal
  )
}

/**
 * "盾被消耗 → 派生 HoT" 链式生成器（如 神爱抚 3903 → 神爱环 3904、守护纹 2597 → 活性纹 2598）。
 *
 * 在 onConsume / onExpire 时刻先把父盾摘掉，再对当前 partyState snapshot 治疗倍率，
 * 把每 tick 量写进子 status 的 data.tickAmount——之后 regenStatusExecutor.onTick 直接消费。
 * 子 HoT 每 tick 基础量约定存在 healByAbility[1e6 + childStatusId]。
 */
function spawnRegenChild(
  state: PartyState,
  parent: MitigationStatus,
  childStatusId: number,
  duration: number,
  time: number,
  statistics?: TimelineStatData
): PartyState {
  const cleared = removeStatus(state, parent.instanceId)
  const baseTickAmount = statistics?.healByAbility?.[1e6 + childStatusId] ?? 0
  const snapshotTickAmount = computeFinalHeal(
    baseTickAmount,
    cleared,
    parent.sourcePlayerId ?? 0,
    time
  )
  return addStatus(cleared, {
    statusId: childStatusId,
    eventTime: time,
    duration,
    sourcePlayerId: parent.sourcePlayerId,
    sourceActionId: parent.sourceActionId,
    data: { tickAmount: snapshotTickAmount, castEventId: '' },
  })
}

/** 单个状态的本地补充字段 */
export interface StatusExtras {
  // ── 基础字段（仅当 statusId 不在第三方 keigenns 中时必需；存在时作为 override）──
  /** 状态名称；缺省取 keigenn.name */
  name?: string
  /**
   * 状态类型 multiplier | absorbed；缺省取 keigenn.type；都缺省视为不参与
   * % 减伤、不算盾（calculator Phase 1 与所有 `=== 'absorbed'` 二分点皆 fall-through），
   * 适合纯靠 executor 起作用的状态（如延迟治疗 / 标记类 buff）。
   */
  type?: KeigennType
  /** 是否友方；缺省取 keigenn.isFriendly */
  isFriendly?: boolean
  /** physics/magic/darkness 减伤数据；缺省取 keigenn.performance；都缺省视为 {1,1,1} */
  performance?: ExternalPerformanceType
  /** 图标 url；缺省取 keigenn.fullIcon */
  fullIcon?: string

  // ── 本地扩展字段 ──
  /** 是否仅对坦克生效；缺省为 false */
  isTankOnly?: boolean
  /** performance.heal 倍率（1 = 无影响，> 1 增疗）；缺省为 1 */
  heal?: number
  /** performance.selfHeal 倍率（仅 buff 持有者本人施治时生效）；缺省为 1 */
  selfHeal?: number
  /** performance.maxHP 倍率（1 = 无影响，> 1 增加最大 HP）；缺省为 1 */
  maxHP?: number
  /** 状态自身的副作用钩子（可选） */
  executor?: StatusExecutor
  /** 分类 tag，通常复刻自产生本状态的 MitigationAction.category */
  category?: MitigationCategory[]
}

/** statusId → 本地补充字段 */
export const STATUS_EXTRAS: Record<number, StatusExtras> = {
  // 目标减（降低 boss 输出的 debuff）
  1193: { category: ['partywide', 'percentage', 'boss'] }, // 雪仇（目标减）
  1195: { category: ['partywide', 'percentage', 'boss'] }, // 牵制（目标减）
  860: { category: ['partywide', 'percentage', 'boss'] }, // 武装解除（目标减）
  1203: { category: ['partywide', 'percentage', 'boss'] }, // 昏乱（目标减）

  // T 通用

  1191: { isTankOnly: true, heal: 1.15, category: ['self', 'percentage'] }, // 铁壁

  // 骑士
  74: { isTankOnly: true, category: ['self', 'percentage'] }, // 预警
  1856: { isTankOnly: true, category: ['self', 'percentage'] }, // 盾阵
  2674: { isTankOnly: true, category: ['self', 'percentage'] }, // 圣盾阵
  82: { isTankOnly: true, category: ['self', 'percentage'] }, // 神圣领域
  77: { isTankOnly: true, category: ['self', 'percentage'] }, // 壁垒
  1174: { isTankOnly: true, category: ['target', 'percentage'] }, // 干预
  2675: { isTankOnly: true, category: ['self', 'target', 'percentage'] }, // 骑士的坚守
  3829: { isTankOnly: true, category: ['self', 'percentage'] }, // 极致防御
  3830: { isTankOnly: true, category: ['self', 'shield'] }, // 极致护盾

  // 战士
  87: { isTankOnly: true, heal: 1.2, maxHP: 1.2, category: ['self'] }, // 战栗
  89: { isTankOnly: true, category: ['self', 'percentage'] }, // 复仇
  3832: { isTankOnly: true, category: ['self', 'percentage'] }, // 戮罪

  // 死斗
  409: {
    isTankOnly: true,
    category: ['self', 'shield'],
    executor: { onBeforeShield: createSurvivalBarrierHook() },
  },
  2108: {
    name: '摆脱',
    category: ['partywide', 'heal'],
    isFriendly: true,
    executor: regenStatusExecutor,
  },

  735: { isTankOnly: true, category: ['self', 'percentage'] }, // 原初的直觉
  1858: { isTankOnly: true, category: ['self', 'percentage'] }, // 原初的武猛
  2678: { isTankOnly: true, category: ['self', 'percentage'] }, // 原初的血气
  2679: { isTankOnly: true, category: ['self', 'percentage'] }, // 原初的血潮
  2680: { isTankOnly: true, category: ['self', 'shield'] }, // 原初的血烟

  // 暗骑
  747: { isTankOnly: true, category: ['self', 'percentage'] }, // 暗影墙
  3835: { isTankOnly: true, category: ['self', 'percentage'] }, // 暗影卫
  746: { isTankOnly: true, category: ['self', 'percentage'] }, // 弃明投暗

  // 行尸走肉
  810: {
    isTankOnly: true,
    category: ['self', 'percentage'],
    executor: {
      onBeforeShield: createSurvivalBarrierHook(),
      onConsume: ctx => {
        const next = removeStatus(ctx.partyState, ctx.status.instanceId)
        return addStatus(next, {
          statusId: 3255,
          eventTime: ctx.event.time,
          duration: 10,
          sourcePlayerId: ctx.status.sourcePlayerId,
        })
      },
    },
  },

  811: {
    isTankOnly: true,
    category: ['self', 'percentage'],
    executor: { onBeforeShield: createSurvivalBarrierHook() },
  }, // 死而不僵
  3255: {
    isTankOnly: true,
    category: ['self', 'percentage'],
    executor: { onBeforeShield: createSurvivalBarrierHook() },
  }, // 出死入生
  1178: { isTankOnly: true, category: ['self', 'target', 'shield'] }, // 至黑之夜
  2682: { isTankOnly: true, category: ['self', 'target', 'percentage'] }, // 献奉

  // 绝枪
  1832: { isTankOnly: true, category: ['self', 'percentage'] }, // 伪装
  1834: { isTankOnly: true, category: ['self', 'percentage'] }, // 星云
  3838: { isTankOnly: true, maxHP: 1.2, category: ['self', 'percentage'] }, // 大星云
  1836: { isTankOnly: true, category: ['self', 'percentage'] }, // 超火流星
  1840: { isTankOnly: true, category: ['self', 'target', 'percentage'] }, // 石之心
  2683: { isTankOnly: true, category: ['self', 'target', 'percentage'] }, // 刚玉之心
  2684: { isTankOnly: true, category: ['self', 'target', 'percentage'] }, // 刚玉之清

  // 武僧
  102: { name: '真言', isFriendly: true, category: ['partywide'], heal: 1.1 },

  // 镰刀
  // 守护纹：盾被完全打穿时挂 15s 的活性纹 (2598) HoT。
  // 仅"盾被消耗殆尽"触发（不在自然到期触发），与 Arcane Crest 的 Crest of Time Returned 语义一致。
  2597: {
    name: '守护纹',
    isFriendly: true,
    category: ['partywide', 'shield'],
    executor: {
      onConsume: ctx =>
        spawnRegenChild(ctx.partyState, ctx.status, 2598, 15, ctx.event.time, ctx.statistics),
    },
  },
  2598: {
    name: '活性纹',
    isFriendly: true,
    category: ['partywide', 'heal'],
    executor: regenStatusExecutor,
  },

  // 诗人
  1202: { name: '大地神的抒情恋歌', isFriendly: true, category: ['partywide'], heal: 1.15 },

  // 舞者
  // 即兴表演：每个 tick 给即兴层数 (2696) +1（最大 5 层），层数 buff 与 1827 同生共死。
  1827: {
    name: '即兴表演',
    isFriendly: true,
    category: [],
    executor: {
      onTick: ctx => {
        const STACK_ID = 2696
        const MAX_STACK = 5
        const existing = ctx.partyState.statuses.find(
          s => s.statusId === STACK_ID && s.sourcePlayerId === ctx.status.sourcePlayerId
        )
        // 首次：新建层数 buff，存活区间对齐 1827 的 [startTime, endTime]
        if (!existing) {
          return addStatus(ctx.partyState, {
            statusId: STACK_ID,
            eventTime: ctx.status.startTime,
            duration: ctx.status.endTime - ctx.status.startTime,
            stack: 1,
            sourcePlayerId: ctx.status.sourcePlayerId,
            sourceActionId: ctx.status.sourceActionId,
          })
        }
        // 后续：保持 instanceId，仅 +1 层（封顶 5）并把到期时间继续对齐 1827
        return updateStatus(ctx.partyState, existing.instanceId, {
          stack: Math.min((existing.stack ?? 1) + 1, MAX_STACK),
          endTime: ctx.status.endTime,
        })
      },
    },
  },
  2696: { name: '舞动的热情', isFriendly: true, category: [] }, // 由 1827 onTick 累积，决定即兴表演结束 (2697) 盾量

  // 白魔法师
  1873: { selfHeal: 1.2 }, // 节制
  3880: {
    name: '医养',
    category: ['partywide', 'heal'],
    isFriendly: true,
    executor: regenStatusExecutor,
  },
  1911: {
    name: '庇护所',
    category: ['partywide', 'heal'],
    isFriendly: true,
    heal: 1.1,
    executor: regenStatusExecutor,
  },
  2709: {
    name: '礼仪之铃',
    category: ['partywide', 'heal'],
    isFriendly: true,
    executor: {
      // 实际伤害 > 0 且距上次触发 > 1s 时治疗一次并消耗一层；扣到 0 移除。
      onAfterDamage: ctx => {
        if (ctx.finalDamage <= 0) return
        const current = ctx.partyState.statuses.find(s => s.instanceId === ctx.status.instanceId)
        if (!current) return
        const lastTriggerTime = current.data?.lastTriggerTime as number | undefined
        if (lastTriggerTime !== undefined && ctx.event.time - lastTriggerTime <= 1) return

        const stateAfterHeal = triggerStatusHeal(ctx, { healActionId: 25863 })

        const newStack = (current.stack ?? 1) - 1
        if (newStack <= 0) {
          return removeStatus(stateAfterHeal, ctx.status.instanceId)
        }
        return updateStatus(
          updateStatusData(stateAfterHeal, ctx.status.instanceId, {
            lastTriggerTime: ctx.event.time,
          }),
          ctx.status.instanceId,
          { stack: newStack }
        )
      },
      // 自然到期时回复剩余层数的治疗：每层 = healByAbility[25863] / 2，与手动收铃铛
      // （mitigationActions.ts 的 28509）口径一致。被打空层数提前 removeStatus 的不会走到这里。
      onExpire: ctx => {
        const remainingStacks = ctx.status.stack ?? 1
        const baseAmount = ((ctx.statistics?.healByAbility?.[25863] ?? 0) / 2) * remainingStacks
        return applyDirectHeal(
          ctx.partyState,
          baseAmount,
          {
            castEventId: (ctx.status.data?.castEventId as string | undefined) ?? '',
            actionId: 25863,
            sourcePlayerId: ctx.status.sourcePlayerId ?? 0,
            time: ctx.expireTime,
          },
          ctx.recordHeal
        )
      },
    },
  },
  3903: {
    name: '神爱抚',
    category: ['partywide', 'shield'],
    isFriendly: true,
    executor: {
      // 盾被打穿 / 自然到期后挂 15s 的神爱环 (3904) HoT。
      // tickAmount 在生成时刻 snapshot（与 createRegenExecutor 的 cast-time 口径一致），
      // 之后由 regenStatusExecutor.onTick 直接消费 status.data.tickAmount。
      onConsume: ctx =>
        spawnRegenChild(ctx.partyState, ctx.status, 3904, 15, ctx.event.time, ctx.statistics),
      onExpire: ctx =>
        spawnRegenChild(ctx.partyState, ctx.status, 3904, 15, ctx.expireTime, ctx.statistics),
    },
  },
  3904: {
    name: '神爱环',
    category: ['partywide', 'heal'],
    isFriendly: true,
    executor: regenStatusExecutor,
  },

  // 学者
  315: {
    name: '仙光的低语',
    category: ['partywide', 'heal'],
    isFriendly: true,
    executor: regenStatusExecutor,
  },
  317: {
    name: '异想的幻光',
    category: ['partywide', 'percentage'],
    heal: 1.1,
    isFriendly: true,
  },
  791: {
    name: '转化',
    category: ['self'],
    isFriendly: true,
    selfHeal: 1.2,
  },
  1944: {
    name: '野战治疗阵',
    category: ['partywide', 'heal'],
    isFriendly: true,
    executor: regenStatusExecutor,
  },
  3885: {
    name: '炽天之光',
    category: ['partywide', 'heal'],
    isFriendly: true,
    executor: regenStatusExecutor,
  },

  // 占星术士
  1224: {
    name: '地星主宰',
    category: ['self', 'heal'],
    isFriendly: true,
    executor: {
      // 到期变身为 1248（巨星主宰），保持 instanceId 让绿条连续
      onExpire: ctx => ({
        ...ctx.partyState,
        statuses: ctx.partyState.statuses.map(s =>
          s.instanceId === ctx.status.instanceId
            ? { ...s, statusId: 1248, endTime: ctx.expireTime + 10 }
            : s
        ),
      }),
    },
  },
  1248: {
    name: '巨星主宰',
    category: ['self', 'heal'],
    isFriendly: true,
    executor: {
      onExpire: ctx => {
        return triggerStatusHeal(ctx, { healActionId: 7441 })
      },
    },
  },
  956: {
    name: '命运之轮',
    category: ['partywide', 'heal'],
    isFriendly: true,
    executor: regenStatusExecutor,
  },
  1890: {
    name: '天宫图',
    category: ['partywide', 'heal'],
    isFriendly: true,
    executor: {
      onExpire: ctx => {
        return triggerStatusHeal(ctx, { healActionId: 1001890 })
      },
    },
  },
  1891: {
    name: '阳星天宫图',
    category: ['partywide', 'heal'],
    isFriendly: true,
    executor: {
      onExpire: ctx => {
        return triggerStatusHeal(ctx, { healActionId: 1001891 })
      },
    },
  },
  1892: {
    name: '中间学派',
    category: ['partywide', 'percentage'],
    isFriendly: true,
    selfHeal: 1.2,
  },
  3894: {
    name: '阳星合相',
    category: ['partywide', 'heal'],
    isFriendly: true,
    executor: regenStatusExecutor,
  },
  1879: {
    name: '天星冲日',
    category: ['partywide', 'heal'],
    isFriendly: true,
    executor: regenStatusExecutor,
  },
  2718: {
    name: '大宇宙',
    category: ['partywide', 'heal'],
    isFriendly: true,
    executor: {
      // 累计非 T 职业受到的实际伤害。坦专事件（tankbuster / auto）由 simulate 主循环统一拦在
      // phase 5 派发之外——此钩子根本不会在这类事件上被调用，故无需自行判 type。
      // 读取最新 data 必须从 ctx.partyState.statuses 里 find 同 instanceId（onAfterDamage 的
      // ctx.status 是原始快照，data 字段可能落后于本事件 onConsume 等修改）。
      onAfterDamage: ctx => {
        const current = ctx.partyState.statuses.find(s => s.instanceId === ctx.status.instanceId)
        const prev = (current?.data?.nonTankDamageTotal as number | undefined) ?? 0
        return updateStatusData(ctx.partyState, ctx.status.instanceId, {
          nonTankDamageTotal: prev + ctx.finalDamage,
        })
      },
      onExpire: ctx => {
        const accDamage = (ctx.status.data?.nonTankDamageTotal as number | undefined) ?? 0
        const healOfEarth = ctx.statistics?.healByAbility?.[7441] ?? 0
        const baseHeal = Math.round(healOfEarth * (200 / 720))
        const baseAmount = baseHeal + Math.round(accDamage * 0.5)
        return applyDirectHeal(
          ctx.partyState,
          baseAmount,
          {
            castEventId: (ctx.status.data?.castEventId as string | undefined) ?? '',
            actionId: 25874,
            sourcePlayerId: ctx.status.sourcePlayerId ?? 0,
            time: ctx.expireTime,
          },
          ctx.recordHeal
        )
      },
    },
  },
  2938: {
    name: '坚角清汁[回]',
    category: ['partywide', 'heal'],
    isFriendly: true,
    executor: regenStatusExecutor,
  },
  2620: {
    name: '自生II',
    category: ['partywide', 'percentage'],
    isFriendly: true,
    heal: 1.1,
    executor: regenStatusExecutor,
  },
  3899: {
    name: '幸福',
    category: ['partywide', 'heal'],
    isFriendly: true,
    executor: regenStatusExecutor,
    selfHeal: 1.2,
  },

  // 泛输血：自然到期时把剩余层数转换为直接回血，每层 = shieldByAbility[2613] / 2，
  // 与礼仪之铃 onExpire 的"剩余层数 → 回血"同款语义（仅数值源换成盾量）。
  // 盾被打空提前 removeStatus 的不会走到这里。回血归属记到泛输血 action(24311)。
  2613: {
    category: ['partywide', 'shield', 'heal'],
    executor: {
      onExpire: ctx => {
        const remainingStacks = ctx.status.stack ?? 1
        const baseAmount = ((ctx.statistics?.shieldByAbility?.[2613] ?? 0) / 2) * remainingStacks
        return applyDirectHeal(
          ctx.partyState,
          baseAmount,
          {
            castEventId: (ctx.status.data?.castEventId as string | undefined) ?? '',
            actionId: 24311,
            sourcePlayerId: ctx.status.sourcePlayerId ?? 0,
            time: ctx.expireTime,
          },
          ctx.recordHeal
        )
      },
    },
  },
}
