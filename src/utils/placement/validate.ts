import type { MitigationAction } from '@/types/mitigation'
import { effectiveTrackGroup } from '@/types/mitigation'

export type IssueLevel = 'error' | 'warn'
export type IssueRule =
  | 'trackgroup-missing'
  | 'trackgroup-chain'
  | 'trackgroup-placement-missing'
  | 'level-range-inverted'
  | 'level-overrides-unsorted'
  | 'level-override-dead'
  | 'level-override-empty'

export interface ValidationIssue {
  level: IssueLevel
  rule: IssueRule
  actionId: number
  message: string
}

export function validateActions(actions: MitigationAction[]): ValidationIssue[] {
  const byId = new Map(actions.map(a => [a.id, a]))
  const issues: ValidationIssue[] = []

  for (const action of actions) {
    if (
      action.minLevel !== undefined &&
      action.maxLevel !== undefined &&
      action.minLevel > action.maxLevel
    ) {
      issues.push({
        level: 'error',
        rule: 'level-range-inverted',
        actionId: action.id,
        message: `minLevel=${action.minLevel} > maxLevel=${action.maxLevel}`,
      })
    }

    const overrides = action.levelOverrides
    if (overrides) {
      for (let i = 1; i < overrides.length; i++) {
        if (overrides[i].upTo <= overrides[i - 1].upTo) {
          issues.push({
            level: 'error',
            rule: 'level-overrides-unsorted',
            actionId: action.id,
            message: `levelOverrides 必须按 upTo 严格升序：${overrides[i - 1].upTo} → ${overrides[i].upTo}`,
          })
          break
        }
      }
      for (const o of overrides) {
        if (action.minLevel !== undefined && o.upTo < action.minLevel) {
          issues.push({
            level: 'error',
            rule: 'level-override-dead',
            actionId: action.id,
            message: `覆盖层 upTo=${o.upTo} 低于 minLevel=${action.minLevel}，永不命中`,
          })
        }
        if (Object.keys(o.patch).length === 0) {
          issues.push({
            level: 'error',
            rule: 'level-override-empty',
            actionId: action.id,
            message: `覆盖层 upTo=${o.upTo} 的 patch 为空，无意义`,
          })
        }
      }
    }

    if (action.trackGroup !== undefined && action.trackGroup !== action.id) {
      const parent = byId.get(action.trackGroup)
      if (!parent) {
        issues.push({
          level: 'error',
          rule: 'trackgroup-missing',
          actionId: action.id,
          message: `trackGroup=${action.trackGroup} 指向不存在的 action`,
        })
        continue
      }
      if (parent.trackGroup !== undefined && parent.trackGroup !== parent.id) {
        issues.push({
          level: 'error',
          rule: 'trackgroup-chain',
          actionId: action.id,
          message: `trackGroup 链式：指向的 ${parent.id} 自己也有 trackGroup=${parent.trackGroup}`,
        })
      }
    }
  }

  const byGroup = new Map<number, MitigationAction[]>()
  for (const action of actions) {
    const gid = effectiveTrackGroup(action)
    const arr = byGroup.get(gid) ?? []
    arr.push(action)
    byGroup.set(gid, arr)
  }

  for (const [gid, members] of byGroup) {
    if (members.length < 2) continue
    const anyHasPlacement = members.some(m => m.placement)
    if (anyHasPlacement) {
      for (const m of members) {
        if (!m.placement) {
          issues.push({
            level: 'error',
            rule: 'trackgroup-placement-missing',
            actionId: m.id,
            message: `同轨组 ${gid} 成员必须都声明 placement`,
          })
        }
      }
    }
  }

  return issues
}
