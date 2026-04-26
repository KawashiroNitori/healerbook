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
  MitigationStatusMetadata,
  StatusBeforeShieldContext,
  StatusExecutor,
} from '@/types/status'
import type { MitigationCategory } from '@/types/mitigation'
import { addStatus, removeStatus, updateStatusData } from '@/executors/statusHelpers'
import { isStatusValidForTank } from '@/utils/statusFilter'

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
  /** performance.maxHP 倍率（1 = 无影响，> 1 增加最大 HP）；缺省为 1 */
  maxHP?: number
  /** 状态自身的副作用钩子（可选） */
  executor?: StatusExecutor
  /** 分类 tag，通常复刻自产生本状态的 MitigationAction.category */
  category?: MitigationCategory[]
}

/** statusId → 本地补充字段 */
export const STATUS_EXTRAS: Record<number, StatusExtras> = {
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

  // 白魔法师

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
      onExpire: () => {
        // TODO: 大地星爆炸治疗逻辑
      },
    },
  },
  1890: {
    name: '天宫图',
    category: ['partywide', 'heal'],
    isFriendly: true,
    executor: {
      onExpire: () => {
        // TODO: 天宫图治疗逻辑
      },
    },
  },
  1891: {
    name: '阳星天宫图',
    category: ['partywide', 'heal'],
    isFriendly: true,
    executor: {
      onExpire: () => {
        // TODO: 阳星天宫图治疗逻辑
      },
    },
  },
  2718: {
    name: '大宇宙',
    category: ['partywide', 'heal'],
    isFriendly: true,
    executor: {
      // 累计非 T 职业受到的实际伤害；坦专事件（tankbuster / auto）跳过——非 T 不吃伤。
      // 读取最新 data 必须从 ctx.partyState.statuses 里 find 同 instanceId（onAfterDamage 的
      // ctx.status 是原始快照，data 字段可能落后于本事件 onConsume 等修改）。
      onAfterDamage: ctx => {
        if (ctx.event.type === 'tankbuster' || ctx.event.type === 'auto') return
        const current = ctx.partyState.statuses.find(s => s.instanceId === ctx.status.instanceId)
        const prev = (current?.data?.nonTankDamageTotal as number | undefined) ?? 0
        return updateStatusData(ctx.partyState, ctx.status.instanceId, {
          nonTankDamageTotal: prev + ctx.finalDamage,
        })
      },
      onExpire: () => {
        // TODO: 大宇宙治疗逻辑（按 ctx.status.data.nonTankDamageTotal 推导）
      },
    },
  },
}
