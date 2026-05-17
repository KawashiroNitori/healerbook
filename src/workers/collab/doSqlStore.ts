/// <reference types="@cloudflare/workers-types" />
import { mergeUpdates } from 'yjs'

/** BLOB 列读出来是 ArrayBuffer；统一转 Uint8Array */
function toU8(v: ArrayBuffer | Uint8Array): Uint8Array {
  return v instanceof Uint8Array ? v : new Uint8Array(v)
}

/**
 * DO 内 SQLite 双表:
 *   snapshot(id=1, bin, updated_at)  —— 全量 checkpoint
 *   updates(seq AUTOINCREMENT, bin, created_at) —— 增量日志
 */
export class DoSqlStore {
  private readonly sql: SqlStorage

  constructor(sql: SqlStorage) {
    this.sql = sql
  }

  init(): void {
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS snapshot (id INTEGER PRIMARY KEY, bin BLOB, updated_at INTEGER)'
    )
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, bin BLOB, created_at INTEGER)'
    )
  }

  appendUpdate(bin: Uint8Array): void {
    this.sql.exec('INSERT INTO updates (bin, created_at) VALUES (?, ?)', bin, Date.now())
  }

  countUpdates(): number {
    const row = this.sql.exec('SELECT COUNT(*) AS n FROM updates').one()
    return Number(row.n)
  }

  /** snapshot + 所有 updates（按 seq 升序）合并 */
  getMergedDoc(): Uint8Array {
    const parts: Uint8Array[] = []
    const snap = this.sql.exec('SELECT bin FROM snapshot WHERE id = 1').toArray()
    if (snap.length > 0) parts.push(toU8(snap[0].bin as ArrayBuffer))
    for (const row of this.sql.exec('SELECT bin FROM updates ORDER BY seq').toArray()) {
      parts.push(toU8(row.bin as ArrayBuffer))
    }
    return mergeUpdates(parts)
  }

  /** 是否已有任何数据(snapshot 或 updates) */
  isEmpty(): boolean {
    const row = this.sql
      .exec('SELECT (SELECT COUNT(*) FROM snapshot) + (SELECT COUNT(*) FROM updates) AS n')
      .one()
    return Number(row.n) === 0
  }

  /** 合并出新 snapshot、清空 updates */
  squash(): void {
    const merged = this.getMergedDoc()
    this.sql.exec(
      'INSERT INTO snapshot (id, bin, updated_at) VALUES (1, ?, ?) ' +
        'ON CONFLICT(id) DO UPDATE SET bin = excluded.bin, updated_at = excluded.updated_at',
      merged,
      Date.now()
    )
    this.sql.exec('DELETE FROM updates')
  }

  /** 清空全部数据（snapshot + updates）；取消发布时调用 */
  clear(): void {
    this.sql.exec('DELETE FROM snapshot')
    this.sql.exec('DELETE FROM updates')
  }

  /** 直接写入一个全量 snapshot（迁移 seed 用），要求当前为空 */
  seedSnapshot(bin: Uint8Array): void {
    this.sql.exec(
      'INSERT INTO snapshot (id, bin, updated_at) VALUES (1, ?, ?) ' + 'ON CONFLICT(id) DO NOTHING',
      bin,
      Date.now()
    )
  }
}
