# Healerbook Workers

Cloudflare Workers 后端服务，提供 FFLogs API 代理和 TOP100 数据同步功能。

## 功能

### 1. FFLogs API 代理
- `GET /api/fflogs/report/:reportCode` - 获取战斗报告
- `GET /api/fflogs/events/:reportCode?start=0&end=1000` - 获取战斗事件

### 2. TOP100 数据查询
- `GET /api/top100` - 获取所有副本的 TOP100 数据
- `GET /api/top100/:encounterId` - 获取指定副本的 TOP100 数据

### 3. TOP100 数据同步
- **自动同步**: 通过 Cron 每 12 小时自动执行
- **手动同步**: `POST /api/top100/sync` (需要鉴权)

## 配置

### 环境变量 (Secrets)

使用 `wrangler secret` 命令设置敏感信息：

```bash
# FFLogs v2 API 凭证
wrangler secret put FFLOGS_CLIENT_ID
wrangler secret put FFLOGS_CLIENT_SECRET

# 手动同步接口鉴权令牌
wrangler secret put SYNC_AUTH_TOKEN
```

### KV 命名空间

在 `wrangler.toml` 中配置：

```toml
[[kv_namespaces]]
binding = "healerbook"
id = "your-kv-namespace-id"
```

## 手动同步接口鉴权

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

- 检查 `Authorization` header 格式是否正确
- 确认 `SYNC_AUTH_TOKEN` 已正确设置
- 验证令牌是否匹配

### 500 Internal Server Error

- 检查 FFLogs API 凭证是否正确
- 查看 Workers 日志获取详细错误信息
- 确认 KV 命名空间绑定正确

## 相关文档

- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Cloudflare KV](https://developers.cloudflare.com/kv/)
- [FFLogs API](https://www.fflogs.com/api/docs)
