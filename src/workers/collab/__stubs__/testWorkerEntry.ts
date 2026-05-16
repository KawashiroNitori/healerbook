/**
 * 最小 Worker 入口 —— 仅供 vitest.workers.config.ts 使用。
 * 只导出 TimelineDoc DO 类，避免拉入完整 app（会触发 @ff14-overlay/resources 解析）。
 */
export { TimelineDoc } from '../../durable/TimelineDoc'

export default {
  fetch() {
    return new Response('test-worker-stub', { status: 200 })
  },
}
