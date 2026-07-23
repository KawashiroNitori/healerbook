import { describe, it, expect, beforeAll } from 'vitest'
import i18n, { getKonvaFontFamily, NAMESPACES, ensureLocaleLoaded } from './index'

describe('i18n instance', () => {
  // 初始语言取自 navigator.language（node 下为 en-US → en），故显式切到源语言再断言
  beforeAll(async () => {
    await i18n.changeLanguage('zh-CN')
  })

  it('resolves a known key in the source locale', () => {
    expect(i18n.t('home:help')).toBe('帮助')
  })
  it('interpolates ICU/i18next placeholders', () => {
    expect(i18n.t('common:operationFailed', { message: 'X' })).toBe('操作失败：X')
  })
  it('lazily loads a non-default locale bundle', async () => {
    expect(i18n.hasResourceBundle('ja', 'home')).toBe(false)
    await ensureLocaleLoaded('ja')
    expect(i18n.hasResourceBundle('ja', 'home')).toBe(true)
    expect(i18n.getResource('ja', 'home', 'help')).toBeTruthy()
  })
  it('registers all five namespaces', () => {
    expect(NAMESPACES).toEqual(['common', 'home', 'editor', 'import', 'share'])
  })

  // Crowdin skipUntranslatedStrings=true 会把未翻译的 key 导出为空串；
  // returnEmptyString=false 必须让空串回退到 zh-CN，而非渲染成空白
  it('empty-string translation falls back to source instead of rendering blank', async () => {
    i18n.addResourceBundle(
      'en',
      'home',
      { help: '', notFound: { message: 'Not found' } },
      true,
      true
    )
    await i18n.changeLanguage('en')
    expect(i18n.t('home:help')).toBe('帮助') // 空串 → 回退 zh-CN
    expect(i18n.t('home:notFound.message')).toBe('Not found') // 真实译文保留
    await i18n.changeLanguage('zh-CN')
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
