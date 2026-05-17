/**
 * 共享 popover 的呈现态推导(纯函数,与 React 解耦)。
 * 7 个 popover 态见 design/superpowers/specs/2026-05-18-timeline-share-permissions-design.md。
 */

export type ShareView =
  | { kind: 'publish' } // 态1:本地未发布
  | { kind: 'viewer-anon' } // 态2a:未登录
  | { kind: 'viewer-no-request' } // 态2b:已登录无权限,开关关
  | { kind: 'viewer-can-request' } // 态3:可申请,未申请
  | { kind: 'viewer-requested' } // 态4:已申请
  | { kind: 'editor' } // 态5:编辑者(非作者)
  | { kind: 'author' } // 态6:作者

/** 触发按钮样式 */
export type ShareTrigger = 'publish' | 'author' | 'editor' | 'viewer'

export interface ShareViewInput {
  /** 是否已发布到云端(false 即本地草稿) */
  isPublished: boolean
  isLoggedIn: boolean
  role: 'editor' | 'viewer'
  isAuthor: boolean
  allowEditRequests: boolean
  hasPendingRequest: boolean
  /** 会话中被撤销编辑权限:UI 上等同 viewer */
  isRevoked: boolean
}

export function deriveShareView(input: ShareViewInput): ShareView {
  if (!input.isPublished) return { kind: 'publish' }
  const role = input.isRevoked ? 'viewer' : input.role
  const isAuthor = input.isRevoked ? false : input.isAuthor
  if (isAuthor) return { kind: 'author' }
  if (role === 'editor') return { kind: 'editor' }
  if (!input.isLoggedIn) return { kind: 'viewer-anon' }
  if (!input.allowEditRequests) return { kind: 'viewer-no-request' }
  return input.hasPendingRequest ? { kind: 'viewer-requested' } : { kind: 'viewer-can-request' }
}

export function deriveShareTrigger(input: ShareViewInput): ShareTrigger {
  if (!input.isPublished) return 'publish'
  if (input.isRevoked) return 'viewer'
  if (input.isAuthor) return 'author'
  if (input.role === 'editor') return 'editor'
  return 'viewer'
}
