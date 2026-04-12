# FFLogs OAuth 登录 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 FFLogs OAuth 登录，在右上角展示登录状态，API 请求自动携带 JWT，为后续时间轴分享功能提供身份基础。

**Architecture:** Cloudflare Worker 处理 OAuth code 换 token、签发双 JWT（access 1h / refresh 30d）；前端使用 AuthContext + Zustand authStore 持久化 token；CallbackPage 验证 state（防 CSRF）后向 Worker 换取 JWT。API 请求在 fflogsClient.ts 中自动附加 Authorization header，401 时自动尝试续期。

**Tech Stack:** React 19, TypeScript, Zustand + persist middleware, Cloudflare Workers, `jose`（JWT 签发/验证），`nanoid`（已安装）

---

## 文件清单

### 新增

| 文件                            | 职责                                                                   |
| ------------------------------- | ---------------------------------------------------------------------- |
| `src/workers/auth.ts`           | Worker auth 路由：`/api/auth/callback` 和 `/api/auth/refresh`          |
| `src/workers/jwt.ts`            | JWT 工具：sign / verify，封装 Web Crypto API 或 jose                   |
| `src/store/authStore.ts`        | Zustand store（persist），持久化 accessToken / refreshToken / username |
| `src/contexts/AuthContext.tsx`  | React Context，提供 `useAuth()` hook，封装 login / logout              |
| `src/pages/CallbackPage.tsx`    | `/callback` 路由页，验证 state，POST code 给 Worker，存 token          |
| `src/components/AuthButton.tsx` | 右上角登录/退出按钮                                                    |

### 修改

| 文件                          | 改动                                                                 |
| ----------------------------- | -------------------------------------------------------------------- |
| `src/workers/fflogs-proxy.ts` | `Env` 接口添加 4 个新变量；`handleFetch` 路由增加 `/api/auth/*` 分支 |
| `src/store/index.ts`          | 导出 `useAuthStore`                                                  |
| `src/App.tsx`                 | 添加 `<AuthProvider>` 包裹；添加 `/callback` 路由                    |
| `src/pages/HomePage.tsx`      | 右上角加入 `<AuthButton />`                                          |
| `src/api/fflogsClient.ts`     | 请求时附加 `Authorization` header；401 时自动续期后重试              |
| `.dev.vars.example`           | 添加 4 个新环境变量示例                                              |

---

## Task 1: 安装 jose + 更新环境变量示例

**Files:**

- Modify: `.dev.vars.example`

- [ ] **Step 1: 安装 jose**

```bash
pnpm add jose
```

Expected: `jose` 出现在 `package.json` dependencies 中。

- [ ] **Step 2: 在 `.dev.vars.example` 末尾追加新变量**

打开 `.dev.vars.example`，在文件末尾添加：

```
# FFLogs OAuth 用户登录（Authorization Code Flow）
# 注意：与上方 FFLOGS_CLIENT_ID/SECRET 不同，这里是专用于用户登录的 OAuth App
FFLOGS_OAUTH_CLIENT_ID=your_oauth_client_id_here
FFLOGS_OAUTH_CLIENT_SECRET=your_oauth_client_secret_here
FFLOGS_OAUTH_REDIRECT_URI=http://localhost:5173/callback

# JWT 签名密钥（HMAC-SHA256），生成方式: openssl rand -hex 32
JWT_SECRET=your_jwt_secret_here
```

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml .dev.vars.example
git commit -m "chore: add jose dependency and OAuth env var examples"
```

---

## Task 2: Worker - JWT 工具函数

**Files:**

- Create: `src/workers/jwt.ts`

JWT 工具使用 `jose` 库（支持 Cloudflare Workers 的 Web Crypto API）。

- [ ] **Step 1: 创建 `src/workers/jwt.ts`**

```typescript
import { SignJWT, jwtVerify, type JWTPayload } from 'jose'
import { nanoid } from 'nanoid'

const ALGORITHM = 'HS256'
const ACCESS_TOKEN_TTL = 60 * 60 // 1 小时（秒）
const REFRESH_TOKEN_TTL = 60 * 60 * 24 * 30 // 30 天（秒）

function getSecretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret)
}

export interface AccessTokenPayload extends JWTPayload {
  sub: string // FFLogs user ID（字符串）
  name: string // FFLogs username
  jti: string
}

export interface RefreshTokenPayload extends JWTPayload {
  sub: string
  jti: string
}

export async function signAccessToken(
  userId: string,
  username: string,
  secret: string
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({ name: username })
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(userId)
    .setJti(nanoid())
    .setIssuedAt(now)
    .setExpirationTime(now + ACCESS_TOKEN_TTL)
    .sign(getSecretKey(secret))
}

export async function signRefreshToken(userId: string, secret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({})
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(userId)
    .setJti(nanoid())
    .setIssuedAt(now)
    .setExpirationTime(now + REFRESH_TOKEN_TTL)
    .sign(getSecretKey(secret))
}

export async function verifyToken(token: string, secret: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey(secret), {
      algorithms: [ALGORITHM],
    })
    return payload
  } catch {
    return null
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/workers/jwt.ts
git commit -m "feat(worker): add JWT sign/verify utility using jose"
```

---

## Task 3: Worker - Env 接口更新 + auth 路由注册

**Files:**

- Modify: `src/workers/fflogs-proxy.ts`

- [ ] **Step 1: 更新 `Env` 接口**

在 `src/workers/fflogs-proxy.ts` 中找到 `export interface Env {`，在已有字段后追加：

```typescript
  // FFLogs 用户端 OAuth（Authorization Code Flow）
  FFLOGS_OAUTH_CLIENT_ID?: string
  FFLOGS_OAUTH_CLIENT_SECRET?: string
  FFLOGS_OAUTH_REDIRECT_URI?: string
  // JWT 签名密钥
  JWT_SECRET?: string
```

- [ ] **Step 2: 在 `handleFetch` 路由分发中注册 `/api/auth/*`**

找到 `handleFetch` 函数的 `try {` 块，在紧接 `try {` 之后、`if (path.startsWith('/api/fflogs/report/'))` 之前插入两行，并将原 `if` 改为 `else if`：

```typescript
  try {
    if (path === '/api/auth/callback' && request.method === 'POST') {
      return await handleAuthCallback(request, env)
    } else if (path === '/api/auth/refresh' && request.method === 'POST') {
      return await handleAuthRefresh(request, env)
    } else if (path.startsWith('/api/fflogs/report/')) {
      return await handleReport(request, env)
    } else if (path.startsWith('/api/fflogs/events/')) {
      return await handleEvents(request, env)
    } else if (path === '/api/top100') {
      return await handleTop100All(env)
    } else if (path === '/api/top100/sync' && request.method === 'POST') {
      return await handleManualSync(request, env)
    } else if (path.startsWith('/api/top100/')) {
      return await handleTop100Encounter(request, env)
    } else if (path.startsWith('/api/statistics/')) {
      return await handleStatistics(request, env)
    } else {
      return jsonResponse({ error: 'Not Found' }, 404)
    }
  }
```

这是完整的路由链，直接替换 `handleFetch` 中原有的 `try { ... }` 内容（`catch` 块保持不变）。

- [ ] **Step 3: 验证文件可编译（TypeScript 检查）**

```bash
pnpm tsc --noEmit
```

暂时可能有 `handleAuthCallback` / `handleAuthRefresh` 未定义的错误，在 Task 4 中添加后再检查。

- [ ] **Step 4: Commit**

```bash
git add src/workers/fflogs-proxy.ts
git commit -m "feat(worker): add Env fields and route stubs for /api/auth/*"
```

---

## Task 4: Worker - /api/auth/callback 实现

**Files:**

- Create: `src/workers/auth.ts`
- Modify: `src/workers/fflogs-proxy.ts`（import）

FFLogs OAuth 端点：

- Token 交换：`POST https://www.fflogs.com/oauth/token`
- 用户信息（GraphQL）：`POST https://www.fflogs.com/api/v2/client`，query `{ currentUser { id name } }`

- [ ] **Step 1: 创建 `src/workers/auth.ts`**

```typescript
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

async function exchangeCodeForToken(code: string, env: Env): Promise<FFLogsTokenResponse> {
  if (
    !env.FFLOGS_OAUTH_CLIENT_ID ||
    !env.FFLOGS_OAUTH_CLIENT_SECRET ||
    !env.FFLOGS_OAUTH_REDIRECT_URI
  ) {
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

async function fetchFFLogsUser(accessToken: string): Promise<{ id: number; name: string }> {
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
    return jsonError(error instanceof Error ? error.message : 'OAuth callback failed', 400)
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

  const payload = await verifyToken(refreshToken, env.JWT_SECRET)

  if (!payload || !payload.sub) {
    return jsonError('Invalid or expired refresh token', 401)
  }

  try {
    // refresh token 中无 name，续期时 name 使用空字符串占位
    // 前端展示 username 依赖 authStore 缓存值，不重新从 JWT 读取
    const accessToken = await signAccessToken(payload.sub, '', env.JWT_SECRET)
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
```

- [ ] **Step 2: 在 `fflogs-proxy.ts` 中 import**

在文件顶部 import 区添加：

```typescript
import { handleAuthCallback, handleAuthRefresh } from './auth'
```

- [ ] **Step 3: TypeScript 检查**

```bash
pnpm tsc --noEmit
```

预期：无错误。

- [ ] **Step 4: Commit**

```bash
git add src/workers/auth.ts src/workers/fflogs-proxy.ts
git commit -m "feat(worker): implement /api/auth/callback and /api/auth/refresh"
```

---

## Task 5: 前端 - authStore

**Files:**

- Create: `src/store/authStore.ts`
- Modify: `src/store/index.ts`

- [ ] **Step 1: 创建 `src/store/authStore.ts`**

```typescript
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface AuthState {
  accessToken: string | null
  refreshToken: string | null
  username: string | null
  setTokens: (accessToken: string, refreshToken: string, username: string) => void
  clearTokens: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    set => ({
      accessToken: null,
      refreshToken: null,
      username: null,
      setTokens: (accessToken, refreshToken, username) =>
        set({ accessToken, refreshToken, username }),
      clearTokens: () => set({ accessToken: null, refreshToken: null, username: null }),
    }),
    {
      name: 'healerbook-auth',
    }
  )
)
```

- [ ] **Step 2: 写测试 `src/store/authStore.test.ts`**

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { useAuthStore } from './authStore'

describe('authStore', () => {
  beforeEach(() => {
    useAuthStore.getState().clearTokens()
  })

  it('初始状态为未登录', () => {
    const { accessToken, refreshToken, username } = useAuthStore.getState()
    expect(accessToken).toBeNull()
    expect(refreshToken).toBeNull()
    expect(username).toBeNull()
  })

  it('setTokens 存储 token 和用户名', () => {
    useAuthStore.getState().setTokens('access-jwt', 'refresh-jwt', 'TestUser')
    const { accessToken, refreshToken, username } = useAuthStore.getState()
    expect(accessToken).toBe('access-jwt')
    expect(refreshToken).toBe('refresh-jwt')
    expect(username).toBe('TestUser')
  })

  it('clearTokens 清除所有状态', () => {
    useAuthStore.getState().setTokens('access-jwt', 'refresh-jwt', 'TestUser')
    useAuthStore.getState().clearTokens()
    const { accessToken, refreshToken, username } = useAuthStore.getState()
    expect(accessToken).toBeNull()
    expect(refreshToken).toBeNull()
    expect(username).toBeNull()
  })
})
```

- [ ] **Step 3: 运行测试确认通过**

```bash
pnpm test:run src/store/authStore.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 4: 在 `src/store/index.ts` 添加导出**

在文件末尾追加：

```typescript
export { useAuthStore } from './authStore'
```

- [ ] **Step 5: Commit**

```bash
git add src/store/authStore.ts src/store/authStore.test.ts src/store/index.ts
git commit -m "feat: add authStore with Zustand persist"
```

---

## Task 6: 前端 - AuthContext

**Files:**

- Create: `src/contexts/AuthContext.tsx`

`login()` 构造 FFLogs 授权 URL 并跳转，生成 `state` 存入 `sessionStorage`（防 CSRF）。FFLogs 授权 URL 从环境变量读取 client ID，redirect URI 固定为 `/callback`。

- [ ] **Step 1: 创建 `src/contexts/AuthContext.tsx`**

```typescript
import { createContext, useContext, type ReactNode } from 'react'
import { useAuthStore } from '@/store/authStore'
import { toast } from 'sonner'
import { nanoid } from 'nanoid'

const FFLOGS_OAUTH_CLIENT_ID = import.meta.env.VITE_FFLOGS_OAUTH_CLIENT_ID as string
const FFLOGS_AUTH_URL = 'https://www.fflogs.com/oauth/authorize'
const REDIRECT_URI = `${window.location.origin}/callback`

interface AuthContextValue {
  username: string | null
  isLoggedIn: boolean
  login: () => void
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const { username, accessToken, clearTokens } = useAuthStore()

  function login() {
    const state = nanoid()
    sessionStorage.setItem('oauth_state', state)

    const params = new URLSearchParams({
      client_id: FFLOGS_OAUTH_CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: 'view:user-profile',
      state,
    })

    window.location.href = `${FFLOGS_AUTH_URL}?${params.toString()}`
  }

  function logout() {
    clearTokens()
    toast.success('已退出登录')
  }

  const value: AuthContextValue = {
    username,
    isLoggedIn: !!accessToken,
    login,
    logout,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return ctx
}
```

- [ ] **Step 2: 在 `.env.example`（或 `.env`）中添加前端环境变量**

检查是否有 `.env.example`：

```bash
ls /Users/lizhibo/.superset/worktrees/healerbook/feat/fflogs-oauth/.env* 2>/dev/null
```

如果有 `.env.example`，添加：

```
VITE_FFLOGS_OAUTH_CLIENT_ID=your_fflogs_oauth_client_id
```

如果没有，在本地 `.env`（不提交）中添加。

- [ ] **Step 3: Commit**

```bash
git add src/contexts/AuthContext.tsx
git commit -m "feat: add AuthContext with login/logout and CSRF state"
```

---

## Task 7: 前端 - CallbackPage

**Files:**

- Create: `src/pages/CallbackPage.tsx`

- [ ] **Step 1: 创建 `src/pages/CallbackPage.tsx`**

```typescript
import { useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuthStore } from '@/store/authStore'

const AUTH_CALLBACK_URL = '/api/auth/callback'

export default function CallbackPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { setTokens } = useAuthStore()
  const handledRef = useRef(false)

  useEffect(() => {
    if (handledRef.current) return
    handledRef.current = true

    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const savedState = sessionStorage.getItem('oauth_state')

    // 验证 state 防 CSRF
    if (!state || state !== savedState) {
      toast.error('授权失败：state 不匹配')
      navigate('/', { replace: true })
      return
    }

    sessionStorage.removeItem('oauth_state')

    if (!code) {
      toast.error('授权失败：缺少 code 参数')
      navigate('/', { replace: true })
      return
    }

    fetch(AUTH_CALLBACK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
      .then(async res => {
        if (!res.ok) {
          const err = (await res.json()) as { error?: string }
          throw new Error(err.error || `HTTP ${res.status}`)
        }
        return res.json() as Promise<{
          access_token: string
          refresh_token: string
          name: string
        }>
      })
      .then(({ access_token, refresh_token, name }) => {
        setTokens(access_token, refresh_token, name)
        toast.success(`欢迎，${name}！`)
        navigate('/', { replace: true })
      })
      .catch((err: unknown) => {
        toast.error(`登录失败：${err instanceof Error ? err.message : '未知错误'}`)
        navigate('/', { replace: true })
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-muted-foreground">正在完成登录...</p>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/CallbackPage.tsx
git commit -m "feat: add CallbackPage for OAuth redirect handling"
```

---

## Task 8: 前端 - AuthButton 组件

**Files:**

- Create: `src/components/AuthButton.tsx`

- [ ] **Step 1: 创建 `src/components/AuthButton.tsx`**

```typescript
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'

export default function AuthButton() {
  const { username, isLoggedIn, login, logout } = useAuth()

  if (isLoggedIn && username) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">{username}</span>
        <Button variant="outline" size="sm" onClick={logout}>
          退出
        </Button>
      </div>
    )
  }

  return (
    <Button variant="outline" size="sm" onClick={login}>
      登录 FFLogs
    </Button>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/AuthButton.tsx
git commit -m "feat: add AuthButton component for login/logout UI"
```

---

## Task 9: 接线 - App.tsx + HomePage

**Files:**

- Modify: `src/App.tsx`
- Modify: `src/pages/HomePage.tsx`

- [ ] **Step 1: 修改 `src/App.tsx`**

在现有 imports 末尾追加：

```typescript
import { AuthProvider } from './contexts/AuthContext'
const CallbackPage = lazy(() => import('./pages/CallbackPage'))
```

将 `<BrowserRouter>` 内部包裹 `<AuthProvider>`：

原：

```typescript
      <BrowserRouter>
        <Suspense fallback={null}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/editor/:timelineId" element={<EditorPage />} />
          </Routes>
        </Suspense>
        <Toaster />
        <TooltipOverlay />
      </BrowserRouter>
```

改为：

```typescript
      <BrowserRouter>
        <AuthProvider>
          <Suspense fallback={null}>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/editor/:timelineId" element={<EditorPage />} />
              <Route path="/callback" element={<CallbackPage />} />
            </Routes>
          </Suspense>
          <Toaster />
          <TooltipOverlay />
        </AuthProvider>
      </BrowserRouter>
```

- [ ] **Step 2: 修改 `src/pages/HomePage.tsx` - 在 header 右侧加入 AuthButton**

找到 HomePage 中的 `<header>` 部分，在顶层 import 区添加：

```typescript
import AuthButton from '@/components/AuthButton'
```

找到 header 内的 `<div className="container mx-auto px-4 py-4">` 块，改为：

```typescript
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{APP_NAME}</h1>
            <p className="text-sm text-muted-foreground">FF14 减伤规划工具</p>
          </div>
          <AuthButton />
        </div>
```

- [ ] **Step 3: 运行开发服务器验证**

```bash
pnpm dev
```

访问 `http://localhost:5173`，验证右上角显示「登录 FFLogs」按钮。点击按钮应跳转到 FFLogs 授权页。

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/pages/HomePage.tsx
git commit -m "feat: wire up AuthProvider, /callback route, and AuthButton in header"
```

---

## Task 10: 前端 - fflogsClient.ts 添加 Authorization header + 401 续期

**Files:**

- Modify: `src/api/fflogsClient.ts`

401 续期逻辑：当前 Worker 路由不强制鉴权，此逻辑为后续鉴权路由准备。Token 过期时自动调用 `/api/auth/refresh` 并重试。

- [ ] **Step 1: 修改 `src/api/fflogsClient.ts`**

在文件顶部 import 区添加：

```typescript
import { useAuthStore } from '@/store/authStore'
import { toast } from 'sonner'
```

将私有的 `fetchWithTimeout` 改为支持 auth 的 `fetchWithAuth`（替换现有 `fetchWithTimeout`）：

```typescript
const AUTH_REFRESH_URL = '/api/auth/refresh'

async function fetchWithAuth(url: string, timeout: number = REQUEST_TIMEOUT): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  const { accessToken } = useAuthStore.getState()

  const headers: Record<string, string> = {}
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`
  }

  try {
    const response = await fetch(url, { signal: controller.signal, headers })
    clearTimeout(timeoutId)

    // 401：尝试续期
    if (response.status === 401) {
      const refreshed = await tryRefreshToken()
      if (refreshed) {
        // 用新 token 重试一次
        const { accessToken: newToken } = useAuthStore.getState()
        const retryResponse = await fetch(url, {
          headers: newToken ? { Authorization: `Bearer ${newToken}` } : {},
        })
        return retryResponse
      }
    }

    return response
  } catch (error) {
    clearTimeout(timeoutId)
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('请求超时，请稍后重试')
    }
    throw error
  }
}

async function tryRefreshToken(): Promise<boolean> {
  const { refreshToken, setTokens, clearTokens, username } = useAuthStore.getState()
  if (!refreshToken) return false

  try {
    const res = await fetch(AUTH_REFRESH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    })

    if (!res.ok) {
      clearTokens()
      toast.error('登录已过期，请重新登录')
      return false
    }

    const { access_token } = (await res.json()) as { access_token: string }
    // refresh 接口不返回 name，保留 authStore 中缓存的 username
    setTokens(access_token, refreshToken, username ?? '')
    return true
  } catch {
    clearTokens()
    toast.error('登录已过期，请重新登录')
    return false
  }
}
```

将 `FFLogsClient` 类中所有调用 `fetchWithTimeout` 的地方改为 `fetchWithAuth`（共 2 处：`getReport` 和私有 `getEvents`）。

同时删除 `handleError` 方法中对 `401` 状态码的特殊处理：

```typescript
if (error.message.includes('401')) {
  return new Error('FFLogs 连接配置错误，请联系开发者')
}
```

原因：引入 `fetchWithAuth` 后，401 会被拦截并自动续期（或提示重新登录），不会再透传到 `handleError`，这行代码变成死代码且语义与新行为冲突，应删除。

- [ ] **Step 2: TypeScript 检查**

```bash
pnpm tsc --noEmit
```

Expected: 无错误。

- [ ] **Step 3: 运行所有测试确认不破坏现有功能**

```bash
pnpm test:run
```

Expected: 所有已有测试通过 + Task 5 的 3 个 authStore 测试通过。

- [ ] **Step 4: Commit**

```bash
git add src/api/fflogsClient.ts
git commit -m "feat: add Authorization header and 401 token refresh in fflogsClient"
```

---

## Task 11: 端到端手动验证

在开发环境中完成整体流程验证。需要真实的 FFLogs OAuth App 凭据。

**前置条件：** 在 [FFLogs Developer](https://www.fflogs.com/api/clients/) 创建 OAuth App，设置 Redirect URI 为 `http://localhost:5173/callback`，获取 Client ID 和 Client Secret。

- [ ] **Step 1: 配置本地环境变量**

1. 在项目根目录创建 `.dev.vars`（Worker 变量）：

   ```
   FFLOGS_OAUTH_CLIENT_ID=<your_client_id>
   FFLOGS_OAUTH_CLIENT_SECRET=<your_client_secret>
   FFLOGS_OAUTH_REDIRECT_URI=http://localhost:5173/callback
   JWT_SECRET=<openssl rand -hex 32 的输出>
   ```

2. 在项目根目录创建/更新 `.env.local`（前端变量）：
   ```
   VITE_FFLOGS_OAUTH_CLIENT_ID=<your_client_id>
   ```

- [ ] **Step 2: 启动开发服务器**

```bash
# 终端 1：启动 Worker
pnpm workers:dev

# 终端 2：启动前端（配置代理到 Worker）
pnpm dev
```

- [ ] **Step 3: 验证登录流程**

1. 访问 `http://localhost:5173`
2. 点击「登录 FFLogs」→ 跳转到 FFLogs 授权页
3. 授权后回调到 `/callback`
4. 等待 toast「欢迎，[用户名]！」
5. 确认右上角变为「[用户名] · 退出」
6. 刷新页面，确认登录状态保持（localStorage 持久化）
7. 点击「退出」，确认回到未登录状态

- [ ] **Step 4: 验证 token 附加**

打开浏览器 DevTools → Network，导入一个 FFLogs 日志，确认请求 Headers 中包含 `Authorization: Bearer <token>`。

- [ ] **Step 5: 最终 commit**

```bash
git add .
git commit -m "chore: complete FFLogs OAuth login feature"
```
