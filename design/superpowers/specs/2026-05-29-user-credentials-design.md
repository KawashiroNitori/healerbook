# 用户体系与凭据表设计

> 引入独立的我方用户主体（`users`）与通用凭据表（`user_credentials`），把 FFLogs OAuth 降级为挂在用户身下的一种认证方式，并记录 FFLogs 颁发的 access_token 以备后续代用户调 API。

**日期**: 2026-05-29
**状态**: 设计待评审

## 1. 背景与动机

当前项目**没有"我方用户"这个实体**。登录后 `userId = String(fflogs.id)`，直接作为：

- JWT 的 `sub`（见 `src/workers/routes/auth.ts`、`src/workers/jwt.ts`）
- `timelines.author_id`
- `timeline_editors.user_id` / `timeline_edit_requests.user_id`
- 前端 author 判定（编辑器 `local`/`author`/`view` 模式靠 `currentUser.id === author_id`）

即 **fflogs id 就是身份本身**，且登录拿到的 FFLogs access_token 用完即弃。

本期目标：

1. 建立独立的我方用户主体 `users`，fflogs 成为一种 credential。
2. 用通用 `user_credentials` 表承载多种认证方式（本期实现 oauth/fflogs，预留 passkey、password）。
3. 记录 FFLogs 颁发的 access_token（供后续"代用户调 FFLogs API"，本期只到"可被取出"为止，不含实际代调）。
4. 平滑迁移存量数据，**不破坏现有数据、不强制存量用户重新登录**。

## 2. 设计决策与取舍（评审已确认）

| 决策                   | 结论                                                                                                | 理由                                                                                          |
| ---------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 存储位置               | 复用现有 `healerbook_timelines` D1 库，新增表                                                       | 跨库无法 JOIN/事务；token 与用户数据同域；省一套 dev/prod binding                             |
| token 加密             | **明文存储**                                                                                        | D1 访问受 Worker 控制；快速交付，未来可加密                                                   |
| my-user-id 形态        | 整数自增；**存量复用 fflogs id（< 1e6），新用户从 1000001 起自增**                                  | 存量零迁移，且存量用户 `users.id == fflogs id` 使其已签 JWT 仍兼容                            |
| 命名空间碰撞           | 用户保证存量 user_id 全 < 1e6；复用只针对**存量封闭集合**，新登录者一律走自增（≥1e6），两区间不相交 | 避免两个无上界整数命名空间相撞                                                                |
| credential 建模        | **单表 + type + JSON**（修正版）                                                                    | 加新认证类型零 DDL；认证类型少时灵活性优先                                                    |
| provider               | 提升为独立一等列（稳定来源键，参与唯一约束与查找）                                                  | passkey 的"用户命名"是展示名、可变可重复，放 `data.name`，不与来源键混用                      |
| secret_data / metadata | 合并为单个 `data` JSON 列                                                                           | 已选明文，拆分（仅加密敏感列）的价值不成立，YAGNI                                             |
| 唯一约束               | `UNIQUE(provider, identifier)`                                                                      | 同时满足：可绑多 passkey（identifier 不同）、同一 credential 不重复、同一 fflogs 账号唯一归属 |

### 2.1 被否决的方案

- **单表宽表（type + 所有专属列 nullable）**：大量列对某些类型无意义，唯一/非空约束难表达。
- **基表 + 子表（CTI）**：本期只 oauth，引入基表过重。
- **Gemini 原始单表方案**：两个实质缺陷——(1) `UNIQUE(user_id, type, identifier)` 把 `user_id` 放进唯一键，导致同一外部账号可被多个用户绑定、登录按 `(type, identifier)` 查会返回多行；(2) 时间戳用 `TEXT DEFAULT datetime('now','localtime')`，在 UTC 的 Workers 上有时区 bug 且与项目 `INTEGER` 时间戳约定不符。本设计已修正这两点。

## 3. 数据模型

```sql
-- 用户主体
CREATE TABLE users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,  -- 存量复用 fflogs id(<1e6);新用户 ≥1e6
  name       TEXT    NOT NULL,                    -- 显示名(初始取 fflogs name)
  created_at INTEGER NOT NULL,                    -- unix 秒
  updated_at INTEGER NOT NULL
);

-- 通用凭据表(本期实现 oauth/fflogs;预留 passkey、password)
CREATE TABLE user_credentials (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  type       TEXT    NOT NULL,                    -- 'oauth' | 'passkey' | 'password'
  provider   TEXT    NOT NULL,                    -- 稳定来源键: 'fflogs' | 'passkey' | 'password'
  identifier TEXT    NOT NULL,                    -- oauth: fflogs_id;passkey: credential_id;password: email
  data       TEXT    NOT NULL,                    -- JSON;见下表
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CONSTRAINT json_check_data CHECK (json_valid(data))
);

CREATE UNIQUE INDEX idx_user_credentials_provider_identifier
  ON user_credentials (provider, identifier);
CREATE INDEX idx_user_credentials_user ON user_credentials (user_id);
```

