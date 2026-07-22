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

  // 仅 zh-CN catalog 是完整的，其余语言待 Crowdin 回流后再放出：
  // 生产构建里切到未译语言只会看到大面积 key 回退，故非开发模式下不渲染入口。
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
