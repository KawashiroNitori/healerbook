import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface AboutDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function AboutDialog({ open, onOpenChange }: AboutDialogProps) {
  const { t } = useTranslation(['home', 'common'])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('home:aboutDialog.title')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <p>
            <span className="text-muted-foreground">{t('home:aboutDialog.authorLabel')}</span>
            {t('home:aboutDialog.authorName')}
          </p>

          <p>
            <span className="text-muted-foreground">{t('home:aboutDialog.feedbackLabel')}</span>
            <a
              href="https://qm.qq.com/q/hDQw6J6kU2"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 font-medium hover:underline"
            >
              {t('home:aboutDialog.joinQQGroup')}
            </a>
          </p>

          <div className="flex justify-center">
            <img
              src="/group_qrcode.jpg"
              alt={t('home:aboutDialog.qrcodeAlt')}
              className="w-48 rounded-md border"
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
