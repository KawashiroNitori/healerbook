import { describe, it, expect } from 'vitest'
import { parseApiError } from './parseApiError'

describe('parseApiError', () => {
  it('优先返回 body.error 字符串', () => {
    expect(parseApiError({ error: 'oops' }, 400)).toBe('oops')
  })

  it('body.issues 存在时格式化为 path: msg 串', () => {
    const body = {
      success: false,
      issues: [
        { path: [{ key: 'timeline' }, { key: 'n' }], message: 'Invalid type' },
        { path: [{ key: 'timeline' }, { key: 'e' }], message: 'Required' },
      ],
    }
    expect(parseApiError(body, 400)).toBe('timeline.n: Invalid type; timeline.e: Required')
  })

  it('issues 没有 path 时只输出 message', () => {
    const body = { issues: [{ message: 'bad' }] }
    expect(parseApiError(body, 400)).toBe('bad')
  })

  it('issues 超过 3 条只取前 3 条', () => {
    const body = {
      issues: [{ message: 'a' }, { message: 'b' }, { message: 'c' }, { message: 'd' }],
    }
    expect(parseApiError(body, 400)).toBe('a; b; c')
  })

  it('body 为 null 时回退到 HTTP <status>', () => {
    expect(parseApiError(null, 500)).toBe('HTTP 500')
  })

  it('body 无 error 也无 issues 时回退到 HTTP <status>', () => {
    expect(parseApiError({ foo: 1 }, 503)).toBe('HTTP 503')
  })
})
