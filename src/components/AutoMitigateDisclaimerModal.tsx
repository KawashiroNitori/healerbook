import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

/**
 * 自动减伤免责声明：点击「自动减伤」后先弹此 modal，用户须手动输入指定短语方可确认，
 * 确认后才真正发起优化。
 */
export function AutoMitigateDisclaimerModal({ open, onOpenChange, onConfirm }: Props) {
  const { t } = useTranslation(['editor', 'common'])
  const [text, setText] = useState('')
  // 短语随语言走：写死中文会让非中文用户无法输入，等于卡死这道确认门
  const confirmPhrase = t('editor:autoMitigateDisclaimer.confirmPhrase')
  const matched = text.trim() === confirmPhrase

  const handleOpenChange = (next: boolean) => {
    if (!next) setText('') // 关闭时清空，下次重新输入
    onOpenChange(next)
  }

  const handleConfirm = () => {
    if (!matched) return
    setText('')
    onConfirm()
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('editor:autoMitigateDisclaimer.title')}</DialogTitle>
          <DialogDescription className="leading-relaxed">
            {t('editor:autoMitigateDisclaimer.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            {t('editor:autoMitigateDisclaimer.promptPrefix')}
            <span className="font-medium text-foreground">{confirmPhrase}</span>
            {t('editor:autoMitigateDisclaimer.promptSuffix')}
          </p>
          <Input
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={confirmPhrase}
            autoFocus
            onKeyDown={e => {
              if (e.key === 'Enter') handleConfirm()
            }}
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => handleOpenChange(false)}>
            {t('common:cancel')}
          </Button>
          <Button size="sm" disabled={!matched} onClick={handleConfirm}>
            {t('common:confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
