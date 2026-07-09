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

快速验证可以前台跑：

```bash
FFLOGS_PROXY_SECRET=<上一步生成的值> caddy run --config Caddyfile
```

证书由 Caddy 自动申请并续期（域名已是 `ffproxy.xivhealer.com`）。

**生产用 systemd**。apt 安装的 `caddy` 包自带 unit，但它有两个必须覆盖的默认值：

```bash
sudo mkdir -p /etc/systemd/system/caddy.service.d
sudo tee /etc/systemd/system/caddy.service.d/override.conf > /dev/null <<'EOF'
[Service]
Environment=FFLOGS_PROXY_SECRET=<上一步生成的值>
# 包自带 ExecStart 含 --environ，会把所有环境变量（含本 secret）明文打进 journald
ExecStart=
ExecStart=/usr/bin/caddy run --config /etc/caddy/Caddyfile
# 包自带 unit 没有重启策略，Caddy 崩溃后不会被拉起
Restart=on-failure
RestartSec=5s
EOF
sudo chmod 600 /etc/systemd/system/caddy.service.d/override.conf
sudo systemctl daemon-reload && sudo systemctl enable --now caddy
```

> ⚠️ **`--environ` 陷阱**：若照搬包自带的 `ExecStart`，`journalctl -u caddy` 里会有一行明文
> `FFLOGS_PROXY_SECRET=…`，且 `/var/log/journal` 默认持久化。已经踩过一次就得
> `journalctl --rotate && journalctl --vacuum-time=1s` 清理，并**轮换 secret**。

> ⚠️ secret 未注入时 Caddy 仍会正常启动，但门禁静默降级（`{env.X}` 展开为空串，带空值
> `X-Proxy-Secret` header 的请求可绕过）。把 secret 固化在 `override.conf` 里正是为了避免手工遗漏。

> ⚠️ 若日后为排障给 Caddyfile 加 `log` 指令：Caddy 对 `Authorization` / `Cookie` 有内置脱敏，但对
> 自定义的 `X-Proxy-Secret` **没有**，会明文写入日志文件。如需开日志，先在 `log` 块里配置
> `header { request >X-Proxy-Secret REDACTED }`（或等效脱敏规则）再上线。

### 5. 配置 Worker

> ⚠️ **顺序不能反**：必须先完成下面「验证」一节、确认代理可用，再设置 `FFLOGS_PROXY_BASE`。
> 一旦设了 BASE 而代理不可用，线上所有 FFLogs 请求都会失败。

```bash
pnpm exec wrangler secret put FFLOGS_PROXY_SECRET --env production   # 填与上面同一个值
```

secret 单独存在时是惰性的（`fflogsFetch` 要求 base 与 secret 同时配置才注入 header），可以放心先放。
确认代理健康后，再在 `wrangler.toml` 对应环境的 `[vars]` 设置：

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
  curl -i -H "X-Proxy-Secret: <值>" https://ffproxy.xivhealer.com/www/api/v2/client  # 期望到达上游
  ```

  **注意状态码不足以判断是否转发成功**：代理自身的「前缀未命中」也返回 404，而 FFLogs 对
  `GET /api/v2/client` 同样返回 404。看响应头区分：

  | 响应头                          | 含义                     |
  | ------------------------------- | ------------------------ |
  | `server: Caddy`                 | 被代理兜底，**没有**转发 |
  | `server: cloudflare` + `cf-ray` | 已穿透到 FFLogs          |

- **出站地址族**：若机器有 IPv6，Caddy 默认走 IPv6 出站，FFLogs 看到的就是 IPv6 而非 A 记录里那个
  IPv4。云厂商的 IPv6 `/64` 常在客户间共享，若上游按 `/64` 聚合限速，规避效果会打折。检查：

  ```bash
  curl -sS -o /dev/null -w "local=%{local_ip}\n" https://www.fflogs.com/api/v2/client
  ```

- **不要把共享 IP 送给上游**：Caddy 的 `reverse_proxy` 默认追加 `X-Forwarded-For`（值为 Worker 的
  Cloudflare 出口 IP）。Caddyfile 已用 `header_up -X-Forwarded-*` 剥除——这是本方案能生效的前提之一。
