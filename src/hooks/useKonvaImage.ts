/**
 * Konva 图片加载 Hook
 */

import { useState, useEffect } from 'react'
import { buildIconUrl, getNextIconProvider, onIconSuccess } from '@/api/providers/iconProvider'
import { useUIStore } from '@/store/uiStore'
import type { IconProviderId } from '@/api/providers/registry'

/**
 * 加载图片并返回 HTMLImageElement
 * @param icon 图标 ID 或图标路径（交给 buildIconUrl 归一）
 * @returns 加载的图片元素或 null
 */
export function useKonvaImage(icon: string | number): HTMLImageElement | null {
  const [image, setImage] = useState<HTMLImageElement | null>(() => {
    if (!icon) return null
    return null
  })

  useEffect(() => {
    if (!icon) return

    const img = new window.Image()
    const tried: IconProviderId[] = []
    let current: IconProviderId | undefined

    const loadWith = (provider: IconProviderId) => {
      current = provider
      tried.push(provider)
      img.src = buildIconUrl(icon, provider)
    }

    img.onload = () => {
      if (current) onIconSuccess(current)
      setImage(img)
    }
    img.onerror = () => {
      const next = getNextIconProvider(tried)
      if (next) {
        loadWith(next)
      } else {
        console.warn(`Failed to load icon (all providers): ${icon}`)
        setImage(null)
      }
    }

    loadWith(useUIStore.getState().iconLearned)

    return () => {
      img.onload = null
      img.onerror = null
    }
  }, [icon])

  return image
}
