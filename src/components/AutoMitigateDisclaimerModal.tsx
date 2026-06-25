import { useState } from 'react'
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

const CONFIRM_PHRASE = '我不会无脑照搬'

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
  const [text, setText] = useState('')
  const matched = text.trim() === CONFIRM_PHRASE

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
          <DialogTitle>自动减伤规划</DialogTitle>
          <DialogDescription className="leading-relaxed">
            本功能仅试图实现理论上的减伤可行解，并未充分考虑实际可执行性、回复量与现实机制差异，自动规划结果仅供参考，请务必不要无脑照搬。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            请输入「<span className="font-medium text-foreground">{CONFIRM_PHRASE}</span>」以继续：
          </p>
          <Input
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={CONFIRM_PHRASE}
            autoFocus
            onKeyDown={e => {
              if (e.key === 'Enter') handleConfirm()
            }}
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => handleOpenChange(false)}>
            取消
          </Button>
          <Button size="sm" disabled={!matched} onClick={handleConfirm}>
            确认
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
