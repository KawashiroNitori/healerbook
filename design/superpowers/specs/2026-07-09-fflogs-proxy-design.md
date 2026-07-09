# FFLogs 请求经独立 IP 反向代理转发 — 设计文档

**日期**: 2026-07-09
**状态**: 设计已确认，待实现

## 背景与问题

本项目的 Cloudflare Worker 对 FFLogs API 的所有请求，出口都走 Cloudflare 的**共享 IP**。
FFLogs 对每个来源 IP 施加**基于 IP 的共享限速**，导致即便本项目自有的 API key 配额充足，
仍频繁遭遇限流（429）。

用户已有一台带**独立 IP** 的轻量服务器，以及一个可解析到该 IP 的域名。目标是让 Worker 的
FFLogs 请求全部经由这台独立 IP 的服务器转发，使 FFLogs 看到的来源 IP 统一为该独立 IP，从而
规避共享 IP 限速。

## 目标与约束

- **所有** FFLogs 相关请求都走代理：GraphQL、client_credentials token、用户登录 OAuth、user 接口。
- 代理侧**零开发**：使用现成开源反向代理（**Caddy**），仅写配置文件，不写代码。
- **最省成本**：Caddy 单二进制 + 自动 HTTPS（Let's Encrypt），证书零运维。
- Worker 侧改动集中、可回退，不影响本地开发与现有测试。

### 硬性前提

Cloudflare Workers 的 `fetch()` 要求上游为**合法 HTTPS 证书**（不接受自签名，也不支持
HTTP_PROXY / CONNECT 隧道）。因此代理必须用一个能签发有效证书的域名对外暴露 HTTPS。
用户已确认拥有可用域名，前提满足。

## 方案选择

反向代理软件选 **Caddy**（相较 Nginx / Traefik）：唯一「域名填入、HTTPS 全自动、续期免运维」
的选项，配置为十几行纯声明式 Caddyfile，最贴合零开发 / 省成本目标。

路由采用**路径前缀方案**（相较子域名方案）：单域名、单证书、无需泛解析与泛域名证书。

## 架构

```
Cloudflare Worker
   │  fflogsFetch(url, init, env)
   │    - 改写 URL: https://<sub>.fflogs.com/<path> → https://ffproxy.域名/<sub>/<path>
   │    - 附加 header: X-Proxy-Secret
   ▼  (HTTPS)
Caddy 反向代理（独立 IP 服务器）
   │    - 校验 X-Proxy-Secret，不匹配 → 403
   │    - handle_path /www/* → https://www.fflogs.com（剥前缀 + Host 改写）
   │    - handle_path /cn/*  → https://cn.fflogs.com （剥前缀 + Host 改写）
   ▼  (HTTPS, 来源 = 独立 IP)
FFLogs 上游（www.fflogs.com / cn.fflogs.com）
```

## 需改动的 4 处出口

| #   | 文件:行                             | 上游                                 | 用途                     |
| --- | ----------------------------------- | ------------------------------------ | ------------------------ |
| 1   | `src/workers/fflogsClientV2.ts:237` | `www.fflogs.com/oauth/token`         | client_credentials token |
| 2   | `src/workers/fflogsClientV2.ts:286` | `${region}.fflogs.com/api/v2/client` | GraphQL（cn / www 区）   |
| 3   | `src/workers/routes/auth.ts:65`     | `www.fflogs.com/oauth/token`         | 用户登录 code 换 token   |
| 4   | `src/workers/routes/auth.ts:78`     | `www.fflogs.com/api/v2/user`         | 用户信息查询             |

## Worker 侧设计

### 共享辅助模块 `src/workers/fflogsProxy.ts`

集中承载「URL 改写 + 鉴权 header 注入」，四处出口统一改用它，逻辑不散落。

```ts
// 把 https://<sub>.fflogs.com/<path> 改写成 ${base}/<sub>/<path>
export function rewriteFFLogsUrl(url: string, proxyBase?: string): string {
  if (!proxyBase) return url // 未配置 → 原样直连
  const u = new URL(url)
  if (!u.hostname.endsWith('.fflogs.com')) return url
  const sub = u.hostname.split('.')[0] // 'www' | 'cn'
  return `${proxyBase.replace(/\/$/, '')}/${sub}${u.pathname}${u.search}`
}

export function fflogsFetch(url: string, init: RequestInit, env: Env): Promise<Response> {
  const target = rewriteFFLogsUrl(url, env.FFLOGS_PROXY_BASE)
  const headers = new Headers(init.headers)
  if (env.FFLOGS_PROXY_BASE && env.FFLOGS_PROXY_SECRET) {
    headers.set('X-Proxy-Secret', env.FFLOGS_PROXY_SECRET)
  }
  return fetch(target, { ...init, headers })
}
```

