import { describe, it, expect } from 'vitest'
import { deriveShareView, deriveShareTrigger, type ShareViewInput } from './shareView'

const base: ShareViewInput = {
  isPublished: true,
  isLoggedIn: true,
  role: 'viewer',
  isAuthor: false,
  allowEditRequests: false,
  hasPendingRequest: false,
  isRevoked: false,
}

describe('deriveShareView', () => {
  it('未发布 → publish', () => {
    expect(deriveShareView({ ...base, isPublished: false }).kind).toBe('publish')
  })
  it('作者 → author', () => {
    expect(deriveShareView({ ...base, isAuthor: true }).kind).toBe('author')
  })
  it('编辑者(非作者) → editor', () => {
    expect(deriveShareView({ ...base, role: 'editor' }).kind).toBe('editor')
  })
  it('viewer 未登录 → viewer-anon', () => {
    expect(deriveShareView({ ...base, isLoggedIn: false }).kind).toBe('viewer-anon')
  })
  it('viewer 已登录 + 开关关 → viewer-no-request', () => {
    expect(deriveShareView({ ...base, allowEditRequests: false }).kind).toBe('viewer-no-request')
  })
  it('viewer 已登录 + 开关开 + 未申请 → viewer-can-request', () => {
    expect(deriveShareView({ ...base, allowEditRequests: true }).kind).toBe('viewer-can-request')
  })
  it('viewer 已登录 + 开关开 + 已申请 → viewer-requested', () => {
    expect(
      deriveShareView({ ...base, allowEditRequests: true, hasPendingRequest: true }).kind
    ).toBe('viewer-requested')
  })
  it('被撤销:即使 role=editor 也按 viewer 处理', () => {
    expect(deriveShareView({ ...base, role: 'editor', isRevoked: true }).kind).toBe(
      'viewer-no-request'
    )
  })
  it('被撤销:即使 isAuthor 也按 viewer 处理', () => {
    expect(deriveShareView({ ...base, isAuthor: true, isRevoked: true }).kind).not.toBe('author')
  })
})

describe('deriveShareTrigger', () => {
  it('未发布 → publish', () => {
    expect(deriveShareTrigger({ ...base, isPublished: false })).toBe('publish')
  })
  it('作者 → author', () => {
    expect(deriveShareTrigger({ ...base, isAuthor: true })).toBe('author')
  })
  it('编辑者 → editor', () => {
    expect(deriveShareTrigger({ ...base, role: 'editor' })).toBe('editor')
  })
  it('viewer → viewer', () => {
    expect(deriveShareTrigger(base)).toBe('viewer')
  })
  it('被撤销的编辑者 → viewer', () => {
    expect(deriveShareTrigger({ ...base, role: 'editor', isRevoked: true })).toBe('viewer')
  })
})
