/**
 * FF14 减伤技能数据（新版本 - 使用 executor 模式）
 * 数据来源: CafeMaker API
 * 版本: 7.1
 * 最后更新: 2026-02-21
 */

import type { MitigationAction } from '@/types/mitigation'
import {
  createFriendlyBuffExecutor,
  createEnemyDebuffExecutor,
  createShieldExecutor,
  generateId,
} from '@/executors'
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
      uniqueGroup: [7535],
      jobs: ['WAR', 'PLD', 'DRK', 'GNB'],
      duration: 15,
      cooldown: 60,
      executor: createEnemyDebuffExecutor(1193, 15),
    },

    // 骑士 (PLD)
    {
      id: 3540,
      name: '圣光幕帘',
      icon: '/i/002000/002508.png',
      uniqueGroup: [3540],
      jobs: ['PLD'],
      duration: 30,
      cooldown: 90,
      executor: createShieldExecutor(1362, 30),
    },
    {
      id: 7385,
      name: '武装戍卫',
      icon: '/i/002000/002515.png',
      uniqueGroup: [7385],
      jobs: ['PLD'],
      duration: 5,
      cooldown: 120,
      executor: createFriendlyBuffExecutor(1176, 5),
    },

    // 战士 (WAR)
    {
      id: 7388,
      name: '摆脱',
      icon: '/i/002000/002563.png',
      uniqueGroup: [7388],
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
      uniqueGroup: [16471],
      jobs: ['DRK'],
      duration: 15,
      cooldown: 90,
      executor: createFriendlyBuffExecutor(1894, 15),
    },

    // 绝枪战士 (GNB)
    {
      id: 16160,
      name: '光之心',
      icon: '/i/003000/003424.png',
      uniqueGroup: [16160],
      jobs: ['GNB'],
      duration: 15,
      cooldown: 90,
      executor: createFriendlyBuffExecutor(1839, 15),
    },

    // ==================== 治疗职业技能 ====================

    // 白魔法师 (WHM)
    {
      id: 16536,
      name: '节制',
      icon: '/i/002000/002645.png',
      uniqueGroup: [16536],
      jobs: ['WHM'],
      duration: 25,
      cooldown: 120,
      executor: createFriendlyBuffExecutor(1873, 25),
    },
    {
      id: 7433,
      name: '全大赦',
      icon: '/i/002000/002639.png',
      uniqueGroup: [7433],
      jobs: ['WHM'],
      duration: 10,
      cooldown: 60,
      executor: createFriendlyBuffExecutor(1219, 10),
    },
    {
      id: 37011,
      name: '神爱抚',
      icon: '/i/002000/002128.png',
      uniqueGroup: [37011],
      jobs: ['WHM'],
      duration: 10,
      cooldown: 1,
      executor: createShieldExecutor(3903, 10),
    },

    // 展开战术 - 复制目标的鼓舞盾到所有成员（模拟为群体单盾）
    {
      id: 3585,
      name: '展开战术',
      icon: '/i/002000/002808.png',
      uniqueGroup: [3585],
      jobs: ['SCH'],
      duration: 0,
      cooldown: 90,
      executor: createShieldExecutor(297, 30),
    },

    // 秘策
    {
      id: 16542,
      name: '秘策',
      icon: '/i/002000/002822.png',
      uniqueGroup: [16542],
      jobs: ['SCH'],
      duration: 15,
      cooldown: 60,
      executor: createFriendlyBuffExecutor(1896, 15, false),
    },

    // 气宇轩昂之策 - 检测秘策状态附加额外盾值
    {
      id: 37013,
      name: '气宇轩昂之策',
      icon: '/i/002000/002880.png',
      uniqueGroup: [37013, 185, 37034],
      jobs: ['SCH'],
      duration: 30,
      cooldown: 2.5,
      executor: (ctx: ActionExecutionContext) => {
        const caster = ctx.partyState.players.find(p => p.id === ctx.sourcePlayerId)
        const hasRecitation = caster?.statuses.some(s => s.statusId === 1896) // 秘策

        const newStatuses: MitigationStatus[] = []

        ctx.partyState.players.forEach(player => {
          // 基础鼓舞盾
          newStatuses.push({
            instanceId: generateId(),
            statusId: 297, // 鼓舞
            startTime: ctx.useTime,
            endTime: ctx.useTime + 30,
            remainingBarrier: player.maxHP * 0.18, // 治疗量的 180%，简化为 18% 最大 HP
            sourceActionId: ctx.actionId,
            sourcePlayerId: player.id,
          })

          // 如果有秘策，额外附加激励盾
          if (hasRecitation) {
            newStatuses.push({
              instanceId: generateId(),
              statusId: 1918, // 激励
              startTime: ctx.useTime,
              endTime: ctx.useTime + 30,
              remainingBarrier: player.maxHP * 0.18, // 与鼓舞相同的盾值
              sourceActionId: ctx.actionId,
              sourcePlayerId: player.id,
            })
          }
        })

        // 如果有秘策，消耗该状态
        const updatedPlayers = ctx.partyState.players.map(p => {
          const playerStatuses = newStatuses.filter(s => s.sourcePlayerId === p.id)
          const filteredStatuses =
            hasRecitation && p.id === ctx.sourcePlayerId
              ? p.statuses.filter(s => s.statusId !== 1896) // 移除秘策
              : p.statuses

          return {
            ...p,
            statuses: [...filteredStatuses, ...playerStatuses],
          }
        })

        return {
          ...ctx.partyState,
          players: updatedPlayers,
        }
      },
    },

    {
      id: 188,
      name: '野战治疗阵',
      icon: '/i/002000/002804.png',
      uniqueGroup: [188],
      jobs: ['SCH'],
      duration: 18,
      cooldown: 30,
      executor: createFriendlyBuffExecutor(299, 18),
    },

    {
      id: 16538,
      name: '异想的幻光',
      icon: '/i/002000/002826.png',
      uniqueGroup: [16538],
      jobs: ['SCH'],
      duration: 20,
      cooldown: 120,
      executor: createFriendlyBuffExecutor(317, 20),
    },

    {
      id: 25868,
      name: '疾风怒涛之计',
      icon: '/i/002000/002878.png',
      uniqueGroup: [16546],
      jobs: ['SCH'],
      duration: 20,
      cooldown: 120,
      executor: createFriendlyBuffExecutor(2711, 20),
    },

    // 占星术士 (AST)
    {
      id: 16559,
      name: '中间学派',
      icon: '/i/003000/003552.png',
      uniqueGroup: [16559],
      jobs: ['AST'],
      duration: 20,
      cooldown: 120,
      executor: createFriendlyBuffExecutor(1892, 20),
    },

    {
      id: 3613,
      name: '命运之轮',
      icon: '/i/003000/003140.png',
      uniqueGroup: [3613],
      jobs: ['AST'],
      duration: 10,
      cooldown: 60,
      executor: createFriendlyBuffExecutor(849, 10),
    },

    {
      id: 37031,
      name: '太阳星座',
      icon: '/i/003000/003109.png',
      uniqueGroup: [37031],
      jobs: ['AST'],
      duration: 15,
      cooldown: 1,
      executor: createFriendlyBuffExecutor(3896, 15),
    },

    // 贤者 (SGE)
    // 泛输血 - 贤者群体盾
    {
      id: 24311,
      name: '泛输血',
      icon: '/i/003000/003679.png',
      uniqueGroup: [24311],
      jobs: ['SGE'],
      duration: 15,
      cooldown: 120,
      executor: createShieldExecutor(2613, 15),
    },

    // 整体论 - 贤者复合技能（减伤 + 盾值）
    {
      id: 24310,
      name: '整体论',
      icon: '/i/003000/003678.png',
      uniqueGroup: [24310],
      jobs: ['SGE'],
      duration: 20,
      cooldown: 120,
      executor: (ctx: ActionExecutionContext) => {
        const modifierExecutor = createFriendlyBuffExecutor(3003, 20)
        const shieldExecutor = createShieldExecutor(3365, 20)
        const partyState = modifierExecutor(ctx)
        return shieldExecutor({ ...ctx, partyState })
      },
    },

    {
      id: 24298,
      name: '坚角清汁',
      icon: '/i/003000/003666.png',
      uniqueGroup: [24298],
      jobs: ['SGE'],
      duration: 15,
      cooldown: 30,
      executor: createFriendlyBuffExecutor(2618, 15, true),
    },

    {
      id: 37034,
      name: '均衡预后II',
      icon: '/i/003000/003689.png',
      uniqueGroup: [37034, 185, 37013],
      jobs: ['SGE'],
      duration: 30,
      cooldown: 1.4,
      executor: createShieldExecutor(2609, 30),
    },

    // ==================== 近战 DPS ====================
    // 牵制 - 近战 DPS 目标减伤
    {
      id: 7549,
      name: '牵制',
      icon: '/i/000000/000828.png',
      uniqueGroup: [7549],
      jobs: ['MNK', 'DRG', 'NIN', 'SAM', 'RPR', 'VPR'],
      duration: 15,
      cooldown: 90,
      executor: createEnemyDebuffExecutor(1195, 15),
    },

    // ==================== 远程物理 DPS ====================

    // 吟游诗人 (BRD)
    {
      id: 7405,
      name: '行吟',
      icon: '/i/002000/002612.png',
      uniqueGroup: [7405, 16889, 16012],
      jobs: ['BRD'],
      duration: 15,
      cooldown: 90,
      executor: createFriendlyBuffExecutor(1934, 15, true),
    },

    // 机工士 (MCH)
    {
      id: 16889,
      name: '策动',
      icon: '/i/003000/003040.png',
      uniqueGroup: [7405, 16889, 16012],
      jobs: ['MCH'],
      duration: 15,
      cooldown: 90,
      executor: createFriendlyBuffExecutor(1951, 15, true),
    },
    {
      id: 2887,
      name: '武装解除',
      icon: '/i/003000/003011.png',
      uniqueGroup: [2887],
      jobs: ['MCH'],
      duration: 10,
      cooldown: 120,
      executor: createEnemyDebuffExecutor(860, 10),
    },

    // 舞者 (DNC)
    {
      id: 16012,
      name: '防守之桑巴',
      icon: '/i/003000/003469.png',
      uniqueGroup: [7405, 16889, 16012],
      jobs: ['DNC'],
      duration: 15,
      cooldown: 90,
      executor: createFriendlyBuffExecutor(1826, 15, true),
    },

    // ==================== 远程魔法 DPS ====================
    {
      id: 7560,
      name: '昏乱',
      icon: '/i/000000/000861.png',
      uniqueGroup: [7560],
      jobs: ['BLM', 'SMN', 'RDM', 'PCT'],
      duration: 15,
      cooldown: 90,
      executor: createEnemyDebuffExecutor(1203, 15),
    },

    // 赤魔法师 (RDM)
    {
      id: 25857,
      name: '抗死',
      icon: '/i/003000/003237.png',
      uniqueGroup: [25857],
      jobs: ['RDM'],
      duration: 10,
      cooldown: 120,
      executor: createFriendlyBuffExecutor(2707, 10),
    },
  ],
}
