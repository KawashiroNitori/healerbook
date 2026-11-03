import { describe, expect, it } from 'vitest'
import { linkify } from './linkify'

describe('linkify', () => {
  it('纯文本返回单个文本段', () => {
    expect(linkify('没有链接')).toEqual([{ type: 'text', text: '没有链接' }])
  })

  it('空字符串返回空数组', () => {
    expect(linkify('')).toEqual([])
  })

  it('识别文本中的 http(s) 链接', () => {
    expect(linkify('参考 https://www.fflogs.com/reports/abc?fight=3 的打法')).toEqual([
      { type: 'text', text: '参考 ' },
      { type: 'link', text: 'https://www.fflogs.com/reports/abc?fight=3' },
      { type: 'text', text: ' 的打法' },
    ])
  })

  it('识别多个链接与换行', () => {
    expect(linkify('a http://a.com\nhttps://b.com/x')).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'link', text: 'http://a.com' },
      { type: 'text', text: '\n' },
      { type: 'link', text: 'https://b.com/x' },
    ])
  })

  it('全角标点终止链接', () => {
    expect(linkify('见https://a.com/x。下一句')).toEqual([
      { type: 'text', text: '见' },
      { type: 'link', text: 'https://a.com/x' },
      { type: 'text', text: '。下一句' },
    ])
  })

  it('去掉末尾半角标点', () => {
    expect(linkify('see https://a.com/x.')).toEqual([
      { type: 'text', text: 'see ' },
      { type: 'link', text: 'https://a.com/x' },
      { type: 'text', text: '.' },
    ])
  })

  it('未配对的右括号不计入链接，配对的保留', () => {
    expect(linkify('(https://a.com/x)')).toEqual([
      { type: 'text', text: '(' },
      { type: 'link', text: 'https://a.com/x' },
      { type: 'text', text: ')' },
    ])
    expect(linkify('https://en.wikipedia.org/wiki/A_(b)')).toEqual([
      { type: 'link', text: 'https://en.wikipedia.org/wiki/A_(b)' },
    ])
  })

  it('不识别非 http(s) 协议与孤立协议头', () => {
    expect(linkify('javascript:alert(1) https://')).toEqual([
      { type: 'text', text: 'javascript:alert(1) https://' },
    ])
  })
})
