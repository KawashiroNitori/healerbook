/**
 * Konva 图片加载 Hook
 */

import { useState, useEffect } from 'react'
import { buildIconUrl, getNextIconProvider, onIconSuccess } from '@/api/providers/iconProvider'
import { useUIStore } from '@/store/uiStore'
import type { IconProviderId } from '@/api/providers/registry'

/**
 * 加载图片并返回 HTMLImageElement
 * @param iconPath 图标路径
 * @returns 加载的图片元素或 null
 */
export function useKonvaImage(iconPath: string): HTMLImageElement | null {
  const [image, setImage] = useState<HTMLImageElement | null>(() => {
    if (!iconPath) return null
    return null
  })

  useEffect(() => {
    if (!iconPath) return

    const img = new window.Image()
    const tried: IconProviderId[] = []
    let current: IconProviderId | undefined

    const loadWith = (provider: IconProviderId) => {
      current = provider
      tried.push(provider)
      img.src = buildIconUrl(iconPath, provider)
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
        console.warn(`Failed to load icon (all providers): ${iconPath}`)
        setImage(null)
      }
    }

    loadWith(useUIStore.getState().iconLearned)

    return () => {
      img.onload = null
      img.onerror = null
    }
  }, [iconPath])

  return image
}
