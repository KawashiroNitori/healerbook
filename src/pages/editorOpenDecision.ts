/**
 * EditorPage 打开时间轴的对账决策纯函数（设计文档 §5）。
 * 输入：本地 meta 的 kind（null = 无 meta）、服务端结果；输出：打开动作。
 */

export type MetaKind = 'local' | 'published' | 'visited'

export type ServerOutcome =
  | { type: 'ok'; isAuthor: boolean; role: 'editor' | 'viewer' }
  | { type: 'notfound' }
  | { type: 'neterror'; hasLocalDoc: boolean }

export type OpenDecision =
  | { kind: 'local' } // openTimeline role=local
  | { kind: 'author' } // openTimeline role=author
  | { kind: 'editor' } // openTimeline role=editor
  | { kind: 'viewer' } // setViewerSnapshot
  | { kind: 'rekey-local' } // 我发布的被取消发布 → 换 id 转本地
  | { kind: 'not-found' }
  | { kind: 'network-error' }

/**
 * @param metaKind 本地 meta 的 kind；null 表示本地无 meta（首次经链接进入）
 * @param server   服务端结果；metaKind==='local' 时传 null（不查服务端）
 */
export function decideOpen(metaKind: MetaKind | null, server: ServerOutcome | null): OpenDecision {
  if (metaKind === 'local') return { kind: 'local' }
  if (!server) return { kind: 'network-error' }

  if (server.type === 'ok') {
    if (server.isAuthor) return { kind: 'author' }
    return server.role === 'editor' ? { kind: 'editor' } : { kind: 'viewer' }
  }

  if (server.type === 'notfound') {
    return metaKind === 'published' ? { kind: 'rekey-local' } : { kind: 'not-found' }
  }

  // neterror
  if (metaKind === 'published') return { kind: 'author' }
  if (metaKind === 'visited') {
    return server.hasLocalDoc ? { kind: 'editor' } : { kind: 'network-error' }
  }
  return { kind: 'network-error' }
}
