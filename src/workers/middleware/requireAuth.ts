import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../env'
import { readAuthFromHeader } from './readAuthFromHeader'

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const auth = await readAuthFromHeader(c)
  if (!auth) return c.json({ error: 'Unauthorized' }, 401)
  c.set('auth', auth)
  await next()
}
