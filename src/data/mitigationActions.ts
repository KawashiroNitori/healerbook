/**
 * FF14 减伤技能数据（新版本 - 使用 executor 模式）
 * 数据来源: CafeMaker API
 * 版本: 7.1
 * 最后更新: 2026-02-21
 */

import type { MitigationAction } from '@/types/mitigation'
import { createBuffExecutor, createShieldExecutor, generateId } from '@/executors'
import type { ActionExecutionContext } from '@/types/mitigation'
import type { MitigationStatus } from '@/types/status'

export interface MitigationDataSource {
  actions: MitigationAction[]
}

export const MITIGATION_DATA: MitigationDataSource = {
  actions: [
    // ==================== 坦克技能 ====================

    // 雪仇 - 坦克目标减伤
    {
      id: 7535,
      name: '雪仇',
      icon: '/i/000000/000806.png',
      jobs: ['WAR', 'PLD', 'DRK', 'GNB'],
      duration: 15,
      cooldown: 60,
      executor: createBuffExecutor(1193, 15),
    },

    // 骑士 (PLD)
    {
      id: 3540,
      name: '圣光幕帘',
      icon: '/i/002000/002508.png',
      jobs: ['PLD'],
      duration: 30,
      cooldown: 90,
      executor: createShieldExecutor(1362, 30),
    },
    {
      id: 7385,
      name: '武装戍卫',
      icon: '/i/002000/002515.png',
      jobs: ['PLD'],
      duration: 5,
      cooldown: 120,
      executor: createBuffExecutor(1176, 5),
    },

    // 战士 (WAR)
    {
      id: 7388,
      name: '摆脱',
      icon: '/i/002000/002563.png',
      jobs: ['WAR'],
      duration: 30,
      cooldown: 90,
      executor: createShieldExecutor(1457, 30),
    },

    // 暗黑骑士 (DRK)
    {
      id: 16471,
      name: '暗黑布道',
      icon: '/i/003000/003087.png',
      jobs: ['DRK'],
      duration: 15,
      cooldown: 90,
      executor: createBuffExecutor(1894, 15),
    },

    // 绝枪战士 (GNB)
    {
      id: 16160,
      name: '光之心',
      icon: '/i/003000/003424.png',
      jobs: ['GNB'],
      duration: 15,
      cooldown: 90,
      executor: createBuffExecutor(1839, 15),
    },

    // ==================== 治疗职业技能 ====================

    // 白魔法师 (WHM)
    {
      id: 16536,
      name: '节制',
      icon: '/i/002000/002645.png',
      jobs: ['WHM'],
      duration: 25,
      cooldown: 120,
      executor: createBuffExecutor(1873, 25),
    },
    {
      id: 7433,
      name: '全大赦',
      icon: '/i/002000/002639.png',
      jobs: ['WHM'],
      duration: 10,
      cooldown: 60,
      executor: createBuffExecutor(1219, 10),
    },
    {
      id: 37011,
      name: '神爱抚',
      icon: '/i/002000/002128.png',
      jobs: ['WHM'],
      duration: 10,
      cooldown: 1,
      executor: createShieldExecutor(3903, 10),
    },

    // 学者 (SCH)
    // 展开战术 - 复制目标的鼓舞盾到所有成员（模拟为群体单盾）
    {
      id: 3585,
      name: '展开战术',
      icon: '/i/002000/002808.png',
      jobs: ['SCH'],
      duration: 30,
      cooldown: 90,
      executor: (ctx: ActionExecutionContext) => {
        const baseShieldId = 297 // 鼓舞
        const sageShieldId = 2609 // 贤者群盾
        // 因为群盾和单盾实际上对应的是同一个 buff id 但实际盾量不同，盾量预估只能使用单盾技能基础恢复力 * 180%
        const baseHeal = ctx.statistics?.healByAbility[185] ?? 10000
        const barrier = Math.round(baseHeal * 1.8)

        const newStatuses: MitigationStatus[] = []

        newStatuses.push({
          instanceId: generateId(),
          statusId: baseShieldId,
          startTime: ctx.useTime,
          endTime: ctx.useTime + 30,
          remainingBarrier: barrier,
          initialBarrier: barrier,
          sourceActionId: ctx.actionId,
          sourcePlayerId: ctx.sourcePlayerId,
        })

        const filteredStatuses = ctx.partyState.statuses.filter(
          s => ![baseShieldId, sageShieldId].includes(s.statusId)
        )

        return {
          ...ctx.partyState,
          statuses: [...filteredStatuses, ...newStatuses],
        }
      },
    },
    {
      id: 16542,
      name: '秘策',
      icon: '/i/002000/002822.png',
      jobs: ['SCH'],
      duration: 15,
      cooldown: 60,
      executor: createBuffExecutor(1896, 15),
    },

    // 意气轩昂之策 - 检测秘策状态附加额外盾值
    {
      id: 37013,
      name: '意气轩昂之策',
      icon: '/i/002000/002880.png',
      jobs: ['SCH'],
      duration: 30,
      cooldown: 2.5,
      executor: (ctx: ActionExecutionContext) => {
        const recitationId = 1896 // 秘策
        const baseShieldId = 297 // 鼓舞
        const sageShieldId = 2609 // 贤者群盾
        // 因为群盾和单盾实际上对应的是同一个 buff id 但实际盾量不同，盾量预估只能使用技能描述中的技能基础恢复力 * 180%
        const hasRecitation = ctx.partyState.statuses.some(s => s.statusId === recitationId)
        const baseHeal = hasRecitation
          ? (ctx.statistics?.critHealByAbility[37013] ?? 10000)
          : (ctx.statistics?.healByAbility[37013] ?? 10000)
        const barrier = Math.round(baseHeal * 1.8)

        const newStatuses: MitigationStatus[] = []

        newStatuses.push({
          instanceId: generateId(),
          statusId: baseShieldId,
          startTime: ctx.useTime,
          endTime: ctx.useTime + 30,
          remainingBarrier: barrier,
          initialBarrier: barrier,
          sourceActionId: ctx.actionId,
          sourcePlayerId: ctx.sourcePlayerId,
        })

        const filteredStatuses = ctx.partyState.statuses.filter(
          s => ![recitationId, baseShieldId, sageShieldId].includes(s.statusId)
        )

        return {
          ...ctx.partyState,
          statuses: [...filteredStatuses, ...newStatuses],
        }
      },
    },

    {
      id: 188,
      name: '野战治疗阵',
      icon: '/i/002000/002804.png',
      jobs: ['SCH'],
      duration: 18,
      cooldown: 30,
      executor: createBuffExecutor(299, 18),
    },

    {
      id: 16538,
      name: '异想的幻光',
      icon: '/i/002000/002826.png',
      jobs: ['SCH'],
      duration: 20,
      cooldown: 120,
      executor: createBuffExecutor(317, 20),
    },

    {
      id: 25868,
      name: '疾风怒涛之计',
      icon: '/i/002000/002878.png',
      jobs: ['SCH'],
      duration: 20,
      cooldown: 120,
      executor: createBuffExecutor(2711, 20),
    },

    {
      id: 16545,
      name: '炽天召唤',
      icon: '/i/002000/002850.png',
      jobs: ['SCH'],
      duration: 22,
      cooldown: 120,
      executor: createBuffExecutor(3095, 22),
    },

    {
      id: 16546,
      name: '慰藉',
      icon: '/i/002000/002851.png',
      jobs: ['SCH'],
      duration: 30,
      cooldown: 1,
      executor: createShieldExecutor(1917, 30),
    },

    {
      id: 37014,
      name: '炽天附体',
      icon: '/i/002000/002881.png',
      jobs: ['SCH'],
      duration: 30,
      cooldown: 180,
      executor: createBuffExecutor(3885, 30),
    },

    {
      id: 37016,
      name: '降临之章',
      icon: '/i/002000/002883.png',
      jobs: ['SCH'],
      duration: 30,
      cooldown: 1,
      hidden: true,
      executor: (ctx: ActionExecutionContext) => {
        const baseShieldId = 297 // 鼓舞
        const sageShieldId = 2609 // 贤者群盾
        // 降临之章的鼓舞盾是 240 恢复力，而且秘策无效
        const baseHeal = ctx.statistics?.healByAbility[37016] ?? 10000
        const barrier = Math.round(baseHeal * 1.8)

        const newStatuses: MitigationStatus[] = []

        newStatuses.push({
          instanceId: generateId(),
          statusId: baseShieldId,
          startTime: ctx.useTime,
          endTime: ctx.useTime + 30,
          remainingBarrier: barrier,
          initialBarrier: barrier,
          sourceActionId: ctx.actionId,
          sourcePlayerId: ctx.sourcePlayerId,
        })

        const filteredStatuses = ctx.partyState.statuses.filter(
          s => ![baseShieldId, sageShieldId].includes(s.statusId)
        )

        return {
          ...ctx.partyState,
          statuses: [...filteredStatuses, ...newStatuses],
        }
      },
    },

    // 占星术士 (AST)
    {
      id: 3613,
      name: '命运之轮',
      icon: '/i/003000/003140.png',
      jobs: ['AST'],
      duration: 10,
      cooldown: 60,
      executor: createBuffExecutor(849, 10),
    },

    {
      id: 16559,
      name: '中间学派',
      icon: '/i/003000/003552.png',
      jobs: ['AST'],
      duration: 20,
      cooldown: 120,
      executor: createBuffExecutor(1892, 20),
    },

    {
      id: 37031,
      name: '太阳星座',
      icon: '/i/003000/003109.png',
      jobs: ['AST'],
      duration: 15,
      cooldown: 1,
      executor: createBuffExecutor(3896, 15),
    },

    {
      id: 37030,
      name: '阳星合相',
      icon: '/i/003000/003567.png',
      jobs: ['AST'],
      duration: 30,
      cooldown: 1,
      executor: (ctx: ActionExecutionContext) => {
        const neutralSectId = 1892 // 中间学派
        if (!ctx.partyState.statuses.some(s => s.statusId === neutralSectId)) {
          return ctx.partyState
        }
        return createShieldExecutor(1921, 30)(ctx)
      },
    },

    // 贤者 (SGE)
    {
      id: 24311,
      name: '泛输血',
      icon: '/i/003000/003679.png',
      jobs: ['SGE'],
      duration: 15,
      cooldown: 120,
      executor: createShieldExecutor(2613, 15, { stack: 5 }),
    },

    // 整体论 - 贤者复合技能（减伤 + 盾值）
    {
      id: 24310,
      name: '整体论',
      icon: '/i/003000/003678.png',
      jobs: ['SGE'],
      duration: 20,
      cooldown: 120,
      executor: (ctx: ActionExecutionContext) => {
        const modifierExecutor = createBuffExecutor(3003, 20)
        const shieldExecutor = createShieldExecutor(3365, 20)
        const partyState = modifierExecutor(ctx)
        return shieldExecutor({ ...ctx, partyState })
      },
    },

    {
      id: 24298,
      name: '坚角清汁',
      icon: '/i/003000/003666.png',
      jobs: ['SGE'],
      duration: 15,
      cooldown: 30,
      executor: createBuffExecutor(2618, 15),
    },

    {
      id: 24300,
      name: '活化',
      icon: '/i/003000/003668.png',
      jobs: ['SGE'],
      duration: 30,
      cooldown: 90,
      executor: createShieldExecutor(2611, 30),
    },

    {
      id: 37034,
      name: '均衡预后II',
      icon: '/i/003000/003689.png',
      jobs: ['SGE'],
      duration: 30,
      cooldown: 1.4,
      executor: (ctx: ActionExecutionContext) => {
        const zoeId = 2611 // 活化
        const baseShieldId = 2609 // 均衡预后
        const schShieldId = 297 // 鼓舞
        const hasZoe = ctx.partyState.statuses.some(s => s.statusId === zoeId)
        let barrier = ctx.statistics?.shieldByAbility[baseShieldId] ?? 10000
        if (hasZoe) barrier *= 1.5

        const newStatuses: MitigationStatus[] = []

        newStatuses.push({
          instanceId: generateId(),
          statusId: baseShieldId,
          startTime: ctx.useTime,
          endTime: ctx.useTime + 30,
          remainingBarrier: barrier,
          initialBarrier: barrier,
          sourceActionId: ctx.actionId,
          sourcePlayerId: ctx.sourcePlayerId,
        })

        const filteredStatuses = ctx.partyState.statuses.filter(
          s => ![zoeId, baseShieldId, schShieldId].includes(s.statusId)
        )

        return {
          ...ctx.partyState,
          statuses: [...filteredStatuses, ...newStatuses],
        }
      },
    },

    // ==================== 近战 DPS ====================
    // 牵制 - 近战 DPS 目标减伤
    {
      id: 7549,
      name: '牵制',
      icon: '/i/000000/000828.png',
      jobs: ['MNK', 'DRG', 'NIN', 'SAM', 'RPR', 'VPR'],
      duration: 15,
      cooldown: 90,
      executor: createBuffExecutor(1195, 15),
    },

    // ==================== 远程物理 DPS ====================

    // 吟游诗人 (BRD)
    {
      id: 7405,
      name: '行吟',
      icon: '/i/002000/002612.png',
      jobs: ['BRD'],
      duration: 15,
      cooldown: 90,
      executor: createBuffExecutor(1934, 15, { uniqueGroup: [1934, 1951, 1826] }),
    },

    // 机工士 (MCH)
    {
      id: 16889,
      name: '策动',
      icon: '/i/003000/003040.png',
      jobs: ['MCH'],
      duration: 15,
      cooldown: 90,
      executor: createBuffExecutor(1951, 15, { uniqueGroup: [1934, 1951, 1826] }),
    },

    {
      id: 2887,
      name: '武装解除',
      icon: '/i/003000/003011.png',
      jobs: ['MCH'],
      duration: 10,
      cooldown: 120,
      executor: createBuffExecutor(860, 10),
    },

    // 舞者 (DNC)
    {
      id: 16012,
      name: '防守之桑巴',
      icon: '/i/003000/003469.png',
      jobs: ['DNC'],
      duration: 15,
      cooldown: 90,
      executor: createBuffExecutor(1826, 15, { uniqueGroup: [1934, 1951, 1826] }),
    },

    // ==================== 远程魔法 DPS ====================
    {
      id: 7560,
      name: '昏乱',
      icon: '/i/000000/000861.png',
      jobs: ['BLM', 'SMN', 'RDM', 'PCT'],
      duration: 15,
      cooldown: 90,
      executor: createBuffExecutor(1203, 15),
    },

    // 赤魔法师 (RDM)
    {
      id: 25857,
      name: '抗死',
      icon: '/i/003000/003237.png',
      jobs: ['RDM'],
      duration: 10,
      cooldown: 120,
      executor: createBuffExecutor(2707, 10),
    },
  ],
}
