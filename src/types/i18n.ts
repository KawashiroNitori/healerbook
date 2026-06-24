/** 应用支持的界面语言。zh-CN 为源语言。前端与 Worker 共用。 */
export type AppLanguage = 'zh-CN' | 'zh-TW' | 'ja' | 'en' | 'de' | 'fr'

export const SUPPORTED_LOCALES: readonly AppLanguage[] = ['zh-CN', 'zh-TW', 'ja', 'en', 'de', 'fr']

export const DEFAULT_LOCALE: AppLanguage = 'zh-CN'

/** 语言切换器显示名（用各自语言的自称） */
export const LOCALE_LABELS: Record<AppLanguage, string> = {
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  ja: '日本語',
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
}

export function isAppLanguage(value: unknown): value is AppLanguage {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value)
}

/**
 * 把任意 BCP-47 标签 / 存储值归一为受支持的 AppLanguage。
 * 未识别一律回退 DEFAULT_LOCALE。
 */
export function normalizeLocale(raw: string | null | undefined): AppLanguage {
  if (!raw) return DEFAULT_LOCALE
  const lower = raw.toLowerCase()
  if (lower.startsWith('zh')) {
    if (
      lower.includes('tw') ||
      lower.includes('hk') ||
      lower.includes('mo') ||
      lower.includes('hant')
    ) {
      return 'zh-TW'
    }
    return 'zh-CN'
  }
  if (lower.startsWith('ja')) return 'ja'
  if (lower.startsWith('en')) return 'en'
  if (lower.startsWith('de')) return 'de'
  if (lower.startsWith('fr')) return 'fr'
  return DEFAULT_LOCALE
}
