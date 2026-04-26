import type { MitigationAction } from '@/types/mitigation'
import { effectiveTrackGroup } from '@/types/mitigation'

export type IssueLevel = 'error' | 'warn'
export type IssueRule =
  | 'trackgroup-missing'
  | 'trackgroup-chain'
  | 'trackgroup-placement-missing'
  | 'trackgroup-cooldown-mismatch'

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
    // 只检测"真·变体"互相 cd 不一致（如 37013/37016 同键变体应当有相同 cd）。
    // place/collect 型（25862 主技能 cd=180 + 28509 跟随 cast cd=0）共享 trackGroup 但 cd
    // 必然不同，不应误报；用 cd>0 过滤掉跟随 cast 后再比较。
    const positiveCds = new Set(members.filter(m => m.cooldown > 0).map(m => m.cooldown))
    if (positiveCds.size > 1) {
      for (const m of members) {
        issues.push({
          level: 'warn',
          rule: 'trackgroup-cooldown-mismatch',
          actionId: m.id,
          message: `同轨组 ${gid} cooldown 不一致：${Array.from(positiveCds).join(', ')}`,
        })
      }
    }
  }

  return issues
}
