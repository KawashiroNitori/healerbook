import { Languages } from 'lucide-react'
import { useUIStore } from '@/store/uiStore'
import { SUPPORTED_LOCALES, LOCALE_LABELS, type AppLanguage } from '@/types/i18n'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu'

export default function LanguageToggle() {
  const locale = useUIStore(s => s.locale)
  const setLocale = useUIStore(s => s.setLocale)

  // 五种语言的译文已全部就位，但审校率仍为 0：这批是 AI 预翻译，尚未经人工校对，
  // 故暂不对生产用户放出主动切换入口（浏览器语言命中时仍会自动使用对应译文，
  // 并由 TranslationBanner 征集校对）。待 Crowdin 上校对完成后再开放。
  // 放在 hooks 之后以满足 rules-of-hooks；生产构建常量折叠为 false 后整段返回 null。
  if (!import.meta.env.DEV) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Language">
          <Languages className="w-5 h-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={locale} onValueChange={v => setLocale(v as AppLanguage)}>
          {SUPPORTED_LOCALES.map(l => (
            <DropdownMenuRadioItem key={l} value={l}>
              {LOCALE_LABELS[l]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
