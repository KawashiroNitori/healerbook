/**
 * 共享 Popover —— 7 态权限管理面板。
 * 呈现态由 deriveShareView 推导,见 shareView.ts。
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as Y from 'yjs'
import { toBase64 } from 'lib0/buffer'
import { Copy, Check, Loader2, Globe, Upload, CloudUpload, Lock, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
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
import { useAuth } from '@/hooks/useAuth'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { useAuthStore } from '@/store/authStore'
import { useTimelineStore } from '@/store/timelineStore'
import type { Timeline } from '@/types/timeline'
import { publishTimeline, requestEditPermission } from '@/api/timelineShareApi'
import { IndexedDBDocStore } from '@/collab/storage/IndexedDBDocStore'
import { track } from '@/utils/analytics'
import { deriveShareView, deriveShareTrigger } from './shareView'
import SharePopoverAuthor from './SharePopoverAuthor'

interface SharePopoverProps {
  timeline: Timeline
  /** 是否已发布到云端 */
  isPublished: boolean
  viewMode: 'timeline' | 'table'
  /** 发布成功(参数为服务端最终 id) */
  onPublished: (newId: string) => void
  /** 在本地创建副本 */
  onCreateCopy: () => void
  /** 角色信息(来自 EditorPage 的 GET /:id;本地未发布时为占位值) */
  role: 'editor' | 'viewer'
  isAuthor: boolean
  allowEditRequests: boolean
  hasPendingRequest: boolean
}

const SHARE_BASE_URL = window.location.origin

/** popover 按钮栏:置底右对齐 */
function ShareButtonBar({ children }: { children: React.ReactNode }) {
  return <div className="flex justify-end gap-2 pt-1">{children}</div>
}

