import { useTimelineStore } from '@/store/timelineStore'
import { resolveActions, type ResolvedActionSet } from '@/data/resolveAction'
import { DEFAULT_LEVEL } from '@/types/level'

/**
 * UI 层获取「当前时间轴等级下的有效技能表」的唯一入口。
 *
 * resolveActions 内部按等级缓存，返回引用稳定，可直接进 useMemo 依赖数组。
 */
export function useResolvedActions(): ResolvedActionSet {
  const level = useTimelineStore(s => s.timeline?.level) ?? DEFAULT_LEVEL
  return resolveActions(level)
}
