import { signAccessToken, signRefreshToken, verifyToken } from './jwt'
import type { Env } from './fflogs-proxy'

interface FFLogsTokenResponse {
  access_token: string
  token_type: string
  expires_in: number
}

interface FFLogsUserResponse {
  data?: {
    currentUser?: {
      id: number
      name: string
    }
  }
}

async function exchangeCodeForToken(
  code: string,
  env: Env
): Promise<FFLogsTokenResponse> {
  if (!env.FFLOGS_OAUTH_CLIENT_ID || !env.FFLOGS_OAUTH_CLIENT_SECRET || !env.FFLOGS_OAUTH_REDIRECT_URI) {
    throw new Error('OAuth credentials not configured')
  }

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: env.FFLOGS_OAUTH_CLIENT_ID,
    client_secret: env.FFLOGS_OAUTH_CLIENT_SECRET,
    redirect_uri: env.FFLOGS_OAUTH_REDIRECT_URI,
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

async function fetchFFLogsUser(
  accessToken: string
): Promise<{ id: number; name: string }> {
  const response = await fetch('https://www.fflogs.com/api/v2/client', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ query: '{ currentUser { id name } }' }),
  })

  if (!response.ok) {
    throw new Error(`FFLogs user info failed: ${response.status}`)
  }

  const data = (await response.json()) as FFLogsUserResponse
  const user = data.data?.currentUser
  if (!user) {
    throw new Error('Failed to get user info from FFLogs')
  }

  return user
}

export async function handleAuthCallback(request: Request, env: Env): Promise<Response> {
  if (!env.JWT_SECRET) {
    return jsonError('JWT_SECRET not configured', 500)
  }

  let code: string
  try {
    const body = (await request.json()) as { code?: string }
    if (!body.code) {
      return jsonError('Missing code', 400)
    }
    code = body.code
  } catch {
    return jsonError('Invalid request body', 400)
  }

  try {
    const tokenResponse = await exchangeCodeForToken(code, env)
    const user = await fetchFFLogsUser(tokenResponse.access_token)

    const userId = String(user.id)
    const [accessToken, refreshToken] = await Promise.all([
      signAccessToken(userId, user.name, env.JWT_SECRET),
      signRefreshToken(userId, env.JWT_SECRET),
    ])

    return jsonOk({ access_token: accessToken, refresh_token: refreshToken, name: user.name })
  } catch (error) {
    console.error('[Auth] callback error:', error)
    return jsonError(
      error instanceof Error ? error.message : 'OAuth callback failed',
      400
    )
  }
}

export async function handleAuthRefresh(request: Request, env: Env): Promise<Response> {
  if (!env.JWT_SECRET) {
    return jsonError('JWT_SECRET not configured', 500)
  }

  let refreshToken: string
  try {
    const body = (await request.json()) as { refresh_token?: string }
    if (!body.refresh_token) {
      return jsonError('Missing refresh_token', 400)
    }
    refreshToken = body.refresh_token
  } catch {
    return jsonError('Invalid request body', 400)
  }

  const result = await verifyToken(refreshToken, env.JWT_SECRET)

  if (!result.ok || !result.payload.sub) {
    return jsonError('Invalid or expired refresh token', 401)
  }

  try {
    // refresh token 中无 name，续期时 name 使用空字符串占位
    // 前端展示 username 依赖 authStore 缓存值，不重新从 JWT 读取
    const accessToken = await signAccessToken(result.payload.sub, '', env.JWT_SECRET)
    return jsonOk({ access_token: accessToken })
  } catch (error) {
    console.error('[Auth] refresh error:', error)
    return jsonError('Failed to issue new access token', 500)
  }
}

function jsonOk(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
