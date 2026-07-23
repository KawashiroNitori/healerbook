import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import ICU from 'i18next-icu'
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  isAppLanguage,
  normalizeLocale,
  type AppLanguage,
} from '@/types/i18n'

import common from './locales/zh-CN/common.json'
import home from './locales/zh-CN/home.json'
import editor from './locales/zh-CN/editor.json'
import importNs from './locales/zh-CN/import.json'
import share from './locales/zh-CN/share.json'

export const NAMESPACES = ['common', 'home', 'editor', 'import', 'share'] as const

/**
 * 非默认语言的 catalog 按需加载：zh-CN 静态内置保证首屏可用，其余语言
 * （各约 32KB × 5 ns）留在独立 chunk 里，避免把全部语料压进主 bundle。
 * 实际请求哪些语言由 ensureLocaleLoaded 的 AppLanguage 入参决定。
 */
const lazyCatalogs = import.meta.glob<{ default: Record<string, unknown> }>([
  './locales/*/*.json',
  '!./locales/zh-CN/*.json',
])

/** 把目标语言的 5 个 namespace 注入 i18next；已加载或为默认语言时直接返回 */
export async function ensureLocaleLoaded(locale: AppLanguage): Promise<void> {
  if (locale === DEFAULT_LOCALE) return
  if (NAMESPACES.every(ns => i18n.hasResourceBundle(locale, ns))) return

  await Promise.all(
    NAMESPACES.map(async ns => {
      const load = lazyCatalogs[`./locales/${locale}/${ns}.json`]
      if (!load) return
      const mod = await load()
      i18n.addResourceBundle(locale, ns, mod.default, true, true)
    })
  )
}

/** localStorage('locale') → navigator.language → DEFAULT_LOCALE */
export function getInitialLocale(): AppLanguage {
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem('locale')
    if (isAppLanguage(stored)) return stored
  }
  if (typeof navigator !== 'undefined' && navigator.language) {
    return normalizeLocale(navigator.language)
  }
  return DEFAULT_LOCALE
}

const CJK_SC =
  '"PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", "Noto Sans CJK SC", sans-serif'
const CJK_TC = '"PingFang TC", "Microsoft JhengHei", "Noto Sans CJK TC", sans-serif'
const JP = '"Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, "Noto Sans CJK JP", sans-serif'
const LATIN = 'Arial, sans-serif'

/** Konva <Text> 不走 DOM，需按 locale 显式选字体栈（系统字体，不自托管） */
export function getKonvaFontFamily(locale: AppLanguage): string {
  switch (locale) {
    case 'zh-CN':
      return CJK_SC
    case 'zh-TW':
      return CJK_TC
    case 'ja':
      return JP
    default:
      return LATIN
  }
}

void i18n
  .use(ICU)
  .use(initReactI18next)
  .init({
    lng: getInitialLocale(),
    fallbackLng: DEFAULT_LOCALE,
    supportedLngs: SUPPORTED_LOCALES as unknown as string[],
    ns: NAMESPACES as unknown as string[],
    defaultNS: 'common',
    returnNull: false,
    // Crowdin 项目设了 skipUntranslatedStrings=true：未翻译的 key 以空串导出。
    // 关掉 returnEmptyString，让空串走 fallbackLng 回退到 zh-CN，而非渲染成空白。
    returnEmptyString: false,
    interpolation: { escapeValue: false },
    // 懒加载的 catalog 经 addResourceBundle 注入，需监听 store 事件才会重渲染
    react: { bindI18nStore: 'added' },
    resources: {
      'zh-CN': { common, home, editor, import: importNs, share },
    },
  })

// 首屏语言若非 zh-CN，init 时其 catalog 尚未就绪（先回退中文），此处异步补齐
void ensureLocaleLoaded(getInitialLocale())

export default i18n
