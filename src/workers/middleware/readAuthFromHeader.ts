import type { Context } from 'hono'
import type { AppEnv } from '../env'
import { verifyToken } from '../jwt'

/**
 * 从 Authorization 头解析并校验 JWT，返回身份信息或 null。
 * 无响应/context 副作用——失败时如何处理由调用方决定：
 * requireAuth 转 401；公开路由（如 GET timelines/:id）降级为匿名 viewer。
 */
export async function readAuthFromHeader(
  c: Context<AppEnv>
): Promise<{ userId: string; username: string } | null> {
  const header = c.req.header('Authorization')
  if (!header?.startsWith('Bearer ') || !c.env.JWT_SECRET) return null
  const token = header.slice(7)
  const result = await verifyToken(token, c.env.JWT_SECRET)
  if (!result.ok || !result.payload.sub) return null
  const name = (result.payload as { name?: string }).name ?? ''
  return { userId: result.payload.sub, username: name }
}
