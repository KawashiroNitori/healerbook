/**
 * FF14 减伤技能数据（新版本 - 使用 executor 模式）
 * 数据来源: CafeMaker API
 * 版本: 7.1
 * 最后更新: 2026-02-21
 */

import type { MitigationAction } from '@/types/mitigation'
import { createBuffExecutor, createShieldExecutor } from '@/executors'
import type { ActionExecutionContext } from '@/types/mitigation'
import { whileStatus, not } from '@/utils/placement/combinators'

const SERAPHISM_BUFF_ID = 3885 // 炽天附体

export interface MitigationDataSource {
  actions: MitigationAction[]
}

export const MITIGATION_DATA: MitigationDataSource = {
  actions: [
    // ==================== 坦克技能 ====================

    // 坦克通用
    {
      id: 7535,
      name: '雪仇',
      icon: '/i/000000/000806.png',
      jobs: ['WAR', 'PLD', 'DRK', 'GNB'],
      category: ['partywide', 'percentage'],
      duration: 15,
      cooldown: 60,
      executor: createBuffExecutor(1193, 15),
    },
    {
      id: 7531,
      name: '铁壁',
      icon: '/i/000000/000801.png',
      jobs: ['WAR', 'PLD', 'DRK', 'GNB'],
      category: ['self', 'percentage'],
      duration: 20,
      cooldown: 90,
      executor: createBuffExecutor(1191, 20),
    },

    // 骑士 (PLD)
    {
      id: 3540,
      name: '圣光幕帘',
      icon: '/i/002000/002508.png',
      jobs: ['PLD'],
      category: ['partywide', 'shield'],
      duration: 30,
      cooldown: 90,
      executor: createShieldExecutor(1362, 30),
      statDataEntries: [{ type: 'shield', key: 1362 }],
    },
    {
      id: 7385,
      name: '武装戍卫',
      icon: '/i/002000/002515.png',
      jobs: ['PLD'],
      category: ['partywide', 'percentage'],
      duration: 5,
      cooldown: 120,
      executor: createBuffExecutor(1176, 5),
    },
    {
      id: 30,
      name: '神圣领域',
      icon: '/i/002000/002502.png',
      jobs: ['PLD'],
      category: ['self', 'percentage'],
      duration: 10,
      cooldown: 420,
      executor: createBuffExecutor(82, 10),
    },
    {
      id: 22,
      name: '壁垒',
      icon: '/i/000000/000167.png',
      jobs: ['PLD'],
      category: ['self', 'percentage'],
      duration: 10,
      cooldown: 90,
      executor: createBuffExecutor(1364, 10, {
        performance: { physics: 0.8, magic: 0.8, darkness: 1 },
      }),
    },
    {
      id: 7382,
      name: '干预',
      icon: '/i/002000/002512.png',
      jobs: ['PLD'],
      category: ['target', 'percentage'],
      duration: 8,
      cooldown: 10,
      executor: (ctx: ActionExecutionContext) => {
        let performace = 0.9
        if (ctx.partyState.statuses.some(s => s.statusId === 1191 || s.statusId === 3829)) {
          performace = 0.8
        }
        const partyState = createBuffExecutor(1174, 8, {
          performance: { physics: performace, magic: performace, darkness: 1 },
        })(ctx)
        return createBuffExecutor(2675, 4)({ ...ctx, partyState })
      },
    },
    {
      id: 25746,
      name: '圣盾阵',
      icon: '/i/002000/002950.png',
      jobs: ['PLD'],
      category: ['self', 'percentage'],
      duration: 8,
      cooldown: 5,
      executor: (ctx: ActionExecutionContext) => {
        const partyState = createBuffExecutor(2674, 8)(ctx)
        return createBuffExecutor(2675, 4, {
          performance: { physics: 0.85, magic: 0.85, darkness: 1 },
        })({ ...ctx, partyState })
      },
    },
    {
      id: 36920,
      name: '极致防御',
      icon: '/i/002000/002524.png',
      jobs: ['PLD'],
      category: ['self', 'percentage', 'shield'],
      duration: 15,
      cooldown: 120,
      executor: (ctx: ActionExecutionContext) => {
        const partyState = createBuffExecutor(3829, 15)(ctx)
        return createShieldExecutor(3830, 15)({ ...ctx, partyState })
      },
      statDataEntries: [{ type: 'shield', key: 3830 }],
    },

    // 战士 (WAR)
    {
      id: 7388,
      name: '摆脱',
      icon: '/i/002000/002563.png',
      jobs: ['WAR'],
      category: ['partywide', 'shield'],
      duration: 30,
      cooldown: 90,
      executor: createShieldExecutor(1457, 30),
      statDataEntries: [{ type: 'shield', key: 1457 }],
    },
    {
      id: 40,
      name: '战栗',
      icon: '/i/000000/000263.png',
      jobs: ['WAR'],
      category: ['self'],
      duration: 10,
      cooldown: 90,
      executor: createBuffExecutor(87, 10),
    },
    {
      id: 43,
      name: '死斗',
      icon: '/i/000000/000266.png',
      jobs: ['WAR'],
      category: ['self', 'shield'],
      duration: 10,
      cooldown: 240,
      executor: createBuffExecutor(409, 10),
    },
    {
      id: 25751,
      name: '原初的血气',
      icon: '/i/002000/002569.png',
      jobs: ['WAR'],
      category: ['self', 'percentage', 'shield'],
      duration: 8,
      cooldown: 25,
      executor: ctx => {
        let partyState = createBuffExecutor(2678, 8)(ctx)
        partyState = createBuffExecutor(2679, 4)({ ...ctx, partyState })
        return createShieldExecutor(2680, 20)({ ...ctx, partyState })
      },
      statDataEntries: [{ type: 'shield', key: 2680 }],
    },
    {
      id: 36923,
      name: '戮罪',
      icon: '/i/002000/002573.png',
      jobs: ['WAR'],
      category: ['self', 'percentage'],
      duration: 15,
      cooldown: 120,
      executor: createBuffExecutor(3832, 15),
    },

    // 暗黑骑士 (DRK)
    {
      id: 16471,
      name: '暗黑布道',
      icon: '/i/003000/003087.png',
      jobs: ['DRK'],
      category: ['partywide', 'percentage'],
      duration: 15,
      cooldown: 90,
      executor: createBuffExecutor(1894, 15),
    },
    {
      id: 3634,
      name: '弃明投暗',
      icon: '/i/003000/003076.png',
      jobs: ['DRK'],
      category: ['self', 'percentage'],
      duration: 10,
      cooldown: 60,
      executor: createBuffExecutor(746, 10),
    },
    {
      id: 3638,
      name: '行尸走肉',
      icon: '/i/003000/003077.png',
      jobs: ['DRK'],
      category: ['self', 'percentage'],
      duration: 10,
      cooldown: 300,
      executor: createBuffExecutor(810, 10),
    },
    {
      id: 7393,
      name: '至黑之夜',
      icon: '/i/003000/003081.png',
      jobs: ['DRK'],
      category: ['self', 'shield'],
      duration: 7,
      cooldown: 15,
      executor: createShieldExecutor(1178, 7),
      statDataEntries: [{ type: 'shield', key: 1178 }],
    },
    {
      id: 25754,
      name: '献奉',
      icon: '/i/003000/003089.png',
      jobs: ['DRK'],
      category: ['self', 'target', 'percentage'],
      duration: 7,
      cooldown: 60,
      executor: createBuffExecutor(2682, 7),
    },
    {
      id: 36927,
      name: '暗影卫',
      icon: '/i/003000/003094.png',
      jobs: ['DRK'],
      category: ['self', 'percentage'],
      duration: 15,
      cooldown: 120,
      executor: createBuffExecutor(3835, 15),
    },

    // 绝枪战士 (GNB)
    {
      id: 16160,
      name: '光之心',
      icon: '/i/003000/003424.png',
      jobs: ['GNB'],
      category: ['partywide', 'percentage'],
      duration: 15,
      cooldown: 90,
      executor: createBuffExecutor(1839, 15),
    },
    {
      id: 16140,
      name: '伪装',
      icon: '/i/003000/003404.png',
      jobs: ['GNB'],
      category: ['self', 'percentage'],
      duration: 20,
      cooldown: 120,
      executor: createBuffExecutor(1832, 20),
    },
    {
      id: 16152,
      name: '超火流星',
      icon: '/i/003000/003416.png',
      jobs: ['GNB'],
      category: ['self', 'percentage'],
      duration: 10,
      cooldown: 360,
      executor: createBuffExecutor(1836, 10),
    },
    {
      id: 25758,
      name: '刚玉之心',
      icon: '/i/003000/003430.png',
      jobs: ['GNB'],
      category: ['self', 'target', 'percentage'],
      duration: 8,
      cooldown: 25,
      executor: ctx => {
        const partyState = createBuffExecutor(2683, 8)(ctx)
        return createBuffExecutor(2684, 4)({ ...ctx, partyState })
      },
    },
    {
      id: 36935,
      name: '大星云',
      icon: '/i/003000/003435.png',
      jobs: ['GNB'],
      category: ['self', 'percentage'],
      duration: 15,
      cooldown: 120,
      executor: createBuffExecutor(3838, 15),
    },

    // ==================== 治疗职业技能 ====================

    // 白魔法师 (WHM)
    {
      id: 16536,
      name: '节制',
      icon: '/i/002000/002645.png',
      jobs: ['WHM'],
      category: ['partywide', 'percentage'],
      duration: 25,
      cooldown: 120,
      // executor: createBuffExecutor(1873, 25),
      executor: ctx => {
        const partyState = createBuffExecutor(1873, 25)(ctx)
        return createBuffExecutor(3881, 30)({ ...ctx, partyState })
      },
    },
    {
      id: 37011,
      name: '神爱抚',
      icon: '/i/002000/002128.png',
      jobs: ['WHM'],
      category: ['partywide', 'shield'],
      duration: 10,
      cooldown: 1,
      placement: whileStatus(3881),
      executor: createShieldExecutor(3903, 10, { uniqueGroup: [3881] }),
      statDataEntries: [{ type: 'shield', key: 3903 }],
    },
    {
      id: 7433,
      name: '全大赦',
      icon: '/i/002000/002639.png',
      jobs: ['WHM'],
      category: ['partywide', 'percentage'],
      duration: 10,
      cooldown: 60,
      executor: createBuffExecutor(1219, 10),
    },

    // 学者 (SCH)
    // 展开战术 - 复制目标的鼓舞盾到所有成员（模拟为群体单盾）
    {
      id: 3585,
      name: '展开战术',
      icon: '/i/002000/002808.png',
      jobs: ['SCH'],
      category: ['partywide', 'shield'],
      duration: 30,
      cooldown: 90,
      executor: (ctx: ActionExecutionContext) => {
        // 因为群盾和单盾实际上对应的是同一个 buff id 但实际盾量不同，盾量预估只能使用单盾技能基础恢复力 * 180%
        const baseShieldId = 297 // 鼓舞
        const sageShieldId = 2609 // 贤者群盾
        const baseHeal = ctx.statistics?.healByAbility[185] ?? 10000
        const barrier = Math.round(baseHeal * 1.8)
        return createShieldExecutor(baseShieldId, 30, {
          fixedBarrier: barrier,
          uniqueGroup: [baseShieldId, sageShieldId],
        })(ctx)
      },
      statDataEntries: [{ type: 'heal', key: 185, label: '鼓舞激励之策' }],
    },
    {
      id: 16542,
      name: '秘策',
      icon: '/i/002000/002822.png',
      jobs: ['SCH'],
      category: ['partywide', 'percentage', 'shield'],
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
      category: ['partywide', 'shield'],
      duration: 30,
      cooldown: 2,
      executor: (ctx: ActionExecutionContext) => {
        const seraphismId = 3885 // 炽天附体
        const recitationId = 1896 // 秘策
        const baseShieldId = 297 // 鼓舞
        const sageShieldId = 2609 // 贤者群盾

        const hasSeraphism = ctx.partyState.statuses.some(s => s.statusId === seraphismId)

        let baseHeal: number
        if (hasSeraphism) {
          // 炽天附体激活：等效降临之章，使用 37016 基础恢复力，秘策无效
          baseHeal = ctx.statistics?.healByAbility[37016] ?? 10000
        } else {
          // 普通意气轩昂之策：检测秘策决定是否用暴击治疗量
          const hasRecitation = ctx.partyState.statuses.some(s => s.statusId === recitationId)
          baseHeal = hasRecitation
            ? (ctx.statistics?.critHealByAbility[37013] ?? 10000)
            : (ctx.statistics?.healByAbility[37013] ?? 10000)
        }

        const barrier = Math.round(baseHeal * 1.8)
        const uniqueGroup = hasSeraphism
          ? [baseShieldId, sageShieldId]
          : [recitationId, baseShieldId, sageShieldId]

        return createShieldExecutor(baseShieldId, 30, { fixedBarrier: barrier, uniqueGroup })(ctx)
      },
      placement: not(whileStatus(SERAPHISM_BUFF_ID)),
      statDataEntries: [
        { type: 'heal', key: 37013 },
        { type: 'critHeal', key: 37013 },
      ],
    },

    {
      id: 37014,
      name: '炽天附体',
      icon: '/i/002000/002881.png',
      jobs: ['SCH'],
      category: ['partywide', 'percentage', 'shield'],
      duration: 30,
      cooldown: 180,
      executor: createBuffExecutor(3885, 30),
    },

    {
      id: 37016,
      name: '降临之章',
      icon: '/i/002000/002883.png',
      jobs: ['SCH'],
      category: ['partywide', 'shield'],
      duration: 30,
      cooldown: 2,
      trackGroup: 37013,
      placement: whileStatus(SERAPHISM_BUFF_ID),
      executor: (ctx: ActionExecutionContext) => {
        const baseShieldId = 297 // 鼓舞
        const sageShieldId = 2609 // 贤者群盾
        // 降临之章的鼓舞盾是 240 恢复力，而且秘策无效
        const baseHeal = ctx.statistics?.healByAbility[37016] ?? 10000
        const barrier = Math.round(baseHeal * 1.8)
        return createShieldExecutor(baseShieldId, 30, {
          fixedBarrier: barrier,
          uniqueGroup: [baseShieldId, sageShieldId],
        })(ctx)
      },
      statDataEntries: [{ type: 'heal', key: 37016 }],
    },

    {
      id: 188,
      name: '野战治疗阵',
      icon: '/i/002000/002804.png',
      jobs: ['SCH'],
      category: ['partywide', 'percentage'],
      duration: 18,
      cooldown: 30,
      executor: createBuffExecutor(299, 18),
    },

    {
      id: 16538,
      name: '异想的幻光',
      icon: '/i/002000/002826.png',
      jobs: ['SCH'],
      category: ['partywide', 'percentage'],
      duration: 20,
      cooldown: 120,
      executor: createBuffExecutor(317, 20),
    },

    {
      id: 25868,
      name: '疾风怒涛之计',
      icon: '/i/002000/002878.png',
      jobs: ['SCH'],
      category: ['partywide', 'percentage'],
      duration: 20,
      cooldown: 120,
      executor: createBuffExecutor(2711, 20),
    },

    {
      id: 16545,
      name: '炽天召唤',
      icon: '/i/002000/002850.png',
      jobs: ['SCH'],
      category: ['partywide', 'percentage', 'shield'],
      duration: 22,
      cooldown: 120,
      executor: ctx => {
        const partyState = createBuffExecutor(3095, 22)(ctx)
        return createBuffExecutor(20016546, 22, { stack: 2 })({ ...ctx, partyState }) // 假 buff，模拟慰藉积蓄
      },
    },

    {
      id: 16546,
      name: '慰藉',
      icon: '/i/002000/002851.png',
      jobs: ['SCH'],
      category: ['partywide', 'shield'],
      duration: 30,
      cooldown: 1,
      //executor: createShieldExecutor(1917, 30),
      executor: ctx => {
        let partyState = createShieldExecutor(1917, 30)(ctx)
        const charge = partyState.statuses.find(s => s.statusId === 20016546)
        if (charge) {
          const newStack = (charge.stack ?? 1) - 1
          partyState =
            newStack <= 0
              ? { ...partyState, statuses: partyState.statuses.filter(s => s !== charge) }
              : {
                  ...partyState,
                  statuses: partyState.statuses.map(s =>
                    s === charge ? { ...s, stack: newStack } : s
                  ),
                }
        }
        return partyState
      },
      placement: whileStatus(20016546),
      statDataEntries: [{ type: 'shield', key: 1917 }],
    },

    // 占星术士 (AST)
    {
      id: 3613,
      name: '命运之轮',
      icon: '/i/003000/003140.png',
      jobs: ['AST'],
      category: ['partywide', 'percentage'],
      duration: 10,
      cooldown: 60,
      executor: createBuffExecutor(849, 10),
    },

    {
      id: 16559,
      name: '中间学派',
      icon: '/i/003000/003552.png',
      jobs: ['AST'],
      category: ['partywide', 'percentage', 'shield'],
      duration: 20,
      cooldown: 120,
      executor: ctx => {
        const partyState = createBuffExecutor(1892, 20)(ctx)
        return createBuffExecutor(3895, 30)({ ...ctx, partyState })
      },
    },

    {
      id: 37031,
      name: '太阳星座',
      icon: '/i/003000/003109.png',
      jobs: ['AST'],
      category: ['partywide', 'percentage'],
      duration: 15,
      cooldown: 1,
      executor: createBuffExecutor(3896, 15, { uniqueGroup: [3895] }),
      placement: whileStatus(3895),
    },

    {
      id: 37030,
      name: '阳星合相',
      icon: '/i/003000/003567.png',
      jobs: ['AST'],
      category: ['partywide', 'shield'],
      duration: 30,
      cooldown: 1,
      executor: (ctx: ActionExecutionContext) => {
        const neutralSectId = 1892 // 中间学派
        if (!ctx.partyState.statuses.some(s => s.statusId === neutralSectId)) {
          return ctx.partyState
        }
        // 盾量 = 阳星合相治疗量 × 1.25（盾比例）× 1.2（中间学派加成）
        const baseHeal = ctx.statistics?.healByAbility[37030] ?? 10000
        const barrier = Math.round(baseHeal * 1.25 * 1.2)
        return createShieldExecutor(1921, 30, { fixedBarrier: barrier })(ctx)
      },
      statDataEntries: [{ type: 'heal', key: 37030 }],
    },

    // 贤者 (SGE)
    {
      id: 24311,
      name: '泛输血',
      icon: '/i/003000/003679.png',
      jobs: ['SGE'],
      category: ['partywide', 'shield'],
      duration: 15,
      cooldown: 120,
      executor: createShieldExecutor(2613, 15, { stack: 5 }),
      statDataEntries: [{ type: 'shield', key: 2613 }],
    },

    // 整体论 - 贤者复合技能（减伤 + 盾值）
    {
      id: 24310,
      name: '整体论',
      icon: '/i/003000/003678.png',
      jobs: ['SGE'],
      category: ['partywide', 'shield', 'percentage'],
      duration: 20,
      cooldown: 120,
      executor: (ctx: ActionExecutionContext) => {
        const modifierExecutor = createBuffExecutor(3003, 20)
        const shieldExecutor = createShieldExecutor(3365, 20)
        const partyState = modifierExecutor(ctx)
        return shieldExecutor({ ...ctx, partyState })
      },
      statDataEntries: [{ type: 'shield', key: 3365 }],
    },

    {
      id: 24298,
      name: '坚角清汁',
      icon: '/i/003000/003666.png',
      jobs: ['SGE'],
      category: ['partywide', 'percentage'],
      duration: 15,
      cooldown: 30,
      executor: createBuffExecutor(2618, 15),
    },

    {
      id: 24300,
      name: '活化',
      icon: '/i/003000/003668.png',
      jobs: ['SGE'],
      category: ['partywide'],
      duration: 30,
      cooldown: 90,
      executor: createShieldExecutor(2611, 30),
    },

    {
      id: 37034,
      name: '均衡预后II',
      icon: '/i/003000/003689.png',
      jobs: ['SGE'],
      category: ['partywide', 'shield'],
      duration: 30,
      cooldown: 1.4,
      executor: (ctx: ActionExecutionContext) => {
        const zoeId = 2611 // 活化
        const baseShieldId = 2609 // 均衡预后
        const schShieldId = 297 // 鼓舞
        const hasZoe = ctx.partyState.statuses.some(s => s.statusId === zoeId)
        let barrier = ctx.statistics?.shieldByAbility[baseShieldId] ?? 10000
        if (hasZoe) barrier = Math.round(barrier * 1.5)

        return createShieldExecutor(baseShieldId, 30, {
          fixedBarrier: barrier,
          uniqueGroup: [zoeId, baseShieldId, schShieldId],
        })(ctx)
      },
      statDataEntries: [{ type: 'shield', key: 2609 }],
    },

    // ==================== 近战 DPS ====================
    // 牵制 - 近战 DPS 目标减伤
    {
      id: 7549,
      name: '牵制',
      icon: '/i/000000/000828.png',
      jobs: ['MNK', 'DRG', 'NIN', 'SAM', 'RPR', 'VPR'],
      category: ['partywide', 'percentage'],
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
      category: ['partywide', 'percentage'],
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
      category: ['partywide', 'percentage'],
      duration: 15,
      cooldown: 90,
      executor: createBuffExecutor(1951, 15, { uniqueGroup: [1934, 1951, 1826] }),
    },

    {
      id: 2887,
      name: '武装解除',
      icon: '/i/003000/003011.png',
      jobs: ['MCH'],
      category: ['partywide', 'percentage'],
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
      category: ['partywide', 'percentage'],
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
      category: ['partywide', 'percentage'],
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
      category: ['partywide', 'percentage'],
      duration: 10,
      cooldown: 120,
      executor: createBuffExecutor(2707, 10),
    },
  ],
}

if (import.meta.env.DEV) {
  // 异步导入避免生产打包时保留 validate 代码路径
  void import('@/utils/placement/validate').then(({ validateActions }) => {
    const issues = validateActions(MITIGATION_DATA.actions)
    for (const issue of issues) {
      const msg = `[mitigationActions] ${issue.rule} on action ${issue.actionId}: ${issue.message}`
      if (issue.level === 'error') console.error(msg)
      else console.warn(msg)
    }
  })
}
