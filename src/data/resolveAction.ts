import type { MitigationAction } from '@/types/mitigation'
import type { Level } from '@/types/level'
import { ACTIONS } from './mitigationActions'

export interface ResolvedActionSet {
  /** 已滤掉区间外的技能，且覆盖层已合并 */
  actions: MitigationAction[]
  actionMap: Map<number, MitigationAction>
}

/**
 * 把基线 action 与命中的等级覆盖层合并成「有效 action」。
 *
 * 区间外返回 null。覆盖层按 upTo 升序取**第一个**满足 level <= upTo 的层，
 * 只命中一层不叠加——每层是该等级段的完整快照。
 */
export function resolveAction(action: MitigationAction, level: number): MitigationAction | null {
  if (action.minLevel !== undefined && level < action.minLevel) return null
  if (action.maxLevel !== undefined && level > action.maxLevel) return null

  const hit = action.levelOverrides?.find(o => level <= o.upTo)
  if (!hit) return action

  return { ...action, ...hit.patch }
}

/** 静态数据不可变，缓存永不失效；档位固定为 4 个，常驻开销可忽略 */
const cache = new Map<Level, ResolvedActionSet>()

export function resolveActions(level: Level): ResolvedActionSet {
  const cached = cache.get(level)
  if (cached) return cached

  const actions: MitigationAction[] = []
  for (const a of ACTIONS) {
    const resolved = resolveAction(a, level)
    if (resolved) actions.push(resolved)
  }
  const set: ResolvedActionSet = {
    actions,
    actionMap: new Map(actions.map(a => [a.id, a])),
  }
  cache.set(level, set)
  return set
}

/**
 * 测试专用：清空 memo 缓存。
 * 生产环境下 ACTIONS 不可变，缓存假设成立；测试若直接 mutate
 * MITIGATION_DATA.actions（注入临时 fixture action）需要调用本函数，
 * 强制下一次 resolveActions() 重新读取最新数组，否则会命中缓存里的旧快照。
 */
export function __resetResolveActionsCacheForTesting(): void {
  cache.clear()
}
