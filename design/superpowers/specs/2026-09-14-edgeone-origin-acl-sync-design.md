# EdgeOne 回源 IP 网段自动同步到 Cloudflare IP 列表设计

**日期**: 2026-09-14
**状态**: 已确认，待实现

## 背景与问题

国内站点 `xivhealer.cn` 经腾讯云 EdgeOne 加速后回源到 Cloudflare。EdgeOne 开启了「源站防护」（OriginACL），
回源请求只来自一组官方公布的 IP 网段；Cloudflare 账户下维护了一个同名 IP 列表 `edgeone`
（List ID `0681de725731434689c4240e6a254b09`），用于在 WAF 规则中识别 EdgeOne 回源流量。

EdgeOne 会不定期发布新版本回源网段（例如 `gaz-0.0.3` → `gaz-0.0.4`，计划 2026-10-12 生效），
变更前 14/7/3/1 天通过站内信、短信、邮件通知。目前靠人工调用 `DescribeOriginACL` 再手动改 Cloudflare 列表，
容易遗漏，且切换完成后还需要再手动删除被移除的旧网段。

腾讯云文档（产品文档 1552/76086「源站防护」）推荐的自动化闭环：定期调用 `DescribeOriginACL`，
发现 `NextOriginACL` 非空时同步到源站防火墙，完成后调用 `ConfirmOriginACLUpdate`（确认后停止推送变更通知）。

## 目标

- 每天自动把 Cloudflare `edgeone` 列表与 EdgeOne 回源网段对齐：
  - 存在 `NextOriginACL` 时：列表 = `CurrentOriginACL.EntireAddresses` ∪ `NextOriginACL.EntireAddresses`
  - 不存在时：列表 = `CurrentOriginACL.EntireAddresses`（切换完成后旧网段自动被删除）
- 同步并回读校验成功、且存在待生效新版本时，自动调用 `ConfirmOriginACLUpdate`。

## 非目标

- 不创建、不修改引用该列表的 WAF 规则（当前 `num_referencing_filters = 0`，规则配置另行人工处理）。
- 不接入告警通道；失败只写 Worker 日志，与现有 cron 任务一致。
- 不处理 L4 代理实例（`L4ProxyIds` 为空）。
- 不引入腾讯云 / Cloudflare SDK。

## 设计

### 运行位置与触发

挂在现有 `healerbook` Worker 的 cron 机制上：

- `wrangler.toml` 顶层 `[triggers] crons` 追加 `"0 3 * * *"`（UTC 03:00，每天一次；`[env.production]` 未单独声明 triggers，继承顶层）。
- `src/workers/scheduled.ts` 的 `switch (event.cron)` 新增分支：`ctx.waitUntil(runEdgeOneOriginSync(env))`。

### 模块划分

新目录 `src/workers/edgeoneOriginSync/`：

| 文件                 | 职责                                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tencentCloud.ts`    | TC3-HMAC-SHA256 签名（Web Crypto：SHA-256 / HMAC-SHA256）与 `callTeo(creds, action, payload)`，返回 `Response` 字段；`Response.Error` 存在时抛错              |
| `cloudflareLists.ts` | Cloudflare Lists API：分页读取条目（cursor）、`POST items` 追加、`DELETE items` 按 id 删除、轮询 `bulk_operations/{id}` 至 `completed`（`failed` 或超时抛错） |
| `sync.ts`            | 纯函数 `normalizeCidr` / `computeTargetSet` / `diffItems`，编排函数 `syncEdgeOneOriginAcl(deps)`；外部调用通过 `deps` 注入                                    |
| `index.ts`           | `runEdgeOneOriginSync(env)`：读取配置、组装真实 deps、调用编排、输出日志                                                                                      |

### 数据流

```
DescribeOriginACL(ZoneId)
  → computeTargetSet(current, next)          // 标准化 CIDR，去重
  → 安全闸（见下）
  → listItems(CF)                            // 现有条目 {id, ip}
  → diffItems(existing, target) → {toAdd, toRemove}
  → toAdd 非空：POST items → 轮询完成
  → toRemove 非空：DELETE items(ids) → 轮询完成
  → listItems(CF) 回读，集合必须等于 target
  → next 存在：ConfirmOriginACLUpdate(ZoneId)
