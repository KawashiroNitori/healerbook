/// <reference types="@cloudflare/workers-types" />

/**
 * timeline_editors / timeline_edit_requests 数据访问层。
 *
 * 参数收窄为 D1Database：Hono 路由传 c.env.healerbook_timelines，
 * Durable Object 传 this.env.healerbook_timelines，两侧零差异。
 * 需要参与 db.batch() 事务的写操作提供 xxxStatement 变体
 * （approve 场景「删申请 + 加编辑者」必须原子），由调用方决定 run 或 batch。
 */

export async function isEditor(
  db: D1Database,
  timelineId: string,
  userId: string
): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 FROM timeline_editors WHERE timeline_id = ? AND user_id = ?')
    .bind(timelineId, userId)
    .first()
  return row != null
}

export async function listEditors(
  db: D1Database,
  timelineId: string,
  excludeUserId?: string
): Promise<{ userId: string; userName: string }[]> {
  const result = excludeUserId
    ? await db
        .prepare(
          'SELECT user_id, user_name FROM timeline_editors WHERE timeline_id = ? AND user_id != ? ORDER BY created_at'
        )
        .bind(timelineId, excludeUserId)
        .all<{ user_id: string; user_name: string }>()
    : await db
        .prepare(
          'SELECT user_id, user_name FROM timeline_editors WHERE timeline_id = ? ORDER BY created_at'
        )
        .bind(timelineId)
        .all<{ user_id: string; user_name: string }>()
  return result.results.map(r => ({ userId: r.user_id, userName: r.user_name }))
}

/** userName 缺省写空串（发布/迁移场景，吃列 DEFAULT '' 的旧语义）；approve 场景显式传真实名 */
export function insertEditorStatement(
  db: D1Database,
  timelineId: string,
  userId: string,
  userName = ''
): D1PreparedStatement {
  return db
    .prepare(
      'INSERT OR IGNORE INTO timeline_editors (timeline_id, user_id, user_name, created_at) VALUES (?,?,?,?)'
    )
    .bind(timelineId, userId, userName, Date.now())
}

export async function deleteAllEditors(db: D1Database, timelineId: string): Promise<void> {
  await db.prepare('DELETE FROM timeline_editors WHERE timeline_id = ?').bind(timelineId).run()
}

export async function removeEditor(
  db: D1Database,
  timelineId: string,
  userId: string
): Promise<void> {
  await db
    .prepare('DELETE FROM timeline_editors WHERE timeline_id = ? AND user_id = ?')
    .bind(timelineId, userId)
    .run()
}

export async function hasPendingEditRequest(
  db: D1Database,
  timelineId: string,
  userId: string
): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 FROM timeline_edit_requests WHERE timeline_id = ? AND user_id = ?')
    .bind(timelineId, userId)
    .first()
  return row != null
}

export async function countPendingEditRequests(
  db: D1Database,
  timelineId: string
): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM timeline_edit_requests WHERE timeline_id = ?')
    .bind(timelineId)
    .first<{ n: number }>()
  return row?.n ?? 0
}

export async function listEditRequests(
  db: D1Database,
  timelineId: string
): Promise<{ userId: string; userName: string; createdAt: number }[]> {
  const result = await db
    .prepare(
      'SELECT user_id, user_name, created_at FROM timeline_edit_requests WHERE timeline_id = ? ORDER BY created_at'
    )
    .bind(timelineId)
    .all<{ user_id: string; user_name: string; created_at: number }>()
  return result.results.map(r => ({
    userId: r.user_id,
    userName: r.user_name,
    createdAt: r.created_at,
  }))
}

export async function findEditRequest(
  db: D1Database,
  timelineId: string,
  userId: string
): Promise<{ userName: string } | null> {
  const row = await db
    .prepare('SELECT user_name FROM timeline_edit_requests WHERE timeline_id = ? AND user_id = ?')
    .bind(timelineId, userId)
    .first<{ user_name: string }>()
  return row ? { userName: row.user_name } : null
}

export function insertEditRequestStatement(
  db: D1Database,
  timelineId: string,
  userId: string,
  userName: string
): D1PreparedStatement {
  return db
    .prepare(
      'INSERT OR IGNORE INTO timeline_edit_requests (timeline_id, user_id, user_name, created_at) VALUES (?,?,?,?)'
    )
    .bind(timelineId, userId, userName, Date.now())
}

export function deleteEditRequestStatement(
  db: D1Database,
  timelineId: string,
  userId: string
): D1PreparedStatement {
  return db
    .prepare('DELETE FROM timeline_edit_requests WHERE timeline_id = ? AND user_id = ?')
    .bind(timelineId, userId)
}

export async function deleteAllEditRequests(db: D1Database, timelineId: string): Promise<void> {
  await db
    .prepare('DELETE FROM timeline_edit_requests WHERE timeline_id = ?')
    .bind(timelineId)
    .run()
}
