# 共享时间轴存储迁移：KV → D1

**日期**: 2026-03-26
**状态**: 待实现

## 背景

共享时间轴目前存储在 Cloudflare KV（binding: `healerbook`），以 `timeline:{id}` 为 key，整个 `SharedTimeline` 对象序列化为 JSON value。KV 不支持结构化查询，无法按作者列出时间轴或建立索引。迁移到 D1 可在保持现有接口不变的前提下，为后续查询能力打好基础。

现有 KV 数据不迁移，从零开始。

## 目标

- 将 Worker 端共享时间轴的读写从 KV 换成 D1
- 外部 API 接口、请求/响应格式、乐观锁行为完全不变
- 前端代码零改动

## 非目标

- 本地私有时间轴（localStorage）不在此次范围内
- 现有 KV 数据迁移
- 新增查询接口（按作者列表等）

## 数据库 Schema

```sql
-- 位于项目根 migrations/0001_create_timelines.sql
CREATE TABLE timelines (
  id           TEXT    PRIMARY KEY,
  name         TEXT    NOT NULL,
  author_id    TEXT    NOT NULL,
  author_name  TEXT    NOT NULL,
  published_at INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  version      INTEGER NOT NULL DEFAULT 1,
  content      TEXT    NOT NULL  -- JSON blob，存储其余时间轴字段
);
```

### 字段归属对照

客户端上传的 `SharedTimeline` 字段分为两类：

| 结构化列（D1 列）            | content JSON blob           |
| ---------------------------- | --------------------------- |
| `id`                         | `encounter`                 |
| `name`                       | `damageEvents`              |
| `author_id`（服务端生成）    | `castEvents`                |
| `author_name`（服务端生成）  | `composition`               |
| `published_at`（服务端生成） | `phases`                    |
| `updated_at`（服务端生成）   | `createdAt`（客户端原始值） |
| `version`（服务端生成）      | 其他客户端透传字段          |

**写入规则**：从请求体中提取结构化列对应的字段写入各列；将剩余全部字段（包括 `createdAt` 等客户端透传字段）序列化为 `content` JSON 字符串。

**读取合并规则**：先将 `content` 反序列化为对象，再用结构化列的值**覆盖**同名字段（结构化列优先），最终构造 `SharedTimeline` 返回。这样即使 `content` 中残留有旧的 `name` 等字段，也不会干扰结果。

## 文件改动

### `migrations/0001_create_timelines.sql`（新增，位于项目根）

建表 DDL，通过以下命令执行：

```bash
wrangler d1 migrations apply healerbook --env development
wrangler d1 migrations apply healerbook-prod --env production
```

### `wrangler.toml`

添加 D1 binding。需先通过 `wrangler d1 create` 创建数据库获得 `database_id`。配置三块均需添加，各自作用域不同：

```toml
# 顶层：wrangler dev 不指定 --env 时的默认值（与 env.development 相同 ID，两块均需存在）
[[d1_databases]]
binding = "DB"
database_name = "healerbook"
database_id = "<dev-database-id>"

# development env：wrangler dev --env development 时覆盖顶层
[[env.development.d1_databases]]
binding = "DB"
database_name = "healerbook"
database_id = "<dev-database-id>"

# production env：--env production 时覆盖
[[env.production.d1_databases]]
binding = "DB"
database_name = "healerbook-prod"
database_id = "<prod-database-id>"
```

> 顶层块与 `env.development` 块 `database_id` 相同是有意为之——对应现有 KV 的双重定义模式。两块均需保留，否则 `wrangler dev`（无 `--env`）时会找不到 D1 binding。

KV binding `healerbook` 保留，`top100Sync.ts` 等其他模块仍依赖它。

### `src/workers/fflogs-proxy.ts`（Env 类型）

`Env` 接口**新增** `DB: D1Database`，**保留** `healerbook: KVNamespace`（其他模块仍在使用）：

```typescript
interface Env {
  healerbook: KVNamespace // 保留，top100Sync 等仍使用
  DB: D1Database // 新增，timelines 迁移到 D1
  // ...其他字段不变
}
```

### `src/workers/timelines.ts`

将 3 处 KV 调用替换为 D1 SQL：

| 操作 | KV                          | D1                                                                               |
| ---- | --------------------------- | -------------------------------------------------------------------------------- |
| 创建 | `healerbook.put(key, json)` | `INSERT INTO timelines (id, name, ..., content) VALUES (?, ?, ..., ?)`           |
| 读取 | `healerbook.get(key)`       | `SELECT * FROM timelines WHERE id = ?`                                           |
| 更新 | `healerbook.put(key, json)` | `UPDATE timelines SET name=?, ..., version=version+1 WHERE id=? AND author_id=?` |

**`handlePut` 执行流程**：

1. `SELECT * WHERE id = ?` — 取得 `authorId` 做权限检查（403）；若不存在返回 404
2. 权限通过后，执行原子 UPDATE：
   ```sql
   UPDATE timelines
   SET name=?, author_name=?, updated_at=?, version=version+1, content=?
   WHERE id=? AND version=?
   ```
3. 检查 `result.meta.changes`：
   - `=== 0` → 版本冲突，返回 409（理论上也可能是步骤 1 到步骤 2 之间记录被删除，但此场景概率极低，统一返回 409 是可接受的简化）
   - `=== 1` → 更新成功，返回 200

### `src/workers/timelines.test.ts`

将 `makeMockKV` + `makeMockEnv` 替换为 `makeMockD1`，使用内存 Map 模拟 D1 的链式调用接口：

```typescript
function makeMockD1(initial: Record<string, unknown>[] = []): D1Database {
  const rows = new Map(initial.map(r => [r.id as string, r]))
  const makeStmt = (sql: string) => ({
    bind: (...args: unknown[]) => ({
      first: async () => {
        /* SELECT 逻辑 */
      },
      run: async () => {
        /* INSERT / UPDATE 逻辑，返回 { meta: { changes } } */
      },
    }),
  })
  return { prepare: makeStmt } as unknown as D1Database
}
```

测试用例覆盖范围不变：401、403、409 冲突、200/201 成功、404、isAuthor 判断。

## 实现步骤

1. 通过 `wrangler d1 create` 创建开发和生产数据库，记录 `database_id`
2. 创建 `migrations/0001_create_timelines.sql`（项目根）
3. 更新 `wrangler.toml`，添加三块 D1 配置（填入步骤 1 得到的 `database_id`）
4. 更新 `Env` 接口，新增 `DB: D1Database`
5. 重写 `timelines.ts` 中的 `handlePost`、`handlePut`、`handleGet`
6. 更新 `timelines.test.ts`，替换 KV mock 为 D1 mock
7. 执行 `wrangler d1 migrations apply` 建表（依赖步骤 1、3 已完成）
8. 本地运行测试验证
