import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface AboutDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function AboutDialog({ open, onOpenChange }: AboutDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>关于</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <p>
            <span className="text-muted-foreground">作者：</span>
            间宫羽咲@沃仙曦染
          </p>

          <p>
            <span className="text-muted-foreground">反馈 & 建议 & 交流 & 分享减伤轴：</span>
            <a
              href="https://qm.qq.com/q/hDQw6J6kU2"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 font-medium hover:underline"
            >
              加入 QQ 群
            </a>
          </p>

          <div className="flex justify-center">
            <img src="/group_qrcode.jpg" alt="QQ 群二维码" className="w-48 rounded-md border" />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
