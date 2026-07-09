# FFLogs 请求经独立 IP 反向代理转发 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Worker 的全部 FFLogs API 请求经由用户自建的独立 IP 反向代理转发，规避 FFLogs 基于共享 IP 的限速。

**Architecture:** 新增纯函数辅助模块 `fflogsProxy.ts`，集中做「URL 改写 + 鉴权 header 注入」。四处 FFLogs 出口（`fflogsClientV2.ts` 两处、`auth.ts` 两处）统一改用 `fflogsFetch`。代理地址未配置时自动退化为直连，本地开发与现有测试零影响。代理侧用现成 Caddy（纯配置，零代码）。

**Tech Stack:** TypeScript、Cloudflare Workers、Vitest、Caddy（部署侧）

## Global Constraints

- 包管理器必须用 **pnpm**。
- 提交信息 / 作者 / Co-Authored-By **禁止**出现 "claude" 字样（`.husky/commit-msg` 会拒绝）。
- 不得自行 `git push`；本计划仅含 `git commit`（在 subagent-driven 自动流程内按已声明 step 执行）。
- Worker 测试文件与源码同目录，命名 `*.test.ts`。
- `fflogsFetch` 第三参数为配置对象 `{ proxyBase?: string; proxySecret?: string }`（非整个 `Env`），使 `FFLogsClientV2` 类与 `auth.ts` 复用同一 helper。
- 设计单源见 `design/superpowers/specs/2026-07-09-fflogs-proxy-design.md`。

---

## File Structure

- **Create** `src/workers/fflogsProxy.ts` — `rewriteFFLogsUrl` + `fflogsFetch` 两个导出，承载全部代理改写与鉴权逻辑。
- **Create** `src/workers/fflogsProxy.test.ts` — 上述两函数的单测。
- **Modify** `src/workers/env.ts` — `Env` 加两字段；`createClient` 透传 proxy 配置。
- **Modify** `src/workers/fflogsClientV2.ts` — `FFLogsV2Config` 加两字段；`getAccessToken` / `query` 改用 `fflogsFetch`。
- **Modify** `src/workers/routes/auth.ts` — `exchangeCodeForToken` / `fetchFFLogsUser` 改用 `fflogsFetch`，后者补 `env` 入参。
- **Modify** `wrangler.toml` — dev/prod `[vars]` 加 `FFLOGS_PROXY_BASE` 注释示例。
- **Create** `deploy/fflogs-proxy/Caddyfile` — 现成 Caddy 配置，供部署直接使用。
- **Create** `deploy/fflogs-proxy/README.md` — 部署步骤（DNS / 端口 / secret / 启动 / Worker 侧配置）。

---

## Task 1: 代理辅助模块 fflogsProxy.ts（纯核心 + 单测）

**Files:**

- Create: `src/workers/fflogsProxy.ts`
- Test: `src/workers/fflogsProxy.test.ts`

**Interfaces:**

- Consumes: 无（叶子模块）。
- Produces:
  - `rewriteFFLogsUrl(url: string, proxyBase?: string): string`
  - `fflogsFetch(url: string, init: RequestInit, opts: { proxyBase?: string; proxySecret?: string }): Promise<Response>`

- [ ] **Step 1: 写失败测试**

创建 `src/workers/fflogsProxy.test.ts`：

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { rewriteFFLogsUrl, fflogsFetch } from './fflogsProxy'

const BASE = 'https://ffproxy.example.com'

