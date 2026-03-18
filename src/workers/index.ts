/// <reference types="@cloudflare/workers-types" />

/**
 * Cloudflare Worker 入口文件
 *
 * 导出 Cloudflare Workers 需要的入口函数：
 * - fetch: HTTP 请求处理
 * - scheduled: Cron 定时任务
 * - queue: Queue 消费者
 */

import { handleFetch, handleScheduled, handleQueue, type Env } from './fflogs-proxy'

export type { Env }

export default {
  /**
   * HTTP 请求处理
   */
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleFetch(request, env)
  },

  /**
   * Cron 定时任务：将所有遭遇战推送到队列
   * 触发频率见 wrangler.toml [triggers.crons]
   */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    return handleScheduled(event, env, ctx)
  },

  /**
   * Queue 消费者：处理队列消息
   */
  async queue(batch: MessageBatch, env: Env): Promise<void> {
    return handleQueue(batch, env)
  },
}
