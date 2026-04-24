/**
 * 资源池合法性校验
 *
 * 设计文档：design/superpowers/specs/2026-04-24-resource-model-design.md
 */

import type { MitigationAction } from '@/types/mitigation'
import type { CastEvent } from '@/types/timeline'
import type { ResourceDefinition, ResourceExhaustion } from '@/types/resource'
import { computeResourceTrace, deriveResourceEvents, syntheticCdDef } from './compute'

/**
 * 返回所有因资源不足被判非法的 cast。
 *
 * @param excludeId 拖拽预览：排除正被拖动的 cast 重算。
 */
export function findResourceExhaustedCasts(
  castEvents: CastEvent[],
  actions: Map<number, MitigationAction>,
  registry: Record<string, ResourceDefinition>,
  excludeId?: string
): ResourceExhaustion[] {
  const filteredCasts = excludeId ? castEvents.filter(ce => ce.id !== excludeId) : castEvents
  const grouped = deriveResourceEvents(filteredCasts, actions)
  const exhaustions: ResourceExhaustion[] = []

  for (const [resourceKey, events] of grouped.entries()) {
    if (events.length === 0) continue
    const resourceId = events[0].resourceId
    let def = registry[resourceId]
    if (!def && resourceId.startsWith('__cd__:')) {
      const actionId = Number(resourceId.slice('__cd__:'.length))
      const action = actions.get(actionId)
      if (!action) continue
      def = syntheticCdDef(resourceId, action.cooldown)
    }
    if (!def) continue

    const trace = computeResourceTrace(def, events)
    for (let i = 0; i < events.length; i++) {
      const ev = events[i]
      if (ev.delta < 0 && ev.required) {
        const threshold = -ev.delta
        if (trace[i].amountBefore < threshold) {
          exhaustions.push({
            castEventId: ev.castEventId,
            resourceKey,
            resourceId,
            playerId: ev.playerId,
          })
        }
      }
    }
  }

  return exhaustions
}
