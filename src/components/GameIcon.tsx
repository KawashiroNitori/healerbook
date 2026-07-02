// src/components/GameIcon.tsx
import { useState, type ImgHTMLAttributes } from 'react'
import { useUIStore } from '@/store/uiStore'
import { normalizeIcon } from '@/api/providers/normalizeIcon'
import {
  buildIconUrl,
  getNextIconProvider,
  onIconSuccess,
  EMPTY_IMAGE,
} from '@/api/providers/iconProvider'
import type { IconProviderId } from '@/api/providers/registry'

type GameIconProps = { input: string | number } & Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'>

/**
 * 游戏图标：归一 input → iconId，用首选源渲染，onError 顺序换源，onLoad 写回 learned。
 * 不暴露选源，全自动。
 */
export function GameIcon({ input, onError, onLoad, ...rest }: GameIconProps) {
  const learned = useUIStore(s => s.iconLearned)
  const iconId = normalizeIcon(input)
  const [state, setState] = useState<{
    iconId: number
    provider: IconProviderId
    tried: IconProviderId[]
    failed: boolean
  }>(() => ({ iconId, provider: learned, tried: [learned], failed: false }))

  // input 变化（组件复用）时重置换源进度。渲染期间调整 state（React 推荐的
  // "adjusting state when a prop changes" 模式），而非 useEffect + setState，
  // 避免 react-hooks/set-state-in-effect 触发的级联渲染问题。
  if (state.iconId !== iconId) {
    setState({ iconId, provider: learned, tried: [learned], failed: false })
  }

  const src = iconId > 0 && !state.failed ? buildIconUrl(iconId, state.provider) : EMPTY_IMAGE

  return (
    <img
      {...rest}
      src={src}
      data-icon-id={iconId}
      onLoad={e => {
        if (iconId > 0 && !state.failed) onIconSuccess(state.provider)
        onLoad?.(e)
      }}
      onError={e => {
        const next = getNextIconProvider(state.tried)
        if (next) setState(s => ({ ...s, provider: next, tried: [...s.tried, next] }))
        else setState(s => ({ ...s, failed: true }))
        onError?.(e)
      }}
    />
  )
}
