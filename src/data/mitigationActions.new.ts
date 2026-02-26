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
  version: string
  lastUpdated: string
  source: string
  actions: MitigationAction[]
}

export const MITIGATION_DATA: MitigationDataSource = {
  version: '7.1',
  lastUpdated: '2026-02-21',
  source: 'CafeMaker API',
  actions: [
    // ==================== 坦克技能 ====================

    // 雪仇 - 坦克目标减伤
    {
      id: 7535,
      name: '雪仇',
      description:
        '使自身周围的敌人攻击伤害降低10%　<span style="color:#00cc22;">持续时间：</span> 15 秒',
      icon: '/i/000000/000806.png',
      iconHD: '/i/000000/000806_hr1.png',
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
      id: 3638,
      name: '暗黑布道',
      icon: '/i/003000/003087.png',
      uniqueGroup: [3638],
      jobs: ['DRK'],
      duration: 15,
      cooldown: 90,
      executor: createFriendlyBuffExecutor(1894, 15),
    },

    // 绝枪战士 (GNB)
    {
      id: 16160,
      name: '光之心',
      icon: '/i/002000/002583.png',
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
      description:
        '一定时间内，自身发动治疗魔法的治疗量提高20%，自身与50米以内的队员受到的伤害减轻10%　<span style="color:#00cc22;">持续时间：</span>20秒 <span style="color:#00cc22;">追加效果：</span><span style="color:#ff7b1a;">神爱抚预备</span>　<span style="color:#00cc22;">持续时间：</span>30秒',
      icon: '/i/002000/002645.png',
      iconHD: '/i/002000/002645_hr1.png',
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

    // 学者 (SCH)
    // 鼓舞激励之策 - 学者单体盾
    {
      id: 185,
      name: '鼓舞激励之策',
      description:
        '恢复目标的体力　<span style="color:#00cc22;">恢复力：</span>300\n<span style="color:#00cc22;">追加效果：</span>为目标附加能够抵御一定伤害的防护罩<span style="color:#ff7b1a;">鼓舞</span>',
      icon: '/i/002000/002801.png',
      iconHD: '/i/002000/002801_hr1.png',
      uniqueGroup: [185, 37013, 37034],
      jobs: ['SCH'],
      duration: 30,
      cooldown: 2.5,
      executor: createShieldExecutor(297, 30, false, 0.125),
    },

    // 展开战术 - 复制目标的鼓舞盾到所有成员
    {
      id: 3585,
      name: '展开战术',
      description:
        '将目标身上的<span style="color:#ff7b1a;">鼓舞</span>或<span style="color:#ff7b1a;">激励</span>效果扩散到自身及周围队员身上',
      icon: "/i/002000/002808.png",
      iconHD: "/i/002000/002808_hr1.png",
      uniqueGroup: [3585],
      jobs: ['SCH'],
      duration: 0,
      cooldown: 90,
      executor: (ctx: ActionExecutionContext) => {
        const targetPlayer = ctx.partyState.players.find(
          (p) => p.id === ctx.targetPlayerId
        )
        if (!targetPlayer) {
          return ctx.partyState
        }

        // 查找目标身上的鼓舞状态（只检查 297）
        const shieldStatus = targetPlayer.statuses.find((s) => s.statusId === 297)

        if (!shieldStatus) {
          // 目标没有鼓舞盾，无法展开
          return ctx.partyState
        }

        // 为所有队员复制该盾值状态
        const newStatuses: MitigationStatus[] = ctx.partyState.players.map((player) => ({
          instanceId: generateId(),
          statusId: shieldStatus.statusId,
          startTime: ctx.useTime,
          endTime: ctx.useTime + 30,
          remainingBarrier: shieldStatus.remainingBarrier,
          sourceActionId: ctx.actionId,
          sourcePlayerId: player.id,
        }))

        return {
          ...ctx.partyState,
          players: ctx.partyState.players.map((p, i) => ({
            ...p,
            statuses: [...p.statuses, newStatuses[i]],
          })),
        }
      },
    },

    // 气宇轩昂之策 - 检测秘策状态附加额外盾值
    {
      id: 37013,
      name: '气宇轩昂之策',
      description:
        '恢复自身及周围队员的体力\n<span style="color:#00cc22;">追加效果：</span>附加能够抵御一定伤害的防护罩\n该防护罩能够抵消相当于治疗量180%的伤害',
      icon: '/i/002000/002880.png',
      iconHD: '/i/002000/002880_hr1.png',
      uniqueGroup: [37013, 185, 37034],
      jobs: ['SCH'],
      duration: 30,
      cooldown: 2.5,
      executor: (ctx: ActionExecutionContext) => {
        const caster = ctx.partyState.players.find(
          (p) => p.id === ctx.targetPlayerId
        )
        const hasRecitation = caster?.statuses.some((s) => s.statusId === 1896) // 秘策

        const newStatuses: MitigationStatus[] = []

        ctx.partyState.players.forEach((player) => {
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
        const updatedPlayers = ctx.partyState.players.map((p) => {
          const playerStatuses = newStatuses.filter((s) => s.sourcePlayerId === p.id)
          const filteredStatuses =
            hasRecitation && p.id === ctx.targetPlayerId
              ? p.statuses.filter((s) => s.statusId !== 1896) // 移除秘策
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
      iconHD: '/i/002000/002804_hr1.png',
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
      description: '以自身为中心产生覆盖范围8米的命运之轮\n<span style="color:#00cc22;">持续时间：</span>18秒\n使用时自身及周围30米内的队员所受到的伤害减轻10%\n<span style="color:#00cc22;">持续时间：</span>5秒\n同时，范围内的自身及队员还会附加体力持续恢复的效果\n<span style="color:#00cc22;">恢复力：</span>100　<span style="color:#00cc22;">持续时间：</span>15秒\n在进入命运之轮范围后将持续获得以上效果\n效果时间内发动技能或进行移动、转身都会使命运之轮立即消失\n发动之后会停止自动攻击',
      icon: '/i/003000/003140.png',
      iconHD: '/i/003000/003140_hr1.png',
      uniqueGroup: [3613],
      jobs: ['AST'],
      duration: 10,
      cooldown: 60,
      executor: createFriendlyBuffExecutor(849, 10),
    },

    {
      id: 37031,
      name: '太阳星座',
      description: '一定时间内，令自身和周围队员所受到的伤害减轻10%\n<span style="color:#00cc22;">持续时间：</span>15秒\n<span style="color:#00cc22;">发动条件：</span><span style="color:#ff7b1a;">太阳星座预备</span>状态中',
      icon: '/i/003000/003109.png',
      iconHD: '/i/003000/003109_hr1.png',
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
      description:
        '为自身及周围队员附加能够抵消一定伤害量的防护罩\n该防护罩能够抵消相当于200恢复力的伤害量',
      icon: '/i/003000/003679.png',
      iconHD: '/i/003000/003679_hr1.png',
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
      description:
        '恢复自身及周围队员的体力\n<span style="color:#00cc22;">追加效果：</span>自身及周围队员所受伤害减轻10%　<span style="color:#00cc22;">持续时间：</span>20秒',
      icon: '/i/003000/003678.png',
      iconHD: '/i/003000/003678_hr1.png',
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
      iconHD: '/i/003000/003666_hr1.png',
      uniqueGroup: [24298],
      jobs: ['SGE'],
      duration: 15,
      cooldown: 30,
      executor: createFriendlyBuffExecutor(2618, 15, true),
    },

    {
      id: 37034,
      name: '均衡预后II',
      description: '恢复自身及周围队员的体力\n<span style="color:#00cc22;">恢复力：</span>100\n<span style="color:#00cc22;">追加效果：</span>为目标附加能够抵御一定伤害的防护罩\n该防护罩能够抵消相当于治疗量360%的伤害\n<span style="color:#00cc22;">持续时间：</span>30秒\n无法与均衡诊断及学者的鼓舞效果共存\n<span style="color:#00cc22;">发动条件：</span><span style="color:#ff7b1a;">均衡</span>状态中\n\n<span style="color:#ffff66;">※该技能无法设置到热键栏\n　满足发动条件后，预后变为均衡预后II</span>',
      icon: '/i/003000/003689.png',
      iconHD: '/i/003000/003689_hr1.png',
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
      description:
        '一定时间内，令目标物理攻击造成的伤害降低10%，魔法攻击造成的伤害降低5%\n<span style="color:#00cc22;">持续时间：</span> 15 秒',
      icon: '/i/000000/000828.png',
      iconHD: '/i/000000/000828_hr1.png',
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
      description:
        '一定时间内，令自身和周围队员所受到的伤害减轻 15 %\n<span style="color:#00cc22;">持续时间：</span>15秒\n无法与机工士的策动、舞者的防守之桑巴效果共存',
      icon: '/i/002000/002612.png',
      iconHD: '/i/002000/002612_hr1.png',
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

    // 绘灵法师 (PCT)
    {
      id: 34686,
      name: '油性坦培拉涂层',
      description: '解除自身附加的<span style="color:#ff7b1a;">坦培拉涂层</span>，为自身及周围队员附加能够抵消一定伤害量的防护罩\n该防护罩能够抵消相当于目标最大体力10%的伤害量\n<span style="color:#00cc22;">持续时间：</span>10秒\n<span style="color:#00cc22;">发动条件：</span><span style="color:#ff7b1a;">坦培拉涂层</span>状态中\n附加自身的防护罩因吸收到足够的伤害而消失时，坦培拉涂层的复唱时间缩短30秒',
      icon: '/i/003000/003836.png',
      iconHD: '/i/003000/003836_hr1.png',
      uniqueGroup: [34686],
      jobs: ['PCT'],
      duration: 10,
      cooldown: 1,
      executor: createShieldExecutor(3687, 10),
    },

    // 赤魔法师 (RDM)
    {
      id: 25857,
      name: '抗死',
      description: '一定时间内，令自身和周围队员所受到的魔法伤害减轻10%，并且所受的体力恢复效果提高5%\n<span style="color:#00cc22;">持续时间：</span>10秒',
      icon: '/i/003000/003237.png',
      iconHD: '/i/003000/003237_hr1.png',
      uniqueGroup: [25857],
      jobs: ['RDM'],
      duration: 10,
      cooldown: 120,
      executor: createFriendlyBuffExecutor(2707, 10),
    },
  ],
}
