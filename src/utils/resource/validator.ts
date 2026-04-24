/**
 * 资源池合法性校验
 *
 * 设计文档：design/superpowers/specs/2026-04-24-resource-model-design.md
 */

import type { MitigationAction } from '@/types/mitigation'
import type { CastEvent } from '@/types/timeline'
import type { ResourceDefinition, ResourceExhaustion } from '@/types/resource'
import { deriveResourceEvents } from './compute'

/**
 * 合成 `__cd__:${actionId}` 资源池定义。
 * 只在查到不存在 registry[resourceId] 且 id 以 '__cd__:' 开头时返回。
 */
function syntheticCdDef(resourceId: string, actionCd: number): ResourceDefinition {
  return {
    id: resourceId,
    name: `Synthetic CD ${resourceId}`,
    job: 'SCH', // 合成池 job 无意义，随便填
    initial: 1,
    max: 1,
    regen: { interval: actionCd, amount: 1 },
  }
}

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

    // 沿事件遍历，在每个 delta<0 事件应用前检查 amount < |delta|
    let amount = def.initial
    const pending: number[] = []
    const firePendingUpTo = (t: number) => {
      while (pending.length > 0 && pending[0] <= t) {
        pending.shift()
        if (def.regen) amount = Math.min(amount + def.regen.amount, def.max)
      }
    }

    for (const ev of events) {
      firePendingUpTo(ev.timestamp)
      if (ev.delta < 0 && ev.required) {
        const threshold = -ev.delta
        if (amount < threshold) {
          exhaustions.push({
            castEventId: ev.castEventId,
            resourceKey,
            resourceId,
            playerId: ev.playerId,
          })
        }
      }
      amount = Math.min(amount + ev.delta, def.max)
      if (ev.delta < 0 && def.regen) {
        const count = -ev.delta
        for (let k = 0; k < count; k++) {
          pending.push(ev.timestamp + def.regen.interval)
        }
      }
    }
  }

  return exhaustions
}
