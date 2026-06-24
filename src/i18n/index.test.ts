import { describe, it, expect } from 'vitest'
import i18n, { getKonvaFontFamily, NAMESPACES } from './index'

describe('i18n instance', () => {
  it('initializes with zh-CN and resolves a known key', () => {
    expect(i18n.t('home:help')).toBe('帮助')
  })
  it('interpolates ICU/i18next placeholders', () => {
    expect(i18n.t('common:operationFailed', { message: 'X' })).toBe('操作失败：X')
  })
  it('registers all five namespaces', () => {
    expect(NAMESPACES).toEqual(['common', 'home', 'editor', 'import', 'share'])
  })
})

describe('getKonvaFontFamily', () => {
  it('returns a CJK stack for zh and ja, latin for others', () => {
    expect(getKonvaFontFamily('zh-CN')).toContain('PingFang SC')
    expect(getKonvaFontFamily('zh-TW')).toContain('PingFang TC')
    expect(getKonvaFontFamily('ja')).toContain('Hiragino')
    expect(getKonvaFontFamily('en')).toBe('Arial, sans-serif')
  })
})