describe('rewriteFFLogsUrl', () => {
  it('proxyBase 未配置时原样返回', () => {
    const url = 'https://www.fflogs.com/oauth/token'
    expect(rewriteFFLogsUrl(url, undefined)).toBe(url)
    expect(rewriteFFLogsUrl(url, '')).toBe(url)
  })

  it('www 上游改写为 /www 前缀', () => {
    expect(rewriteFFLogsUrl('https://www.fflogs.com/oauth/token', BASE)).toBe(
      'https://ffproxy.example.com/www/oauth/token'
    )
    expect(rewriteFFLogsUrl('https://www.fflogs.com/api/v2/client', BASE)).toBe(
      'https://ffproxy.example.com/www/api/v2/client'
    )
    expect(rewriteFFLogsUrl('https://www.fflogs.com/api/v2/user', BASE)).toBe(
      'https://ffproxy.example.com/www/api/v2/user'
    )
  })

  it('cn 上游改写为 /cn 前缀', () => {
    expect(rewriteFFLogsUrl('https://cn.fflogs.com/api/v2/client', BASE)).toBe(
      'https://ffproxy.example.com/cn/api/v2/client'
    )
  })

  it('保留 query string', () => {
    expect(rewriteFFLogsUrl('https://www.fflogs.com/api/v2/client?a=1&b=2', BASE)).toBe(
      'https://ffproxy.example.com/www/api/v2/client?a=1&b=2'
    )
  })

  it('proxyBase 末尾斜杠被归一化', () => {
    expect(rewriteFFLogsUrl('https://www.fflogs.com/oauth/token', BASE + '/')).toBe(
      'https://ffproxy.example.com/www/oauth/token'
    )
  })

  it('非 fflogs.com 域名原样透传', () => {
    const url = 'https://example.org/api/v2/client'
    expect(rewriteFFLogsUrl(url, BASE)).toBe(url)
  })
})

