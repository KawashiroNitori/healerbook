import { describe, it, expect } from 'vitest'
import { decideOpen } from './editorOpenDecision'

describe('decideOpen', () => {
  it('本地时间轴：直接本地打开，不查服务端', () => {
    expect(decideOpen('local', null)).toEqual({ kind: 'local' })
  })

  it('服务端确认是作者：author', () => {
    expect(decideOpen('published', { type: 'ok', isAuthor: true, role: 'editor' })).toEqual({
      kind: 'author',
    })
  })

  it('服务端确认是协作编辑者：editor', () => {
    expect(decideOpen('visited', { type: 'ok', isAuthor: false, role: 'editor' })).toEqual({
      kind: 'editor',
    })
  })

  it('服务端返回 viewer 角色：viewer', () => {
    expect(decideOpen('visited', { type: 'ok', isAuthor: false, role: 'viewer' })).toEqual({
      kind: 'viewer',
    })
  })

  it('我发布的时间轴被取消发布（404）：回退本地', () => {
    expect(decideOpen('published', { type: 'notfound' })).toEqual({ kind: 'rekey-local' })
  })

  it('访问过的时间轴被作者删除（404）：not-found', () => {
    expect(decideOpen('visited', { type: 'notfound' })).toEqual({ kind: 'not-found' })
  })

  it('首次链接进入、404：not-found', () => {
    expect(decideOpen(null, { type: 'notfound' })).toEqual({ kind: 'not-found' })
  })

  it('我发布的、网络错误：作者可离线编辑', () => {
    expect(decideOpen('published', { type: 'neterror', hasLocalDoc: true })).toEqual({
      kind: 'author',
    })
  })

  it('访问过的、网络错误、有本地缓存：以 editor 离线打开（offline cause 兜底只读）', () => {
    expect(decideOpen('visited', { type: 'neterror', hasLocalDoc: true })).toEqual({
      kind: 'editor',
    })
  })

  it('访问过的、网络错误、无本地缓存：network-error', () => {
    expect(decideOpen('visited', { type: 'neterror', hasLocalDoc: false })).toEqual({
      kind: 'network-error',
    })
  })

  it('首次链接进入、网络错误：network-error', () => {
    expect(decideOpen(null, { type: 'neterror', hasLocalDoc: false })).toEqual({
      kind: 'network-error',
    })
  })
})
