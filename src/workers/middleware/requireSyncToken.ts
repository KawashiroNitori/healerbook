import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../env'

export const requireSyncToken: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header('Authorization')
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null
  if (!token || !c.env.SYNC_AUTH_TOKEN || token !== c.env.SYNC_AUTH_TOKEN) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  await next()
}
