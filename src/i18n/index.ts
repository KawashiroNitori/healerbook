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
    interpolation: { escapeValue: false },
    resources: {
      'zh-CN': { common, home, editor, import: importNs, share },
    },
  })

export default i18n
