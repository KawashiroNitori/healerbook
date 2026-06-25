/**
 * 战斗资源悬浮窗：按成员算出某时刻的资源部件快照（纯函数）。
 *
 * - cooldowns：每个可见技能轨道一个 CD 部件。代表消耗优先取自身 __cd__，否则取首个 delta<0；
 *   仅当代表池 style==='cooldown' 才纳入（多档共享池由 pools 表达，跳过）。
 * - pools：该职业的非 cooldown 显式池（lights / lightsWithBar / progressBar），按 registry 顺序。
 * 成员顺序与 tracks 一致（useSkillTracks 已按职业序），仅含有可见轨道的玩家。
 */

import type { Job } from '@/data/jobs'
import type { MitigationAction } from '@/types/mitigation'
import type { ResourceDefinition, ResourceEvent, ResourceStyle } from '@/types/resource'
import type { SkillTrack } from '@/utils/skillTracks'
import { effectsForAction, resolveDef, computeResourceStateAt } from './compute'

export interface ResourceWidget {
  resourceId: string
  style: ResourceStyle
  name: string
  /** cooldown 样式：代表技能图标路径 */
  icon?: string
  amount: number
  max: number
  /** 仅 amount<max 且有 regen：距下一充能恢复剩余秒 */
  countdownSec?: number
  /** 仅 amount<max 且有 regen：下一充能积累进度 [0,1] */
  nextChargeProgress?: number
  /** cooldown 部件专用：对应技能 id，供 React key 稳定化 */
  actionId?: number
}

export interface MemberResourceSnapshot {
  playerId: number
  job: Job
  pools: ResourceWidget[]
  cooldowns: ResourceWidget[]
}

export interface SnapshotInput {
  tracks: SkillTrack[]
  actionsById: Map<number, MitigationAction>
  registry: Record<string, ResourceDefinition>
  resourceEventsByKey: Map<string, ResourceEvent[]>
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

function buildWidget(
  def: ResourceDefinition,
  events: ResourceEvent[],
  time: number,
  meta: { name: string; icon?: string }
): ResourceWidget {
  const { amount, pending } = computeResourceStateAt(def, events, time)
  const w: ResourceWidget = {
    resourceId: def.id,
    style: def.style,
    name: meta.name,
    icon: meta.icon,
    amount,
    max: def.max,
  }
  if (amount < def.max && def.regen && pending.length > 0) {
    const earliest = pending[0]
    w.countdownSec = earliest - time
    w.nextChargeProgress = clamp01((time - (earliest - def.regen.interval)) / def.regen.interval)
  }
  return w
}

export function computeResourceSnapshots(
  input: SnapshotInput,
  time: number
): MemberResourceSnapshot[] {
  const { tracks, actionsById, registry, resourceEventsByKey } = input

  // 按玩家分组，保留 tracks 顺序（= 职业序 + mitigationActions 文件序）
  const order: number[] = []
  const byPlayer = new Map<number, { job: Job; tracks: SkillTrack[] }>()
  for (const t of tracks) {
    let e = byPlayer.get(t.playerId)
    if (!e) {
      e = { job: t.job, tracks: [] }
      byPlayer.set(t.playerId, e)
      order.push(t.playerId)
    }
    e.tracks.push(t)
  }

  // 变身组父 id 集合：某 action 有 trackGroup 指向另一个 action → 被指向者是父。
  // 父轨道的 CD 事件键入了变体 id，状态不可靠；产品决策：悬浮窗不展示变身组父轨道的 CD。
  const variantParentIds = new Set<number>()
  for (const a of actionsById.values()) {
    if (a.trackGroup != null && a.trackGroup !== a.id) {
      variantParentIds.add(a.trackGroup)
    }
  }

  const result: MemberResourceSnapshot[] = []
  for (const playerId of order) {
    const { job, tracks: playerTracks } = byPlayer.get(playerId)!

    const cooldowns: ResourceWidget[] = []
    for (const tr of playerTracks) {
      const action = actionsById.get(tr.actionId)
      if (!action) continue
      // 变身组父轨道：CD 事件键入了变体 id，状态不可靠，跳过
      if (variantParentIds.has(tr.actionId)) continue
      // 低CD技能（< 30s）不在悬浮窗展示
      if (action.cooldown < 30) continue
      const consumes = effectsForAction(action).filter(e => e.delta < 0)
      // 代表消耗：优先自身 __cd__，否则首个 delta<0
      const consume = consumes.find(e => e.resourceId.startsWith('__cd__:')) ?? consumes[0]
      if (!consume) continue
      const def = resolveDef(consume.resourceId, registry, action)
      if (!def || def.style !== 'cooldown') continue // 多档共享池由 pools 表达
      const events = resourceEventsByKey.get(`${playerId}:${consume.resourceId}`) ?? []
      const w = buildWidget(def, events, time, { name: action.name, icon: action.icon })
      cooldowns.push({ ...w, actionId: action.id })
    }

    const pools: ResourceWidget[] = []
    for (const def of Object.values(registry)) {
      if (def.job !== job || def.style === 'cooldown') continue
      const events = resourceEventsByKey.get(`${playerId}:${def.id}`) ?? []
      pools.push(buildWidget(def, events, time, { name: def.name }))
    }

    result.push({ playerId, job, pools, cooldowns })
  }
  return result
}
