/**
 * 资源池 registry
 *
 * 设计文档：design/superpowers/specs/2026-04-24-resource-model-design.md
 *
 * 约束：显式资源 id **不得**以 '__cd__:' 开头 —— 该前缀保留给 compute 层合成的单充能池。
 */

import type { ResourceDefinition } from '@/types/resource'
import { isSynthCdResource } from '@/utils/resource/synthCd'

export const RESOURCE_REGISTRY: Record<string, ResourceDefinition> = {
  'sch:consolation': {
    id: 'sch:consolation',
    name: '慰藉充能',
    job: 'SCH',
    initial: 2, // 战斗开始满充能
    max: 2,
    style: 'cooldown',
    // regen.interval 与 mitigationActions.ts 中慰藉 (16546) 的 cooldown 保持一致（后者含消费者时
    // 仅信息性，两者改动需同步）。
    //
    // initial=2 不代表战斗起手可用：placement: whileStatus(3095) 在首炽天（≈t=120）前
    // 完全封住慰藉，满充能仅用于简化"每次炽天触发时必定满充能"的不变量验证。
    // 若 placement 规则变更，需同步评估 initial 值的合理性。
    regen: { interval: 30, amount: 1 },
  },
  'sch:aetherflow': {
    id: 'sch:aetherflow',
    name: '以太超流',
    job: 'SCH',
    initial: 3, // 开场满档（等效真实学者起手以太超流可用）
    max: 3,
    style: 'lights',
    // 「每分钟回 3 档」：每次消耗后 60s 一次性补 3（封顶 3）。注意这套 regen 是「消耗驱动」而非
    // 从 t=0 固定节拍——initial=3 确保开场即可用、用掉后 60s 回满。
    //
    // 与 consolation/oblation 不同：野战治疗阵(188)/不屈不挠之策(3583) 还各有自身 30s 重置，
    // 该池 regen(60s) 并不等于这俩技能的 CD。故这两个技能在 mitigationActions.ts 里**同时**声明了
    // 自身 __cd__ 单充能池消费者（保留 30s 门）和本池消费者（共享 3 档），形成双门 gating。
    regen: { interval: 60, amount: 3 },
    tint: '#4ade80', // 游戏内以太超流宝石为薄荷绿
    unmetMessage: '以太超流档数不足',
  },
  'drk:oblation': {
    id: 'drk:oblation',
    name: '献奉充能',
    job: 'DRK',
    initial: 2,
    max: 2,
    style: 'cooldown',
    // regen.interval 与 mitigationActions.ts 中献奉 (25754) 的 cooldown 保持一致（后者含消费者时
    // 仅信息性，两者改动需同步）。
    regen: { interval: 60, amount: 1 },
  },
  'whm:lily': {
    id: 'whm:lily',
    name: '治疗百合',
    job: 'WHM',
    initial: 3, // 开场满档
    max: 3,
    style: 'lightsWithBar',
    // 「20s 回 1 档」。注意这套 regen 是「消耗驱动」（每次消耗后 20s 补 1），非真实游戏的自由计时；
    // initial=3 保证开场满、用掉后 20s 回。狂喜之心(16534) 另有自身 2s CD（GCD 级），故在
    // mitigationActions.ts 里同时声明 __cd__ 与本池消费者，形成双门 gating。
    regen: { interval: 20, amount: 1 },
    unmetMessage: '百合档数不足',
  },
  'whm:divine': {
    id: 'whm:divine',
    name: '神祝祷充能',
    job: 'WHM',
    initial: 2,
    max: 2,
    style: 'cooldown',
    regen: { interval: 30, amount: 1 },
  },
  'ast:intersection': {
    id: 'ast:intersection',
    name: '天星交错充能',
    job: 'AST',
    initial: 2,
    max: 2,
    style: 'cooldown',
    regen: { interval: 30, amount: 1 },
  },
  'sge:addersgall': {
    id: 'sge:addersgall',
    name: '蛇胆',
    job: 'SGE',
    initial: 3, // 开场满档
    max: 3,
    style: 'lightsWithBar',
    // 「20s 回 1 档」。同 whm:lily：消耗驱动（每次消耗后 20s 补 1），非 t=0 固定节拍。
    // 寄生清汁(24299) / 坚角清汁(24298) 共享本池，且各自仍保留 30s 自身 CD——故两 action 走
    // 双门 gating（显式声明 __cd__:${id} required + 本池消费者）：蛇胆够也得等 CD，CD 好也得有蛇胆。
    regen: { interval: 20, amount: 1 },
    unmetMessage: '蛇胆档数不足',
  },
}

// 模块导入时校验命名空间：每条显式 id 不得以 __cd__: 开头（保留给 compute 层合成的单充能池）。
for (const id of Object.keys(RESOURCE_REGISTRY)) {
  if (isSynthCdResource(id)) {
    throw new Error(`Resource id "${id}" conflicts with synthetic CD resource namespace`)
  }
}
