import { describe, it, expect } from 'vitest'
import { computeEditLock, type EditLockInput } from './editLock'

const base: EditLockInput = {
  sessionRole: 'local',
  connectionStatus: 'connected',
  isReplayMode: false,
  manualLock: false,
}

describe('computeEditLock', () => {
  it('local 角色、无任何原因：全部可编辑', () => {
    const lock = computeEditLock(base)
    expect(lock.can('content')).toBe(true)
    expect(lock.can('metadata')).toBe(true)
    expect(lock.can('exitReplay')).toBe(true)
    expect(lock.reasonOf('content')).toBeNull()
  })

  it('viewer：全部锁定，原因 viewer', () => {
    const lock = computeEditLock({ ...base, sessionRole: 'viewer' })
    expect(lock.can('content')).toBe(false)
    expect(lock.can('metadata')).toBe(false)
    expect(lock.can('exitReplay')).toBe(false)
    expect(lock.reasonOf('metadata')).toBe('viewer')
  })

  it('回放模式：仅锁内容，标题与解除回放不锁', () => {
    const lock = computeEditLock({ ...base, isReplayMode: true })
    expect(lock.can('content')).toBe(false)
    expect(lock.can('metadata')).toBe(true)
    expect(lock.can('exitReplay')).toBe(true)
    expect(lock.reasonOf('content')).toBe('replay')
  })

  it('editor 未连线：全部锁定，原因 offline', () => {
    const lock = computeEditLock({
      ...base,
      sessionRole: 'editor',
      connectionStatus: 'connecting',
    })
    expect(lock.can('content')).toBe(false)
    expect(lock.reasonOf('content')).toBe('offline')
  })

  it('editor 断线（disconnected）：全部锁定，原因 offline', () => {
    const lock = computeEditLock({
      ...base,
      sessionRole: 'editor',
      connectionStatus: 'disconnected',
    })
    expect(lock.can('content')).toBe(false)
    expect(lock.reasonOf('content')).toBe('offline')
  })

  it('editor 连接失败等待重连（failed）：全部锁定，原因 offline', () => {
    const lock = computeEditLock({
      ...base,
      sessionRole: 'editor',
      connectionStatus: 'failed',
    })
    expect(lock.can('content')).toBe(false)
    expect(lock.reasonOf('content')).toBe('offline')
  })

  it('author 未连线：不锁（作者可离线编辑）', () => {
    const lock = computeEditLock({
      ...base,
      sessionRole: 'author',
      connectionStatus: 'disconnected',
    })
    expect(lock.can('content')).toBe(true)
    expect(lock.can('metadata')).toBe(true)
  })

  it('手动锁定：全部锁定，原因 manual', () => {
    const lock = computeEditLock({ ...base, manualLock: true })
    expect(lock.can('content')).toBe(false)
    expect(lock.can('metadata')).toBe(false)
    expect(lock.reasonOf('content')).toBe('manual')
  })

  it('原因叠加：viewer 优先级高于 replay', () => {
    const lock = computeEditLock({
      ...base,
      sessionRole: 'viewer',
      isReplayMode: true,
    })
    expect(lock.reasonOf('content')).toBe('viewer')
  })
})
