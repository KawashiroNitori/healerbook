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
    regen: { interval: 30, amount: 1 }, // 自充能 30s/层
  },
  'drk:oblation': {
    id: 'drk:oblation',
    name: '献奉充能',
    job: 'DRK',
    initial: 2,
    max: 2,
    regen: { interval: 60, amount: 1 },
  },
}

// 模块导入时校验命名空间不冲突。
// 当前 registry 为空，断言实际不执行；阶段 4 填入条目后生效。
for (const id of Object.keys(RESOURCE_REGISTRY)) {
  if (id.startsWith('__cd__:')) {
    throw new Error(`Resource id "${id}" conflicts with synthetic CD resource namespace`)
  }
}
