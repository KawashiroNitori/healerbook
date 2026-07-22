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