export default function SharePopover({
  timeline,
  isPublished,
  viewMode,
  onPublished,
  onCreateCopy,
  role,
  isAuthor,
  allowEditRequests,
  hasPendingRequest,
}: SharePopoverProps) {
  const { t } = useTranslation(['share', 'common'])
  const { isLoggedIn, login } = useAuth()
  const accessToken = useAuthStore(s => s.accessToken)
  // 被撤权后 sessionRole 会降级为 viewer；deriveShareView 据此把角色覆写为 viewer
  const isRevoked = useTimelineStore(s => s.sessionRole) === 'viewer'
  // 共享按钮角标计数:GET /:id 播种、WS 实时推送、popover 内审批后回写,统一收敛到 store
  const pendingRequestCount = useTimelineStore(s => s.pendingRequestCount)
  const [loading, setLoading] = useState(false)
  const { copied, copy } = useCopyToClipboard({
    onError: () => toast.error(t('share:sharePopover.copyFailed')),
  })
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [requesting, setRequesting] = useState(false)
  const [requested, setRequested] = useState(false)

  const view = deriveShareView({
    isPublished,
    isLoggedIn,
    role,
    isAuthor,
    allowEditRequests,
    hasPendingRequest: hasPendingRequest || requested,
    isRevoked,
  })
  const trigger = deriveShareTrigger({
    isPublished,
    isLoggedIn,
    role,
    isAuthor,
    allowEditRequests,
    hasPendingRequest: hasPendingRequest || requested,
    isRevoked,
  })

  const shareUrl =
    isPublished && !isRevoked
      ? `${SHARE_BASE_URL}/timeline/${timeline.id}${viewMode === 'table' ? '?view=table' : ''}`
      : ''
  const pendingRequest = hasPendingRequest || requested

  const handlePublish = async () => {
    if (!accessToken) return
    setLoading(true)
    try {
      const engine = useTimelineStore.getState().engine
      if (!engine) throw new Error(t('share:sharePopover.engineNotReady'))
      await engine.flush()
      // 一并上传本地 Y.Doc 全量 update:服务端据此 seed DO + 预写 KV 快照,
      // 使公开读(含匿名 viewer)发布后立即可见。seed 的就是本地 doc 本身,
      // client id 一致,作者随后 /connect 时增量同步无分叉、不重复。
      const content = toBase64(Y.encodeStateAsUpdate(engine.doc))
      const { id: newId } = await publishTimeline(timeline.id, timeline.name, content)
      const store = new IndexedDBDocStore()
      await store.open()
      if (newId !== timeline.id) {
        await store.rekey(timeline.id, newId)
      }
      const meta = await store.getMeta(newId)
      if (meta) await store.putMeta({ ...meta, kind: 'published' })
      await useTimelineStore.getState().applyPublishResult(newId)
      track('timeline-publish', { encounterId: timeline.encounter?.id })
      onPublished(newId)
      toast.success(t('share:sharePopover.publishSuccess'))
    } catch (err) {
      toast.error(
        t('share:sharePopover.publishFailed', {
          message: err instanceof Error ? err.message : t('common:unknownError'),
        })
      )
    } finally {
      setLoading(false)
    }
  }

  const handleRequest = async () => {
    setRequesting(true)
    try {
      await requestEditPermission(timeline.id)
      setRequested(true)
      toast.success(t('share:sharePopover.requestSubmitted'))
    } catch (err) {
      toast.error(
        t('share:sharePopover.requestFailed', {
          message: err instanceof Error ? err.message : t('common:unknownError'),
        })
      )
    } finally {
      setRequesting(false)
    }
  }

  const triggerIcon =
    trigger === 'publish' ? (
      <CloudUpload className="w-4 h-4" />
    ) : trigger === 'author' ? (
      <Globe className="w-4 h-4" />
    ) : trigger === 'editor' ? (
      <Pencil className="w-4 h-4" />
    ) : (
      <Lock className="w-4 h-4" />
    )
  const triggerLabel =
    trigger === 'editor'
      ? t('share:sharePopover.triggerEditable')
      : trigger === 'viewer'
        ? t('share:sharePopover.triggerViewOnly')
        : t('share:sharePopover.triggerShare')

  const copyButton = (
    <Button variant="outline" size="sm" onClick={() => copy(shareUrl)}>
      {copied ? <Check className="w-4 h-4 mr-1" /> : <Copy className="w-4 h-4 mr-1" />}
      {t('share:sharePopover.copyShareLink')}
    </Button>
  )
  const createCopyButton = (
    <Button variant="outline" size="sm" onClick={onCreateCopy}>
      {t('share:sharePopover.createCopy')}
    </Button>
  )

  return (
    <>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('share:sharePopover.confirmPublishTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('share:sharePopover.confirmPublishDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handlePublish}>
              {t('share:sharePopover.confirmPublishAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="relative h-7 shrink-0 gap-1 font-normal whitespace-nowrap"
          >
            {triggerIcon}
            <span className="hidden lg:inline">{triggerLabel}</span>
            {trigger === 'author' && pendingRequestCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium leading-none text-white">
                {pendingRequestCount > 99 ? '99+' : pendingRequestCount}
              </span>
            )}
          </Button>
        </PopoverTrigger>

        <PopoverContent className="w-80" align="end">
          <div className="space-y-1.5">
            <h4 className="font-medium text-sm">{t('share:sharePopover.heading')}</h4>

            {view.kind === 'publish' && (
              <div className="space-y-3">
                {isLoggedIn ? (
                  <>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Lock className="w-3.5 h-3.5 shrink-0" />
                      <span>{t('share:sharePopover.notSharedHint')}</span>
                    </div>
                    <Button
                      variant="default"
                      className="w-full"
                      onClick={() => setConfirmOpen(true)}
                      disabled={loading}
                    >
                      {loading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Upload className="w-4 h-4" />
                      )}
                      {t('share:sharePopover.publish')}
                    </Button>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">
                      {t('share:sharePopover.loginToPublishHint')}
                    </p>
                    <Button className="w-full" onClick={login}>
                      {t('share:sharePopover.loginFflogs')}
                    </Button>
                  </>
                )}
              </div>
            )}

            {view.kind === 'viewer-anon' && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {t('share:sharePopover.viewerCreateCopyHint')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('share:sharePopover.viewerAlreadyEditorHint')}
                </p>
                <ShareButtonBar>
                  <Button variant="outline" size="sm" onClick={login}>
                    {t('share:sharePopover.loginFflogs')}
                  </Button>
                  {createCopyButton}
                </ShareButtonBar>
              </div>
            )}

            {view.kind === 'viewer-no-request' && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {t('share:sharePopover.viewerCreateCopyHint')}
                </p>
                <ShareButtonBar>{createCopyButton}</ShareButtonBar>
              </div>
            )}

            {(view.kind === 'viewer-can-request' || view.kind === 'viewer-requested') && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {t('share:sharePopover.viewerRequestOrCopyHint')}
                </p>
                <ShareButtonBar>
                  {createCopyButton}
                  <Button
                    variant="default"
                    size="sm"
                    disabled={pendingRequest || requesting}
                    onClick={handleRequest}
                  >
                    {requesting && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                    {pendingRequest
                      ? t('share:sharePopover.requested')
                      : t('share:sharePopover.requestEditPermission')}
                  </Button>
                </ShareButtonBar>
              </div>
            )}

            {view.kind === 'editor' && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {t('share:sharePopover.editorHint')}
                </p>
                <ShareButtonBar>
                  {createCopyButton}
                  {copyButton}
                </ShareButtonBar>
              </div>
            )}

            {view.kind === 'author' && (
              <>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Globe className="w-3.5 h-3.5 shrink-0" />
                  <span>{t('share:sharePopover.publishedHint')}</span>
                </div>
                <SharePopoverAuthor timelineId={timeline.id} shareUrl={shareUrl} />
              </>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </>
  )
}
