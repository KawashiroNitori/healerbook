# Healerbook Workers

Cloudflare Workers 后端服务：`src/workers/index.ts` 是 Hono 入口，全局 `app.onError` 统一兜错，按功能域挂载路由（详见项目根目录 `CLAUDE.md` 的「Workers 路由结构」一节，本文件不重复列出）。

## 目录结构

- `routes/` —— 各功能域的 Hono 子路由（auth / timelines / share / my / fflogs / top100 / statistics / encounterTemplates / samplesQueue / internalMigrate / internalDiag）。
- `middleware/` —— `requireAuth`（JWT 必需）、`tryReadAuth`（可选身份识别）、`requireSyncToken`（内部/同步端点鉴权）。
- `durable/` —— `TimelineDoc.ts`，协作文档的 Durable Object 实现。
- `collab/` —— 协作同步协议与存储：`doSqlStore.ts`（DO 内 SQLite 双表存储：snapshot + 增量 updates）等。
- 顶层其余文件：`jwt.ts`（JWT 签发/验证）、`env.ts`（Env 类型定义）、`scheduled.ts`（Cron 定时任务入口）、`allowedOrigins.ts`（CORS 白名单）、`top100Sync.ts` / `fflogsClientV2.ts` / `samplesQueue.ts` / `sensitiveWordFilter.ts` / `userCredentials.ts` 等业务/工具模块。

## 配置

### 环境变量 (Secrets)

使用 `wrangler secret` 命令设置敏感信息：

```bash
# FFLogs v2 API 凭证
wrangler secret put FFLOGS_CLIENT_ID
wrangler secret put FFLOGS_CLIENT_SECRET

# 手动同步 / 内部接口鉴权令牌
wrangler secret put SYNC_AUTH_TOKEN
```

### KV 命名空间

在 `wrangler.toml` 中配置：

```toml
[[kv_namespaces]]
binding = "healerbook"
id = "your-kv-namespace-id"
```

## 手动同步 / 内部接口鉴权

`requireSyncToken` 中间件保护 `/api/top100/sync`、`/api/samples-queue/enqueue`、`/api/internal/*` 等端点。

### 设置鉴权令牌

```bash
# 生成一个随机令牌
openssl rand -hex 32

# 设置到 Cloudflare Workers
wrangler secret put SYNC_AUTH_TOKEN
# 输入上面生成的令牌
```

### 调用接口

使用 `Authorization: Bearer <token>` header：

```bash
curl -X POST https://your-worker.workers.dev/api/top100/sync \
  -H "Authorization: Bearer your-secret-token"
```

### 响应示例

**成功 (200)**:

```json
{
  "message": "同步完成",
  "success": 10,
  "failed": 0,
  "errors": []
}
```

**未授权 (401)**:

```json
{
  "error": "Unauthorized"
}
```

## 开发

### 本地开发

```bash
# 启动开发服务器
pnpm workers:dev

# 测试手动同步 (需要在 .dev.vars 中配置 SYNC_AUTH_TOKEN)
curl -X POST http://localhost:8787/api/top100/sync \
  -H "Authorization: Bearer your-dev-token"
```

### 部署

```bash
# 部署到生产环境
pnpm workers:deploy

# 或使用 wrangler
wrangler deploy
```

## 安全建议

1. **保护 SYNC_AUTH_TOKEN**: 使用强随机令牌 (至少 32 字节)
2. **定期轮换**: 建议每 3-6 个月更换一次令牌
3. **限制访问**: 仅在必要时使用手动同步接口
4. **监控日志**: 定期检查 Workers 日志，发现异常访问

## 故障排查

### 401 Unauthorized

- 检查 `Authorization` header 格式是否正确（JWT 端点用登录态 token，同步/内部端点用 `SYNC_AUTH_TOKEN`）
- 确认对应的鉴权 secret 已正确设置
- 验证令牌是否匹配

### 500 Internal Server Error

- 检查 FFLogs API 凭证是否正确
- 查看 Workers 日志获取详细错误信息
- 确认 KV 命名空间 / D1 / Durable Object 绑定正确

## 相关文档

- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Cloudflare KV](https://developers.cloudflare.com/kv/)
- [FFLogs API](https://www.fflogs.com/api/docs)
