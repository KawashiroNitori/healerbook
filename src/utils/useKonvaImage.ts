/**
 * Konva 图片加载 Hook
 */

import { useState, useEffect } from 'react'
import { getIconUrl } from './iconUtils'

/**
 * 加载图片并返回 HTMLImageElement
 * @param iconPath 图标路径
 * @returns 加载的图片元素或 null
 */
export function useKonvaImage(iconPath: string): HTMLImageElement | null {
  const [image, setImage] = useState<HTMLImageElement | null>(null)

  useEffect(() => {
    if (!iconPath) {
      setImage(null)
      return
    }

    const img = new window.Image()
    img.crossOrigin = 'anonymous' // 允许跨域加载

    img.onload = () => {
      setImage(img)
    }

    img.onerror = () => {
      console.warn(`Failed to load icon: ${iconPath}`)
      setImage(null)
    }

    img.src = getIconUrl(iconPath)

    return () => {
      img.onload = null
      img.onerror = null
    }
  }, [iconPath])

  return image
}

/**
 * 批量预加载图标
 * @param iconPaths 图标路径数组
 * @returns 加载完成的图片 Map
 */
export function preloadIcons(iconPaths: string[]): Promise<Map<string, HTMLImageElement>> {
  return new Promise((resolve) => {
    const imageMap = new Map<string, HTMLImageElement>()
    let loadedCount = 0

    if (iconPaths.length === 0) {
      resolve(imageMap)
      return
    }

    iconPaths.forEach((path) => {
      const img = new window.Image()
      img.crossOrigin = 'anonymous'

      const onComplete = () => {
        loadedCount++
        if (loadedCount === iconPaths.length) {
          resolve(imageMap)
        }
      }

      img.onload = () => {
        imageMap.set(path, img)
        onComplete()
      }

      img.onerror = () => {
        console.warn(`Failed to preload icon: ${path}`)
        onComplete()
      }

      img.src = getIconUrl(path)
    })
  })
}
