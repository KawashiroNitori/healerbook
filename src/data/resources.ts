/**
 * 资源池 registry
 *
 * 设计文档：design/superpowers/specs/2026-04-24-resource-model-design.md
 *
 * 约束：显式资源 id **不得**以 '__cd__:' 开头 —— 该前缀保留给 compute 层合成的单充能池。
 */

import type { ResourceDefinition } from '@/types/resource'

export const RESOURCE_REGISTRY: Record<string, ResourceDefinition> = {
  'sch:consolation': {
    id: 'sch:consolation',
    name: '慰藉充能',
    job: 'SCH',
    initial: 2, // 战斗开始满充能
    max: 2,
    // regen.interval 与 mitigationActions.ts 中慰藉 (16546) 的 cooldown 保持一致（后者含消费者时
    // 仅信息性，两者改动需同步）。
    //
    // initial=2 不代表战斗起手可用：placement: whileStatus(3095) 在首炽天（≈t=120）前
    // 完全封住慰藉，满充能仅用于简化"每次炽天触发时必定满充能"的不变量验证。
    // 若 placement 规则变更，需同步评估 initial 值的合理性。
    regen: { interval: 30, amount: 1 },
  },
  'drk:oblation': {
    id: 'drk:oblation',
    name: '献奉充能',
    job: 'DRK',
    initial: 2,
    max: 2,
    // regen.interval 与 mitigationActions.ts 中献奉 (25754) 的 cooldown 保持一致（后者含消费者时
    // 仅信息性，两者改动需同步）。
    regen: { interval: 60, amount: 1 },
  },
}

// 模块导入时校验命名空间：每条显式 id 不得以 __cd__: 开头（保留给 compute 层合成的单充能池）。
for (const id of Object.keys(RESOURCE_REGISTRY)) {
  if (id.startsWith('__cd__:')) {
    throw new Error(`Resource id "${id}" conflicts with synthetic CD resource namespace`)
  }
}
