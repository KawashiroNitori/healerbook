/// <reference types="@cloudflare/workers-types" />

import { Hono } from 'hono'
import { vValidator } from '@hono/valibot-validator'
import * as v from 'valibot'
import type { AppEnv } from '../env'
import type { Env } from '../env'
import { isAllowedOrigin } from '../allowedOrigins'
import { signAccessToken, signRefreshToken, verifyToken } from '../jwt'
import { loginWithOAuth } from '../userCredentials'

interface FFLogsTokenResponse {
  access_token: string
  token_type: string
  expires_in: number
}

interface FFLogsUserResponse {
  data?: {
    userData?: {
      currentUser?: {
        id: number
        name: string
      }
    }
  }
}

/**
 * 校验请求来源域名并据此推导 OAuth redirect_uri。
 *
 * - 生产环境：`origin` 必须命中自家站点白名单（见 {@link isAllowedOrigin}）。
 * - 开发模式：放行任意来源（只要能解析为合法 URL）。
 *
 * @returns `${origin}/callback`；来源缺失或不被允许时返回 null。
 */
export function resolveRedirectUri(
  origin: string | null | undefined,
  isDev: boolean
): string | null {
  if (!origin) return null
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return null
  }
  if (!isDev && !isAllowedOrigin(origin)) return null
  return `${url.origin}/callback`
}

async function exchangeCodeForToken(
  code: string,
  redirectUri: string,
  env: Env
): Promise<FFLogsTokenResponse> {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: env.FFLOGS_CLIENT_ID!,
    client_secret: env.FFLOGS_CLIENT_SECRET!,
    redirect_uri: redirectUri,
    code,
  })

  const response = await fetch('https://www.fflogs.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })

  if (!response.ok) {
    throw new Error(`FFLogs token exchange failed: ${response.status}`)
  }
  return response.json() as Promise<FFLogsTokenResponse>
}

async function fetchFFLogsUser(accessToken: string): Promise<{ id: number; name: string }> {
  const response = await fetch('https://www.fflogs.com/api/v2/user', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ query: '{ userData { currentUser { id name } } }' }),
  })

  if (!response.ok) {
    throw new Error(`FFLogs user info failed: ${response.status}`)
  }

  const data = (await response.json()) as FFLogsUserResponse
  const user = data.data?.userData?.currentUser
  if (!user) throw new Error('Failed to get user info from FFLogs')
  return user
}

const CallbackSchema = v.object({ code: v.string() })
const RefreshSchema = v.object({ refresh_token: v.string() })

const app = new Hono<AppEnv>()

app.post('/callback', vValidator('json', CallbackSchema), async c => {
  if (!c.env.JWT_SECRET || !c.env.FFLOGS_CLIENT_ID || !c.env.FFLOGS_CLIENT_SECRET) {
    return c.json({ error: 'Server configuration error' }, 500)
  }
  const isDev = c.env.ENVIRONMENT !== 'production'
  const redirectUri = resolveRedirectUri(c.req.header('Origin'), isDev)
  if (!redirectUri) {
    return c.json({ error: 'Origin not allowed' }, 403)
  }
  const { code } = c.req.valid('json')
  let user: { id: number; name: string }
  let tokenResponse: FFLogsTokenResponse
  try {
    tokenResponse = await exchangeCodeForToken(code, redirectUri, c.env)
    user = await fetchFFLogsUser(tokenResponse.access_token)
  } catch (error) {
    console.error('[Auth] callback error:', error)
    return c.json({ error: 'OAuth callback failed' }, 400)
  }

  const expiresAt = Math.floor(Date.now() / 1000) + tokenResponse.expires_in
  let userId: number
  try {
    const result = await loginWithOAuth(c.env.healerbook_timelines, {
      provider: 'fflogs',
      providerUserId: String(user.id),
      name: user.name,
      accessToken: tokenResponse.access_token,
      refreshToken: '', // fflogs 授权码流程不下发 refresh_token
      expiresAt,
    })
    userId = result.userId
  } catch (error) {
    console.error('[Auth] persist error:', error)
    return c.json({ error: 'Login persistence failed' }, 500)
  }

  const sub = String(userId)
  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken(sub, user.name, c.env.JWT_SECRET),
    signRefreshToken(sub, user.name, c.env.JWT_SECRET),
  ])
  return c.json({
    access_token: accessToken,
    refresh_token: refreshToken,
    name: user.name,
    user_id: sub,
  })
})

app.post('/refresh', vValidator('json', RefreshSchema), async c => {
  if (!c.env.JWT_SECRET) {
    return c.json({ error: 'Server configuration error' }, 500)
  }
  const { refresh_token } = c.req.valid('json')

  const result = await verifyToken(refresh_token, c.env.JWT_SECRET)
  if (!result.ok || !result.payload.sub) {
    return c.json({ error: 'Invalid or expired refresh token' }, 401)
  }
  if (result.payload['type'] !== 'refresh') {
    return c.json({ error: 'Invalid token type' }, 401)
  }

  try {
    const username = (result.payload as { name?: string }).name ?? ''
    const accessToken = await signAccessToken(result.payload.sub, username, c.env.JWT_SECRET)
    return c.json({ access_token: accessToken })
  } catch (error) {
    console.error('[Auth] refresh error:', error)
    return c.json({ error: 'Failed to issue new access token' }, 500)
  }
})

export { app as authRoutes }