### 3.1 `data` JSON 约定

| type       | provider   | identifier     | data                                                                      |
| ---------- | ---------- | -------------- | ------------------------------------------------------------------------- |
| `oauth`    | `fflogs`   | fflogs user id | `{ access_token, refresh_token, expires_at }`                             |
| `passkey`  | `passkey`  | credential_id  | `{ public_key, sign_count, transports, name }`（`name` 为用户自定义命名） |
| `password` | `password` | email          | `{ password_hash, salt }`                                                 |

- `expires_at`：unix 秒。本期 fflogs access_token 有效期约 1 年；fflogs 授权码流程不下发 refresh_token，故 `refresh_token` 存空串 `""`。
- 后续认证类型只需新增 `type`/`provider` 取值与 `data` 约定，无需 DDL。

### 3.2 唯一约束语义验证

`UNIQUE(provider, identifier)` 是复合唯一：

```
(provider='passkey', identifier='credA')  ✓
(provider='passkey', identifier='credB')  ✓  identifier 不同 → 同一用户可绑多个 passkey
(provider='passkey', identifier='credA')  ✗  同一 credential 重复注册被拒
(provider='fflogs',  identifier='12345')  ✓
(provider='fflogs',  identifier='12345')  ✗  同一 fflogs 账号不被多绑
```

## 4. 数据迁移

### migration `0005_create_user_credentials.sql`

1. 建 `users`、`user_credentials` 表与索引（见第 3 节）。
2. **seed 自增起点**，让新用户从 1000001 开始：
   ```sql
   INSERT INTO sqlite_sequence (name, seq) VALUES ('users', 1000000);
   ```
   （`sqlite_sequence` 在表声明 `AUTOINCREMENT` 后即存在；该行确保下一个自增值为 1000001。）
3. **回填存量用户**——对来自 `timelines`、`timeline_editors`、`timeline_edit_requests` 的 distinct 历史 user id 各建一行 `users` 与一行占位 `user_credentials`：

   ```sql
   -- 汇总存量 (id, name);同一 id 多处出现时取任一非空 name
   INSERT OR IGNORE INTO users (id, name, created_at, updated_at)
   SELECT id, MIN(name), unixepoch(), unixepoch() FROM (
     SELECT CAST(author_id AS INTEGER) AS id, author_name AS name FROM timelines
     UNION ALL
     SELECT CAST(user_id AS INTEGER),         user_name        FROM timeline_editors
     UNION ALL
     SELECT CAST(user_id AS INTEGER),         user_name        FROM timeline_edit_requests
   ) GROUP BY id;

   -- 为每个存量用户建占位 oauth 凭据(token 历史未存,留空,待其下次登录 UPSERT 填入)
   INSERT OR IGNORE INTO user_credentials
     (user_id, type, provider, identifier, data, created_at, updated_at)
   SELECT id, 'oauth', 'fflogs', CAST(id AS TEXT),
          json_object('access_token','', 'refresh_token','', 'expires_at', 0),
          unixepoch(), unixepoch()
   FROM users;
   ```

   - `INSERT OR IGNORE` 容忍重复，使迁移可重入。
   - 存量 id 全 < 1e6（用户保证），不与 seed 后的自增段相交。

> 迁移脚本本身在 PR 中编写并以 `wrangler d1 migrations apply` 应用；本设计只规定其语义。

## 5. 登录流程改造（`src/workers/routes/auth.ts`）

回填让所有存量用户已具备 `fflogs` 凭据，登录因此走**单一路径**，无需"新/旧区间复用判定"分支：

```
callback 拿到 fflogs (id, name):
  cred = 查 user_credentials(provider='fflogs', identifier=String(fflogs_id))
  if cred 命中:                         # —— 登录（已注册）
    user_id = cred.user_id
    UPSERT: 更新 cred.data = {access_token, refresh_token:'', expires_at = now + expires_in}
            更新 users.name = fflogs_name, users.updated_at
  else:                                 # —— 首次见到该 fflogs 账号
    user_id = register(fflogs_id, fflogs_name, data)   # 见下方 register 流程
  签发 JWT: sub = String(user_id)   ← 关键:不再是 fflogs id
  返回 { access_token, refresh_token, name, user_id }

register 流程（凭据未命中的全新 fflogs 账号，单条事务内完成）:
  INSERT users(name=fflogs_name)        → 取自增 user_id (≥1000001)
  INSERT user_credentials(user_id, 'oauth','fflogs', String(fflogs_id), data=...)
  return user_id
```

