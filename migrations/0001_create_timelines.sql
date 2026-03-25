CREATE TABLE timelines (
  id           TEXT    PRIMARY KEY,       -- nanoid 21 chars
  name         TEXT    NOT NULL,
  author_id    TEXT    NOT NULL,
  author_name  TEXT    NOT NULL,
  published_at INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  version      INTEGER NOT NULL DEFAULT 1,
  content      TEXT    NOT NULL           -- JSON blob，存储 encounter/damageEvents 等
);
