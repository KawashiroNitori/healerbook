/**
 * status 生效窗判定的单一定义点。
 * 两种边界口径并存且均为有意设计（本期不统一，统一属行为变更须单独决策）：
 * - 'closed'：t ∈ [startTime, endTime]。mitigationCalculator 全系采用
 *   （减伤/盾/参考HP/钩子派发/tick 判定，endTime 那一刻 buff 仍生效）。
 * - 'excludeEnd'：t ∈ [startTime, endTime)。healMath 系采用
 *   （治疗/HP池视角，endTime 那一刻已失效；healMath.test.ts 边界用例锚定）。
 */
export type StatusWindowBoundary = 'closed' | 'excludeEnd'

export function isStatusActiveAt(
  status: { startTime: number; endTime: number },
  time: number,
  boundary: StatusWindowBoundary
): boolean {
  if (time < status.startTime) return false
  return boundary === 'closed' ? time <= status.endTime : time < status.endTime
}