- `expires_at = floor(Date.now()/1000) + tokenResponse.expires_in`。
- **写库失败处理：登录（命中分支 UPSERT token/name）或注册（register）任一写库失败，一律返回 HTTP 500、不签发 JWT，由用户重试。** 不保留"仍返回 JWT、token 下次补写"的降级路径——fail-fast，行为统一。
  > 注册失败尤其不能回退用 fflogs id 充当 `sub`——新用户的 fflogs id 可能 ≥ 1e6，既会破坏命名空间隔离（与未来自增 id 碰撞），又会导致其本次以 fflogs id 建立的数据在下次拿到真正自增 id 后"失踪"。

## 6. 数据访问模块（`src/workers/userCredentials.ts`，新建）

把 SQL 收拢在薄模块里，保持 `auth.ts` 干净并便于单测：

- `findCredential(db, provider, identifier)` → `{ id, user_id, type, provider, identifier, data, ... } | null`
- `registerWithOAuth(db, { provider, providerUserId, name, accessToken, refreshToken, expiresAt })` → `{ userId }`
  - register 流程：单条事务内 `INSERT users`（取自增 ≥1000001）+ `INSERT user_credentials`。仅用于凭据未命中的全新账号。
- `loginWithOAuth(db, { provider, providerUserId, name, accessToken, refreshToken, expiresAt })` → `{ userId, isNew }`
  - 编排第 5 节：`findCredential` 命中→UPSERT token/name（`isNew=false`）；未命中→调 `registerWithOAuth`（`isNew=true`）。各自单条事务。
- `getCredential(db, userId, provider)` → 取某用户某来源凭据（供未来代调 API 取 token）。
- `parseOAuthData(row)` / `serializeOAuthData(...)` → `data` JSON 的读写与类型收口（含 `expires_at` 过期判定 helper）。

同目录 `userCredentials.test.ts` 覆盖：登录命中更新、register 新建分配 ≥1000001、UPSERT 覆盖语义、`(provider, identifier)` 唯一约束拒重复、过期判定、JSON 读写。

## 7. JWT / 中间件 / 前端影响

- **`src/workers/jwt.ts`**：`signAccessToken`/`signRefreshToken` 的首参语义由 "fflogs user id" 改为 "my-user-id"（值仍是字符串化整数）；更新 `AccessTokenPayload.sub` 注释。函数签名不变。
- **中间件**：`requireAuth`/`tryReadAuth` 把 `payload.sub` 注入 `auth.userId` 的逻辑**不变**——只要 callback 的 `sub` 改为 my-user-id，下游 timelines CRUD 写入的 `author_id` 自然变为 my-user-id。
- **refresh 流程**：`signAccessToken(result.payload.sub, ...)` 不变。存量用户 `sub`=fflogs id=my-user-id，兼容；新用户 `sub`=自增 id。
- **前端**（`CallbackPage.tsx` / `AuthContext` / `useAuth`）：`setTokens(..., user_id)` 的 `user_id` 取值语义变为 my-user-id；author 比对逻辑**不变**——存量 timeline `author_id`=老用户 my-user-id，相等；新建 timeline `author_id`=my-user-id。无需改判定代码。

> 兼容性：因存量用户 `users.id == fflogs id`，迁移后其**已签发的 access/refresh JWT 仍然有效**，无需强制重登。

## 8. 本期范围与非目标

**范围内**：`users` + `user_credentials` 表与迁移回填；登录流程改造与 token 落库；数据访问模块；JWT/前端 user_id 语义切换；测试。

**非目标（本期不做）**：

- 实际"代用户调 FFLogs API"的调用点（本期只保证 token 可被正确记录、取出）。
- passkey / password 认证的实现（仅在 schema 与 `data` 约定上预留）。
- token 加密、refresh_token 静默续期（fflogs 不下发 refresh_token，过期约 1 年后重新登录）。
- 账号合并 / 一个 user 绑定多个 oauth provider 的 UI 与流程。

## 9. 测试与验证计划

- `userCredentials.test.ts`：见第 6 节。
- `auth` 回归：callback 命中存量凭据→更新 token 且 `sub`=my-user-id；未命中→走 register 分配 ≥1000001；登录或注册任一落库失败→HTTP 500、不签发 JWT。
- 全量门禁：`pnpm test:run`、`pnpm lint`、`pnpm exec tsc --noEmit` 全绿。

## 10. 风险与缓解

| 风险                  | 缓解                                               |
| --------------------- | -------------------------------------------------- |
| D1 故障致登录落库失败 | 登录/注册任一落库失败直接返回 HTTP 500，由用户重试 |