### 配套改动

- **`Env` 类型**：新增 `FFLOGS_PROXY_BASE?: string`（普通 var，就是代理 base URL）和
  `FFLOGS_PROXY_SECRET?: string`（Cloudflare secret）。
- **`FFLogsClientV2`**：`FFLogsV2Config` 增加 `proxyBase?` / `proxySecret?`，各实例化点
  （`routes/fflogs.ts`、TOP100 同步等）透传 env 值；类内 `getAccessToken` / `query` 改用 `fflogsFetch`。
- **`auth.ts`**：`fetchFFLogsUser` 当前未接 `env`，需把 `env` 透传进去；两处 `fetch` 换为 `fflogsFetch`。

### 自动回退（重要）

`FFLOGS_PROXY_BASE` 未设置时，`fflogsFetch` 退化为普通直连 FFLogs。收益：

- 本地开发与现有单测**不受影响**（默认直连，mock 的 fetch 照常命中）。
- 线上**一键开关**：代理故障时，删除该 env 变量重新部署即可立即回到直连。

### 鉴权

Worker 每个转发请求带 `X-Proxy-Secret: <强随机串>`；Caddy 校验，匹配才转发，否则 403。
secret 通过 `wrangler secret put FFLOGS_PROXY_SECRET` 存入 Worker、通过环境变量注入 Caddy，
两侧同值。上游 FFLogs 的真实鉴权（OAuth Basic、Bearer token）仍在 `Authorization` header 中
原样透传，代理不干预。所有敏感 header 全程走 Worker↔代理的 HTTPS 加密链路。

## 代理侧设计（Caddyfile）

```caddyfile
ffproxy.你的域名 {
	# 门禁：header 里的 secret 必须匹配，否则 403
	@authorized header X-Proxy-Secret "{env.FFLOGS_PROXY_SECRET}"

	handle @authorized {
		handle_path /www/* {
			reverse_proxy https://www.fflogs.com {
				header_up Host www.fflogs.com
			}
		}
		handle_path /cn/* {
			reverse_proxy https://cn.fflogs.com {
				header_up Host cn.fflogs.com
			}
		}
		respond "Not Found" 404
	}

	respond "Forbidden" 403
}
```

- `handle_path` 剥掉 `/www`、`/cn` 前缀（`/www/oauth/token` → 上游 `/oauth/token`）。
- `header_up Host` 将 Host 改回真实上游，保证 FFLogs 虚拟主机路由与 TLS SNI 正确。
- `{env.FFLOGS_PROXY_SECRET}` 在 Caddy 加载配置时展开，secret 不写死在文件内。

## 部署要点

1. **DNS**：`ffproxy.xivhealer.com`（xivhealer.com 托管在 Cloudflare）加 A 记录指向独立 IP，
   **必须设为 DNS only（灰云 / `proxied: false`）**——若开橙云代理，Worker→代理会绕回 Cloudflare
   共享 IP，且 Caddy 的 HTTP-01 证书挑战会被拦截失败。可用 Cloudflare API / `flarectl` 命令行创建。
2. **端口**：放行 `80`（ACME 证书签发）+ `443`。
3. **生成 secret**：`openssl rand -hex 32`。
4. **跑 Caddy**：systemd 或 docker，注入 `FFLOGS_PROXY_SECRET=<值>`，`caddy run --config Caddyfile`，证书自动申请与续期。
5. **Worker 侧**：`wrangler secret put FFLOGS_PROXY_SECRET`（同值）；wrangler `[vars]` 加
   `FFLOGS_PROXY_BASE = "https://ffproxy.你的域名"`。

### 连通性提示

代理机器需同时连通 `www.fflogs.com`（国际区）与 `cn.fflogs.com`（国服）。若某上游从该机器网络
连不通，则该区请求会失败——与机器所在网络环境有关，部署后各测一条验证。

## 测试

为纯函数 `rewriteFFLogsUrl` 加单测，覆盖：

- `www` / `cn` 两个上游
- `/oauth/token`、`/api/v2/client`、`/api/v2/user` 三种路径
- 非 `fflogs.com` 域名 → 原样透传
- `proxyBase` 未配置 → 原样透传
- base URL 末尾带/不带 `/` 的归一化

现有 Worker 测试因默认回退直连而无需改动。

## 非目标（YAGNI）

- 不做代理侧的缓存、重试、限流等增强（Worker 侧已有有界并发与 token 缓存）。
- 不引入比静态共享 secret 更复杂的鉴权机制。
- 不改动 FFLogs 请求的业务逻辑（分页、并发、字段映射等一律不动）。
