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

> ⚠️ 若日后为排障给 Caddyfile 加 `log` 指令：Caddy 对 `Authorization` / `Cookie` 有内置脱敏，但对
> 自定义的 `X-Proxy-Secret` **没有**，会明文写入日志文件。如需开日志，先在 `log` 块里配置
> `header { request >X-Proxy-Secret REDACTED }`（或等效脱敏规则）再上线。

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
