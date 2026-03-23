# FFLogs OAuth 登录功能设计文档

**日期**: 2026-03-23
**分支**: feat/fflogs-oauth
**状态**: 待实现

## 背景与目标

为后续时间轴分享功能打基础，允许用户通过 FFLogs 账号登录，将时间轴与 FFLogs 身份绑定。本期不涉及私密日志访问。

## 整体数据流

```
用户点击「登录」
    ↓
前端生成随机 state，存入 sessionStorage
    ↓
跳转到 FFLogs OAuth 授权页（携带 state 参数）
    ↓ (用户授权后)
FFLogs 回调到前端 /callback?code=xxx&state=yyy
    ↓
CallbackPage 校验 state 与 sessionStorage 一致（防 CSRF）
CallbackPage 提取 code，POST /api/auth/callback { code }
    ↓
Worker 用 code 换取 FFLogs access_token
Worker 调用 FFLogs API 获取用户名和用户 ID
Worker 签发 Access Token（1小时）+ Refresh Token（30天）
Worker 返回 { access_token, refresh_token, name }
    ↓
前端存两个 token 到 localStorage，更新 AuthContext
    ↓
右上角显示「已登录：Username」+ 退出按钮
    ↓
后续 API 请求自动附加 Authorization: Bearer <access_token>
    ↓
Worker 验证 JWT 签名 + 过期时间
```

## 前端架构

### 新增文件

| 文件 | 职责 |
|------|------|
| `src/contexts/AuthContext.tsx` | 提供 `useAuth()` hook，持有认证状态和操作 |
| `src/store/authStore.ts` | Zustand store，持久化 token 到 localStorage |
| `src/pages/CallbackPage.tsx` | 处理 `/callback` 路由，提取 code → 请求 Worker → 存储结果 |
| `src/components/AuthButton.tsx` | 右上角按钮：未登录显示「登录」，已登录显示「Username · 退出」 |

### 修改文件

| 文件 | 改动 |
|------|------|
| `src/App.tsx` | 用 `<AuthProvider>` 包裹整个应用，添加 `/callback` 路由 |
| `src/pages/HomePage.tsx` | 右上角加入 `<AuthButton />` |
| `src/api/fflogsClient.ts` | 请求时从 authStore 读取 access token，附加到 `Authorization` header；收到 401 时自动用 refresh token 续期后重试（当前 Worker 路由不强制鉴权，此逻辑为后续鉴权路由准备） |

### AuthContext 接口

```typescript
interface AuthContextValue {
  username: string | null
  isLoggedIn: boolean
  login: () => void    // 跳转 FFLogs 授权页
  logout: () => void   // 清除所有 token
}
```

### authStore 结构

使用 Zustand `persist` 中间件，localStorage key 为 `healerbook-auth`。

```typescript
interface AuthState {
  accessToken: string | null
  refreshToken: string | null
  username: string | null
  setTokens: (accessToken: string, refreshToken: string, username: string) => void
  clearTokens: () => void
}
```

## JWT 设计

### Access Token（1 小时）

```json
{
  "sub": "12345",
  "name": "fflogs_username",
  "jti": "V1StGXR8_Z5jdHi6B-myT",
  "iat": 1700000000,
  "exp": 1700003600
}
```

### Refresh Token（30 天）

```json
{
  "sub": "12345",
  "jti": "K9mXpQ2_R7nHj4E1w-vuS",
  "iat": 1700000000,
  "exp": 1702592000
}
```

- `sub`: FFLogs 用户 ID（字符串）
- `name`: FFLogs 用户名（仅 access token）
- `jti`: nanoid 生成的唯一 ID，与 JWT 本身绑定，每次签发重新生成
- 签名算法：HMAC-SHA256

## Worker 端

### 新增路由

| 路由 | 方法 | 请求体 | 响应体 | 职责 |
|------|------|--------|--------|------|
| `/api/auth/callback` | POST | `{ code: string }` | `{ access_token, refresh_token, name }` | 换取 FFLogs token，获取用户信息，签发双 token |
| `/api/auth/refresh` | POST | `{ refresh_token: string }` | `{ access_token: string }` | 验证 refresh token，签发新 access token（不含 name，username 缓存于 authStore） |

### 新增环境变量

```
FFLOGS_OAUTH_CLIENT_ID=       # FFLogs OAuth App 的 Client ID
FFLOGS_OAUTH_CLIENT_SECRET=   # FFLogs OAuth App 的 Client Secret
FFLOGS_OAUTH_REDIRECT_URI=    # 前端回调 URL（如 http://localhost:5173/callback）
JWT_SECRET=                    # JWT 签名密钥（HMAC-SHA256）
```

### 实现位置

在 `src/workers/fflogs-proxy.ts` 中新增 `/api/auth/*` 路由组，沿用现有 CORS 配置。需同时更新该文件中的 `Env` 接口，添加以下字段：

```typescript
FFLOGS_OAUTH_CLIENT_ID: string
FFLOGS_OAUTH_CLIENT_SECRET: string
FFLOGS_OAUTH_REDIRECT_URI: string
JWT_SECRET: string
```

注意：现有 `FFLOGS_CLIENT_ID` / `FFLOGS_CLIENT_SECRET` 用于 Worker 侧 Client Credentials flow（TOP100 同步），新增的 `FFLOGS_OAUTH_*` 变量对应用户端 Authorization Code flow，二者互不影响。

## 双 Token 续期策略

### Token 对比

| | Access Token | Refresh Token |
|--|--|--|
| 有效期 | 1 小时 | 30 天 |
| 存储 | localStorage | localStorage |
| 用途 | API 请求 `Authorization` header | 换取新 Access Token |

### 前端续期逻辑

```
发起 API 请求
  ↓ 收到 401
  ↓ 尝试用 refresh_token 调用 /api/auth/refresh
    ├─ 成功 → 存新 access_token，重试原请求
    └─ 失败（refresh 也过期）→ 清除所有 token，toast 提示重新登录
```

## 错误处理

### 前端

| 情况 | 处理方式 |
|------|------|
| Access token 过期 | 自动用 refresh token 续期，透明重试 |
| Refresh token 过期 | 清除 localStorage，AuthContext 切换为未登录，toast 提示「登录已过期，请重新登录」 |
| `/callback` 时 state 不匹配 | 视为 CSRF 攻击，显示「授权失败」并跳回首页 |
| `/callback` 时 code 无效 | 显示「授权失败」并跳回首页 |
| 用户主动退出 | 清除 localStorage 中的两个 token，不通知 Worker |
| 网络错误 | 沿用现有 sonner toast 提示 |

### Worker

| 情况 | 处理方式 |
|------|------|
| FFLogs 换 token 失败 | 返回 400 + 错误信息 |
| JWT 签名验证失败 | 返回 401 |
| JWT 过期 | 返回 401 |
| 缺少 Authorization header | 跳过鉴权（当前 API 不强制登录） |

## 范围边界

**本期包含：**
- FFLogs OAuth Authorization Code Flow
- 双 token 签发与续期
- 右上角登录/退出按钮（显示用户名）
- API 请求自动附加 JWT

**本期不包含：**
- 私密日志访问
- 时间轴分享功能（需登录状态，但分享逻辑本期不实现）
- Token 撤销（登出不通知 Worker）
- 多设备会话管理
