-- 用户主体 + 通用凭据表(本期 oauth/fflogs;预留 passkey/password)
-- 详见 design/superpowers/specs/2026-05-29-user-credentials-design.md

CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,  -- 存量复用 fflogs id(<1e6);新用户 ≥1000001
  name       TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_credentials (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  type       TEXT    NOT NULL,                    -- 'oauth' | 'passkey' | 'password'
  provider   TEXT    NOT NULL,                    -- 稳定来源键: 'fflogs' | ...
  identifier TEXT    NOT NULL,                    -- oauth: fflogs id
  data       TEXT    NOT NULL,                    -- JSON: { access_token, refresh_token, expires_at }
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CONSTRAINT json_check_data CHECK (json_valid(data))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_credentials_provider_identifier
  ON user_credentials (provider, identifier);
CREATE INDEX IF NOT EXISTS idx_user_credentials_user ON user_credentials (user_id);

-- seed 自增起点:新用户从 1000001 起。必须在回填之前执行——
-- 此时 sqlite_sequence 尚无 'users' 行,可直接 INSERT;之后回填的显式 id 均 < 1e6,
-- 不会下调 seq(SQLite 取 max(seq, rowid))。
INSERT OR IGNORE INTO sqlite_sequence (name, seq) VALUES ('users', 1000000);

-- 回填存量用户:汇总 timelines/editors/edit_requests 的 distinct id(取任一非空 name)
INSERT OR IGNORE INTO users (id, name, created_at, updated_at)
SELECT id, COALESCE(MIN(name), ''), unixepoch(), unixepoch() FROM (
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
