/** 距下次自动重连的剩余秒数(向上取整);计时器到点但状态尚未切换时兜底为 1 */
export function retrySecondsLeft(nextRetryAt: number, now: number): number {
  return Math.max(1, Math.ceil((nextRetryAt - now) / 1000))
}
