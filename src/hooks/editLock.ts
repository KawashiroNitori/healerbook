/**
 * 只读能力集模型（设计文档 §4）。
 *
 * 把「能编辑什么」拆成能力（capability），「为什么不能编辑」拆成原因（cause）。
 * 每个原因声明它撤销哪些能力；生效锁 = 所有激活原因撤销能力的并集。
 * 本文件是纯逻辑，不依赖任何 store，便于单测；hook 封装见 useEditLock.ts。
 */

/** 全部可编辑操作；新增可编辑面在此追加一项 */
export type EditCapability = 'content' | 'metadata' | 'exitReplay'

export type EditLockCauseId = 'viewer' | 'offline' | 'replay' | 'manual'

interface CauseSpec {
  id: EditLockCauseId
  /** 原因优先级（reasonOf 排序用）；数字越大越优先 */
  priority: number
  /** 'all' = 冻结全部能力；或显式列出冻结的能力 */
  revokes: 'all' | EditCapability[]
}

const CAUSES: CauseSpec[] = [
  { id: 'viewer', priority: 4, revokes: 'all' },
  { id: 'offline', priority: 3, revokes: 'all' },
  { id: 'replay', priority: 2, revokes: ['content'] },
  { id: 'manual', priority: 1, revokes: 'all' },
]

export interface EditLockInput {
  sessionRole: 'local' | 'author' | 'editor' | 'viewer'
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'failed'
  isReplayMode: boolean
  manualLock: boolean
}

export interface EditLock {
  /** 该能力当前是否可用 */
  can: (cap: EditCapability) => boolean
  /** 该能力被锁的主因（按 priority）；可用时为 null */
  reasonOf: (cap: EditCapability) => EditLockCauseId | null
}

function isCauseActive(id: EditLockCauseId, input: EditLockInput): boolean {
  switch (id) {
    case 'viewer':
      return input.sessionRole === 'viewer'
    case 'offline':
      return input.sessionRole === 'editor' && input.connectionStatus !== 'connected'
    case 'replay':
      return input.isReplayMode
    case 'manual':
      return input.manualLock
  }
}

export function computeEditLock(input: EditLockInput): EditLock {
  const active = CAUSES.filter(c => isCauseActive(c.id, input))
  const revokers = (cap: EditCapability) =>
    active.filter(c => c.revokes === 'all' || c.revokes.includes(cap))
  return {
    can: cap => revokers(cap).length === 0,
    reasonOf: cap => {
      const rs = revokers(cap)
      if (rs.length === 0) return null
      return rs.reduce((a, b) => (b.priority > a.priority ? b : a)).id
    },
  }
}
