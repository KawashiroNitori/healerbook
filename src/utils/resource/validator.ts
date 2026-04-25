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

/**
 * 探测：若在 (playerId, t) 处放一个 action 的 cast，会因哪个显式资源的 `unmetMessage` 触发文案？
 *
 * 用于双击轨道等"添加被拦截"场景给 toast 提供资源专属文案。
 * - action 没 resourceEffects → 直接 null（不会走资源校验）
 * - 探测 cast 因合成 `__cd__:` 资源耗尽 → null（合成资源不在 registry 中，普通 cooldown 走通用文案）
 * - 因显式资源耗尽且该 def 配置了 unmetMessage → 返回该文案
 * - 否则 null（资源够用，或耗尽资源未配置文案，由调用方 fallback）
 *
 * 探测 id 为 `__probe__`，并强制按 timestamp 升序合并；event 排序不影响 compute 层正确性，
 * 但保持与 deriveResourceEvents 一致便于排查。
 */
export function probeResourceUnmetMessage(
  action: MitigationAction,
  playerId: number,
  timestamp: number,
  existingCastEvents: CastEvent[],
  actions: Map<number, MitigationAction>,
  registry: Record<string, ResourceDefinition>
): string | null {
  if (!action.resourceEffects?.length) return null
  const probeId = '__probe__'
  const probe: CastEvent = {
    id: probeId,
    actionId: action.id,
    timestamp,
    playerId,
  } as CastEvent
  const merged = [...existingCastEvents, probe].sort((a, b) => a.timestamp - b.timestamp)
  const exhausted = findResourceExhaustedCasts(merged, actions, registry)
  for (const ex of exhausted) {
    if (ex.castEventId !== probeId) continue
    const def = registry[ex.resourceId]
    if (def?.unmetMessage) return def.unmetMessage
  }
  return null
}
