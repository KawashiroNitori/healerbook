// src/utils/syncScrollProgress.ts
// 时间轴视图与表格视图之间的共享滚动进度（0-1）。
// 仅用于视图切换时还原另一侧的滚动位置，没有订阅者，
// 因此放在模块级变量而不是 Zustand store，避免在滚动时触发全局重渲染。

let syncScrollProgress = 0

export function getSyncScrollProgress(): number {
  return syncScrollProgress
}

export function setSyncScrollProgress(progress: number): void {
  syncScrollProgress = progress
}
