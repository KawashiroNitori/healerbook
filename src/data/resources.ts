/**
 * 资源池 registry
 *
 * 设计文档：design/superpowers/specs/2026-04-24-resource-model-design.md
 *
 * 约束：显式资源 id **不得**以 '__cd__:' 开头 —— 该前缀保留给 compute 层合成的单充能池。
 */

import type { ResourceDefinition } from '@/types/resource'

export const RESOURCE_REGISTRY: Record<string, ResourceDefinition> = {}

// 模块导入时校验命名空间不冲突
for (const id of Object.keys(RESOURCE_REGISTRY)) {
  if (id.startsWith('__cd__:')) {
    throw new Error(`Resource id "${id}" conflicts with synthetic CD resource namespace`)
  }
}
