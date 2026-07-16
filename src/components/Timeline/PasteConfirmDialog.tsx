/**
 * 粘贴确认对话框
 *
 * 当粘贴时有技能 cast / 技能轨备注无法按职业映射到当前时间轴轨道（remap 跳过）时弹出，
 * 让用户选择「继续粘贴其余对象」或「放弃粘贴」。无跳过时不渲染。
 */

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import type { PasteResult } from '@/utils/timelineClipboard'

interface PasteConfirmDialogProps {
  /** 待确认的粘贴结果（含被跳过数量）；为 null 时不渲染 */
  pending: PasteResult | null
  /** 继续粘贴其余对象 */
  onConfirm: () => void
  /** 放弃粘贴 */
  onCancel: () => void
}

export default function PasteConfirmDialog({
  pending,
  onConfirm,
  onCancel,
}: PasteConfirmDialogProps) {
  if (!pending) return null

  return (
    <AlertDialog open={true} onOpenChange={open => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>部分技能无法粘贴</AlertDialogTitle>
          <AlertDialogDescription>
            当前阵容与剪贴板中的技能阵容不符，部分技能无法粘贴到当前时间轴，是否要继续粘贴剩余技能？
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>放弃</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>继续粘贴</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
