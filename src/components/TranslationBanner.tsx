/**
 * 非源语言下的本地化征集窄条 + 进度模态框。
 *
 * 译文来自 Crowdin，源语言（zh-CN）用户无需看到；进度取自 progress.json
 * 快照（由 scripts/fetch-i18n-progress.mjs 在译文回流时更新）。
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Languages, ExternalLink } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useUIStore } from '@/store/uiStore'
import { DEFAULT_LOCALE } from '@/types/i18n'
import progress from '@/i18n/progress.json'

const CROWDIN_PROJECT_URL = 'https://crowdin.com/project/healerbook'

const PROGRESS = progress as Record<string, { translated: number; approved: number }>

/** 进度条：Crowdin 的百分比是整数 */
function ProgressRow({ label, percent }: { label: string; percent: number }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums font-medium">{percent}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}

export default function TranslationBanner() {
  const { t } = useTranslation(['home', 'common'])
  const locale = useUIStore(s => s.locale)
  const [open, setOpen] = useState(false)

  // 源语言无需征集；未登记进度的语言（catalog 尚未纳入 Crowdin）也不展示
  if (locale === DEFAULT_LOCALE) return null
  const stat = PROGRESS[locale]
  if (!stat) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-1.5 border-b border-blue-300 bg-blue-50 px-4 py-1 text-xs text-blue-800 transition-colors hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300 dark:hover:bg-blue-900"
      >
        <Languages className="h-3.5 w-3.5 shrink-0" />
        <span>{t('home:translationBanner.cta')}</span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('home:translationBanner.title')}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <ProgressRow label={t('home:translationBanner.translated')} percent={stat.translated} />
            <ProgressRow label={t('home:translationBanner.approved')} percent={stat.approved} />
          </div>

          <p className="text-sm leading-relaxed text-muted-foreground">
            {t('home:translationBanner.description')}
          </p>

          <a
            href={CROWDIN_PROJECT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t('home:translationBanner.goToCrowdin')}
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </DialogContent>
      </Dialog>
    </>
  )
}