```

- **先加后删**：中途失败时列表只会多、不会少，不会误拦 EdgeOne 回源。Cloudflare 同一列表同一时刻只允许一个批量操作，两步串行执行。
- **无差异时**不写入；若存在 next 仍调用确认（幂等）。
- **CIDR 标准化**：`normalizeCidr` 统一为网络地址 + 前缀形式（IPv4 点分十进制；IPv6 按 RFC 5952 压缩小写），比较与写入都用标准化值，避免同一网段不同写法被判为差异。Cloudflare 回读的 `ip` 字段同样标准化后比较。
- 新增条目写入 `comment`：`EdgeOne <version>`（取该网段所属版本，同时属于两个版本时取 current 版本号）。

### 配置与密钥

`[env.production.vars]`（非敏感）：

```toml
EDGEONE_ZONE_ID = "zone-3q0wz2up03uy"
CF_ACCOUNT_ID = "b35d3e7a2fdaf5712fa29ea9a32c6c9a"
CF_EDGEONE_LIST_ID = "0681de725731434689c4240e6a254b09"
```

`wrangler secret put --env production`（由用户创建）：

| Secret                                               | 来源与最小权限                                                                        |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `TENCENTCLOUD_SECRET_ID` / `TENCENTCLOUD_SECRET_KEY` | 独立 CAM 子用户长期密钥，仅授予 `teo:DescribeOriginACL`、`teo:ConfirmOriginACLUpdate` |
| `CF_LISTS_API_TOKEN`                                 | Cloudflare 账户 API Token，仅 `Account Filter Lists: Edit`，不设过期                  |

`src/workers/env.ts` 的 `Env` 增加上述 6 个可选字段。任一缺失时 `runEdgeOneOriginSync` 输出一条
`console.warn('[EdgeOne Sync] 配置缺失，跳过')` 并返回，development 环境因此无副作用。

腾讯云请求固定 `Host: teo.tencentcloudapi.com`、`X-TC-Version: 2022-09-01`，不传 `X-TC-Region`（EdgeOne 为全局接口）。

### 安全闸与错误处理

以下情况中止本轮，不修改 Cloudflare、不调用确认：

- 腾讯云返回 `Response.Error`，或 `CurrentOriginACL.EntireAddresses` 的 IPv4 + IPv6 总数为 0；
- 任一网段无法解析为合法 CIDR；
- 目标集合大小 < 现有列表大小的 50%（防止异常数据清空列表）。

批量操作 `failed`、轮询超时（30 次 × 2 秒）、回读集合与目标不一致时抛错，同样不调用确认。
所有错误由 `runEdgeOneOriginSync` 捕获并以 `console.error('[EdgeOne Sync] ...')` 输出；下一天自动重试。
成功时输出一行汇总：版本号、目标条数、新增数、删除数、是否已确认。

## 测试

- `sync.test.ts`
  - `normalizeCidr`：IPv4 非网络地址修正、IPv6 压缩形式、非法输入抛错
  - `computeTargetSet`：无 next / 有 next 并集 / 去重
  - `diffItems`：新增、删除、无变化
  - `syncEdgeOneOriginAcl`（fake deps）：先加后删的调用顺序；无差异不写入；安全闸三种情况不写入不确认；
    回读不一致时抛错且不确认；有 next 且成功时确认、无 next 时不确认
- `tencentCloud.test.ts`：固定 SecretId/SecretKey/timestamp/payload，按腾讯云 TC3 签名文档示例核对
  `Authorization` 头
- `cloudflareLists.test.ts`：mock `fetch` 验证分页 cursor 拼接、轮询至 completed、failed 抛错
- 手动验证：`wrangler dev --test-scheduled` 后请求 `/__scheduled?cron=0+3+*+*+*`，观察日志；部署需用户授权。