describe('fflogsFetch', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('未配置代理时直连原 URL 且不加 secret header', async () => {
    const spy = vi.fn(async () => new Response('ok'))
    vi.stubGlobal('fetch', spy)
    await fflogsFetch('https://www.fflogs.com/oauth/token', { method: 'POST' }, {})
    const [target, init] = spy.mock.calls[0]
    expect(target).toBe('https://www.fflogs.com/oauth/token')
    expect(new Headers((init as RequestInit).headers).has('X-Proxy-Secret')).toBe(false)
  })

  it('配置代理时改写 URL 并注入 secret header', async () => {
    const spy = vi.fn(async () => new Response('ok'))
    vi.stubGlobal('fetch', spy)
    await fflogsFetch(
      'https://cn.fflogs.com/api/v2/client',
      { method: 'POST', headers: { Authorization: 'Bearer t' } },
      { proxyBase: BASE, proxySecret: 'sekret' }
    )
    const [target, init] = spy.mock.calls[0]
    expect(target).toBe('https://ffproxy.example.com/cn/api/v2/client')
    const headers = new Headers((init as RequestInit).headers)
    expect(headers.get('X-Proxy-Secret')).toBe('sekret')
    expect(headers.get('Authorization')).toBe('Bearer t') // 原 header 保留
  })

  it('有 base 无 secret 时改写 URL 但不加 secret header', async () => {
    const spy = vi.fn(async () => new Response('ok'))
    vi.stubGlobal('fetch', spy)
    await fflogsFetch('https://www.fflogs.com/api/v2/client', {}, { proxyBase: BASE })
    const [target, init] = spy.mock.calls[0]
    expect(target).toBe('https://ffproxy.example.com/www/api/v2/client')
    expect(new Headers((init as RequestInit).headers).has('X-Proxy-Secret')).toBe(false)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test:run src/workers/fflogsProxy.test.ts`
Expected: FAIL —— `fflogsProxy` 模块不存在 / 导入报错。

- [ ] **Step 3: 写最小实现**

创建 `src/workers/fflogsProxy.ts`：

```ts
/**
 * FFLogs 请求代理改写
 *
 * 把 https://<sub>.fflogs.com/<path> 改写成 <proxyBase>/<sub>/<path>，并注入门禁 header。
 * proxyBase 未配置时一律原样直连（本地开发 / 现有测试不受影响，也是线上一键回退开关）。
 */

/** 把 fflogs 上游 URL 改写为经代理的 URL；未配置 proxyBase 或非 fflogs 域名则原样返回 */
export function rewriteFFLogsUrl(url: string, proxyBase?: string): string {
  if (!proxyBase) return url
  const u = new URL(url)
  if (!u.hostname.endsWith('.fflogs.com')) return url
  const sub = u.hostname.split('.')[0] // 'www' | 'cn'
  return `${proxyBase.replace(/\/$/, '')}/${sub}${u.pathname}${u.search}`
}

/** 经代理发起 FFLogs 请求：改写 URL + 注入 X-Proxy-Secret（仅在 base 与 secret 同时配置时） */
export function fflogsFetch(
  url: string,
  init: RequestInit,
  opts: { proxyBase?: string; proxySecret?: string }
): Promise<Response> {
  const target = rewriteFFLogsUrl(url, opts.proxyBase)
  const headers = new Headers(init.headers)
  if (opts.proxyBase && opts.proxySecret) {
    headers.set('X-Proxy-Secret', opts.proxySecret)
  }
  return fetch(target, { ...init, headers })
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test:run src/workers/fflogsProxy.test.ts`
Expected: PASS（全部用例）。

- [ ] **Step 5: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 6: 提交**

```bash
git add src/workers/fflogsProxy.ts src/workers/fflogsProxy.test.ts
git commit -m "feat(workers): 新增 fflogsProxy 代理改写辅助（rewriteFFLogsUrl + fflogsFetch）"
```

---

## Task 2: 接入 FFLogsClientV2 与 createClient

**Files:**

- Modify: `src/workers/env.ts`（`Env` 接口 + `createClient`）
- Modify: `src/workers/fflogsClientV2.ts`（`FFLogsV2Config`、构造函数、`getAccessToken`、`query`）

**Interfaces:**

- Consumes: `fflogsFetch` from Task 1。
- Produces: `FFLogsV2Config` 新增可选字段 `proxyBase?: string`、`proxySecret?: string`；`FFLogsClientV2` 内部所有 FFLogs 请求经 `fflogsFetch` 转发。

- [ ] **Step 1: `Env` 加两字段**

修改 `src/workers/env.ts` 的 `Env` 接口，在 `SENSITIVE_WORDS_HMAC_KEY?: string` 后追加：

```ts
  /** FFLogs 反向代理 base URL（如 https://ffproxy.example.com）；未设则直连 FFLogs */
  FFLOGS_PROXY_BASE?: string
  /** 与代理约定的门禁 secret；配合 FFLOGS_PROXY_BASE 生效 */
  FFLOGS_PROXY_SECRET?: string
```

- [ ] **Step 2: `createClient` 透传 proxy 配置**

修改 `src/workers/env.ts` 的 `createClient`，`new FFLogsClientV2({...})` 里补两行：

```ts
return new FFLogsClientV2({
  clientId: env.FFLOGS_CLIENT_ID,
  clientSecret: env.FFLOGS_CLIENT_SECRET,
  kv: env.healerbook,
  proxyBase: env.FFLOGS_PROXY_BASE,
  proxySecret: env.FFLOGS_PROXY_SECRET,
})
```

- [ ] **Step 3: `FFLogsV2Config` 加字段并在构造函数保存**

修改 `src/workers/fflogsClientV2.ts`：

`FFLogsV2Config` 接口追加：

```ts
export interface FFLogsV2Config {
  clientId: string
  clientSecret: string
  kv?: KVNamespace
  proxyBase?: string
  proxySecret?: string
}
```

`FFLogsClientV2` 类字段与构造函数：

```ts
export class FFLogsClientV2 {
  private clientId: string
  private clientSecret: string
  private kv?: KVNamespace
  private proxyBase?: string
  private proxySecret?: string

  constructor(config: FFLogsV2Config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.kv = config.kv
    this.proxyBase = config.proxyBase
    this.proxySecret = config.proxySecret
  }
```

- [ ] **Step 4: 顶部导入 fflogsFetch**

在 `src/workers/fflogsClientV2.ts` 顶部 import 区追加：

```ts
import { fflogsFetch } from './fflogsProxy'
```

- [ ] **Step 5: `getAccessToken` 改用 fflogsFetch**

将 `getAccessToken` 内的 token 请求（原 `const response = await fetch(tokenUrl, {...})`）改为：

```ts
const response = await fflogsFetch(
  tokenUrl,
  {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  },
  { proxyBase: this.proxyBase, proxySecret: this.proxySecret }
)
```

- [ ] **Step 6: `query` 改用 fflogsFetch**

将 `query` 内的 `doRequest` 改为：

```ts
const doRequest = async (token: string) => {
  return fflogsFetch(
    graphqlUrl,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query, variables }),
    },
    { proxyBase: this.proxyBase, proxySecret: this.proxySecret }
  )
}
```

- [ ] **Step 7: 类型检查 + 全量回归**

Run: `pnpm exec tsc --noEmit && pnpm test:run src/workers`
Expected: tsc 无错误；`src/workers` 下测试全绿（默认无 proxy 配置 → fflogsFetch 直连，既有行为不变）。

- [ ] **Step 8: 提交**

```bash
git add src/workers/env.ts src/workers/fflogsClientV2.ts
git commit -m "feat(workers): FFLogsClientV2 的 token 与 GraphQL 请求经代理转发"
```

---

## Task 3: 接入用户登录 OAuth（auth.ts）

**Files:**

- Modify: `src/workers/routes/auth.ts`（`exchangeCodeForToken`、`fetchFFLogsUser` 及其调用处）

**Interfaces:**

- Consumes: `fflogsFetch` from Task 1；`Env` 的 `FFLOGS_PROXY_BASE` / `FFLOGS_PROXY_SECRET`（Task 2 已加）。
- Produces: 用户登录 code 换 token 与 user 查询两处请求经代理转发。

- [ ] **Step 1: 顶部导入 fflogsFetch**

在 `src/workers/routes/auth.ts` 顶部 import 区追加：

```ts
import { fflogsFetch } from '../fflogsProxy'
```

- [ ] **Step 2: `exchangeCodeForToken` 改用 fflogsFetch**

该函数已有 `env: Env` 入参。将其中 `const response = await fetch('https://www.fflogs.com/oauth/token', {...})` 改为：

```ts
const response = await fflogsFetch(
  'https://www.fflogs.com/oauth/token',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  },
  { proxyBase: env.FFLOGS_PROXY_BASE, proxySecret: env.FFLOGS_PROXY_SECRET }
)
```

- [ ] **Step 3: `fetchFFLogsUser` 补 env 入参并改用 fflogsFetch**

把函数签名从 `async function fetchFFLogsUser(accessToken: string)` 改为带 `env`：

```ts
async function fetchFFLogsUser(
  accessToken: string,
  env: Env
): Promise<{ id: number; name: string }> {
  const response = await fflogsFetch(
    'https://www.fflogs.com/api/v2/user',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ query: '{ userData { currentUser { id name } } }' }),
    },
    { proxyBase: env.FFLOGS_PROXY_BASE, proxySecret: env.FFLOGS_PROXY_SECRET }
  )

  if (!response.ok) {
    throw new Error(`FFLogs user info failed: ${response.status}`)
  }

  const data = (await response.json()) as FFLogsUserResponse
  const user = data.data?.userData?.currentUser
  if (!user) throw new Error('Failed to get user info from FFLogs')
  return user
}
```

> 注意：确认 `auth.ts` 已 import `Env` 类型（`exchangeCodeForToken` 已用到 `env: Env`，通常已导入；若无则从 `'../env'` 补 `import type { Env } from '../env'`）。

- [ ] **Step 4: 更新调用处传入 env**

在 callback 处理里（`user = await fetchFFLogsUser(tokenResponse.access_token)`）改为：

```ts
user = await fetchFFLogsUser(tokenResponse.access_token, c.env)
```

- [ ] **Step 5: 类型检查 + auth 回归**

Run: `pnpm exec tsc --noEmit && pnpm test:run src/workers/routes/auth`
Expected: tsc 无错误；auth 相关测试全绿。

- [ ] **Step 6: 提交**

```bash
git add src/workers/routes/auth.ts
git commit -m "feat(workers): 用户登录 OAuth 的 token 与 user 请求经代理转发"
```

---

## Task 4: 配置示例与代理部署产物

**Files:**

- Modify: `wrangler.toml`（dev/prod `[vars]` 加 `FFLOGS_PROXY_BASE` 注释示例 + secret 说明）
- Create: `deploy/fflogs-proxy/Caddyfile`
- Create: `deploy/fflogs-proxy/README.md`

**Interfaces:**

- Consumes: 无代码依赖；产出部署侧配置与文档。
- Produces: 可直接使用的 Caddy 配置 + 部署说明。

- [ ] **Step 1: wrangler.toml 加变量示例**

在 `[env.development.vars]`（第 40-41 行附近）与 `[env.production.vars]`（第 63-65 行附近）各追加一行注释示例（值留空由用户填）：

```toml
# FFLogs 反向代理（可选）：设置后 FFLogs 请求经此转发以规避共享 IP 限速；不设则直连
# FFLOGS_PROXY_BASE = "https://ffproxy.xivhealer.com"
```

并在文件底部 secrets 注释区（第 84-88 行附近）追加一行：

```toml
# wrangler secret put FFLOGS_PROXY_SECRET   # 与 Caddy 侧同值，代理门禁
```

- [ ] **Step 2: 创建 Caddyfile**

创建 `deploy/fflogs-proxy/Caddyfile`：

```caddyfile
# FFLogs 反向代理 —— 详见 design/superpowers/specs/2026-07-09-fflogs-proxy-design.md
# 启动：FFLOGS_PROXY_SECRET=<值> caddy run --config Caddyfile

