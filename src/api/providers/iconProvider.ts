/**
 * Icon 链：直连 + onerror 顺序换源 + 失败驱动自学习。
 */
import { ICON_PROVIDERS, DEFAULT_ICON_PROVIDER, type IconProviderId } from './registry'
import { normalizeIcon } from './normalizeIcon'
import { useUIStore } from '@/store/uiStore'

/** 1x1 透明 PNG，用作无效输入/全试尽的占位图 */
export const EMPTY_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQBRZDGVAAAAAElFTkSuQmCC'

export function buildIconUrl(
  input: string | number,
  provider: IconProviderId = useUIStore.getState().iconLearned
): string {
  const iconId = normalizeIcon(input)
  if (iconId <= 0) return EMPTY_IMAGE
  const p =
    ICON_PROVIDERS.find(x => x.id === provider) ??
    ICON_PROVIDERS.find(x => x.id === DEFAULT_ICON_PROVIDER)!
  return p.build(iconId)
}

export function getNextIconProvider(tried: IconProviderId[]): IconProviderId | undefined {
  return ICON_PROVIDERS.find(p => !tried.includes(p.id))?.id
}

export function onIconSuccess(provider: IconProviderId): void {
  const store = useUIStore.getState()
  if (store.iconLearned !== provider) store.setIconLearned(provider)
}