ffproxy.xivhealer.com {
	# 门禁：header 里的 secret 必须匹配，否则 403
	@authorized header X-Proxy-Secret "{env.FFLOGS_PROXY_SECRET}"

	handle @authorized {
		# /www/* → www.fflogs.com（OAuth token / user / www 区 GraphQL）
		handle_path /www/* {
			reverse_proxy https://www.fflogs.com {
				header_up Host www.fflogs.com
			}
		}
		# /cn/* → cn.fflogs.com（国服 GraphQL）
		handle_path /cn/* {
			reverse_proxy https://cn.fflogs.com {
				header_up Host cn.fflogs.com
			}
		}
		respond "Not Found" 404
	}

	# secret 不匹配 → 拒绝
	respond "Forbidden" 403
}
```

- [ ] **Step 3: 创建部署 README**

创建 `deploy/fflogs-proxy/README.md`：

````markdown
# FFLogs 反向代理部署

让 Worker 的 FFLogs 请求经这台独立 IP 的服务器转发，规避 FFLogs 基于共享 IP 的限速。
设计单源：`design/superpowers/specs/2026-07-09-fflogs-proxy-design.md`。

代理域名固定用 `ffproxy.xivhealer.com`（xivhealer.com 托管在 Cloudflare）。

## 前置

- 一台有独立公网 IP 的服务器
- 已安装 [Caddy](https://caddyserver.com/docs/install)
- 一个有 `xivhealer.com` 区域 **Zone.DNS 编辑**权限的 Cloudflare API Token

## 步骤

### 1. DNS：加 `ffproxy` A 记录（必须 DNS only / 不代理）

> ⚠️ **关键**：记录必须是 **DNS only（灰云，`proxied: false`）**。若开橙云走 Cloudflare 代理，
> Worker→代理会绕回 Cloudflare 共享 IP，且 Caddy 的 HTTP-01 证书挑战会被 Cloudflare 拦截而失败。
> （FFLogs 看到的始终是本服务器独立 IP——对 FFLogs 发请求的是 Caddy，与橙/灰云无关。）

用 Cloudflare API（命令行）创建记录。先拿 Zone ID，再建 A 记录：

```bash
export CF_API_TOKEN=<你的 API Token>
SERVER_IP=<服务器独立 IP>

# 取 xivhealer.com 的 Zone ID
ZONE_ID=$(curl -s "https://api.cloudflare.com/client/v4/zones?name=xivhealer.com" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | jq -r '.result[0].id')

# 创建 ffproxy A 记录，proxied=false（灰云 / DNS only）
curl -s -X POST "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data "$(jq -n --arg ip "$SERVER_IP" '{
    type: "A", name: "ffproxy", content: $ip, ttl: 1, proxied: false
  }')" | jq '.success, .result.name, .result.proxied'
# 期望输出：true  "ffproxy.xivhealer.com"  false
```

> 替代 CLI：亦可用官方 `flarectl`（`flarectl dns create --zone xivhealer.com --name ffproxy \
--type A --content <IP>`，注意其默认不代理）。核心要求只有一条：`proxied=false`。

### 2. 放行端口

`80`（ACME 证书签发）与 `443`。

### 3. 生成 secret

```bash
openssl rand -hex 32
```

### 4. 启动 Caddy

```bash
FFLOGS_PROXY_SECRET=<上一步生成的值> caddy run --config Caddyfile
```

证书由 Caddy 自动申请并续期（域名已是 `ffproxy.xivhealer.com`）。生产建议用 systemd 常驻并通过
`Environment=` 注入 secret。

### 5. 配置 Worker

```bash
pnpm exec wrangler secret put FFLOGS_PROXY_SECRET   # 填与上面同一个值
```

并在 `wrangler.toml` 对应环境的 `[vars]` 设置：

```toml
FFLOGS_PROXY_BASE = "https://ffproxy.xivhealer.com"
```

重新部署 Worker 生效。

## 回退

删除 `FFLOGS_PROXY_BASE` 变量并重新部署，Worker 立即恢复直连 FFLogs。

## 验证

- 确认记录未被代理：`dig +short ffproxy.xivhealer.com` 应直接返回服务器独立 IP（而非 Cloudflare 段 IP）。
- 代理机器需能同时连通 `www.fflogs.com`（国际区）与 `cn.fflogs.com`（国服），各测一条。
- 门禁校验：

  ```bash
  curl -i https://ffproxy.xivhealer.com/www/api/v2/client            # 期望 403
  curl -i -H "X-Proxy-Secret: <值>" https://ffproxy.xivhealer.com/www/api/v2/client  # 期望到达上游（401/400 属正常，说明已转发）
  ```
````

- [ ] **Step 4: 校验 Caddyfile 语法（若本机装了 caddy）**

Run: `command -v caddy >/dev/null && FFLOGS_PROXY_SECRET=x caddy validate --config deploy/fflogs-proxy/Caddyfile || echo "caddy 未安装，跳过校验"`
Expected: `Valid configuration` 或跳过提示。

- [ ] **Step 5: lint + 提交**

Run: `pnpm lint`
Expected: 无错误。

```bash
git add wrangler.toml deploy/fflogs-proxy/Caddyfile deploy/fflogs-proxy/README.md
git commit -m "chore(deploy): FFLogs 反向代理 Caddyfile 与部署文档 + wrangler 变量示例"
```

---

## 收尾验证（全部任务完成后）

- [ ] `pnpm exec tsc --noEmit` —— 类型全过
- [ ] `pnpm lint` —— 无 lint 错误
- [ ] `pnpm test:run` —— 全量测试绿（默认无 proxy 配置，回退直连，既有行为不变）
- [ ] `pnpm build` —— 构建通过

## Self-Review 记录

- **Spec 覆盖**：4 处出口（Task 2 覆盖 fflogsClientV2 两处、Task 3 覆盖 auth 两处）✓；辅助模块 + 自动回退（Task 1）✓；Env/Config 字段（Task 2）✓；鉴权 header（Task 1 fflogsFetch）✓；Caddyfile + 部署（Task 4）✓；单测（Task 1）✓。
- **占位符扫描**：无 TBD/TODO；每个改代码步骤均给出完整代码。
- **类型一致性**：`rewriteFFLogsUrl` / `fflogsFetch` 签名在 Task 1 定义，Task 2/3 调用处 opts 形状 `{ proxyBase, proxySecret }` 一致；`FFLogsV2Config` 字段名 `proxyBase`/`proxySecret` 全计划统一。
- **对 spec 的精化**：`fflogsFetch` 第三参数用配置对象而非 `env`（Global Constraints 已注明），行为等价、复用性更好。
