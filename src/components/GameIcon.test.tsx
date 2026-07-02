// src/components/GameIcon.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { useUIStore } from '@/store/uiStore'
import { GameIcon } from './GameIcon'
import { EMPTY_IMAGE } from '@/api/providers/iconProvider'

describe('GameIcon', () => {
  beforeEach(() => useUIStore.setState({ iconLearned: 'cafemaker' }))

  it('初始用首选源 + data-icon-id + 透传 className/alt', () => {
    const { getByAltText } = render(
      <GameIcon input="/i/003000/003253.png" alt="skill" className="w-6" />
    )
    const img = getByAltText('skill') as HTMLImageElement
    expect(img.getAttribute('src')).toBe('https://cafemaker.wakingsands.com/i/003000/003253.png')
    expect(img.getAttribute('data-icon-id')).toBe('3253')
    expect(img.className).toBe('w-6')
  })

  it('onError 顺序换源', () => {
    const { getByAltText } = render(<GameIcon input="/i/003000/003253.png" alt="s" />)
    const img = getByAltText('s') as HTMLImageElement
    fireEvent.error(img)
    expect(img.getAttribute('src')).toBe(
      'https://v2.xivapi.com/api/asset?path=ui/icon/003000/003253.tex&format=png'
    )
  })

  it('无效输入 → EMPTY_IMAGE', () => {
    const { getByAltText } = render(<GameIcon input="" alt="e" />)
    expect((getByAltText('e') as HTMLImageElement).getAttribute('src')).toBe(EMPTY_IMAGE)
  })

  it('全部源 error 试尽 → EMPTY_IMAGE', () => {
    const { getByAltText } = render(<GameIcon input="/i/003000/003253.png" alt="f" />)
    const img = getByAltText('f') as HTMLImageElement
    fireEvent.error(img) // → xivapi-asset
    fireEvent.error(img) // → rpglogs
    fireEvent.error(img) // 试尽
    expect(img.getAttribute('src')).toBe(EMPTY_IMAGE)
  })

  it('onLoad 成功写回 learned（首选与成功源不同）', () => {
    useUIStore.setState({ iconLearned: 'xivapi-asset' })
    const { getByAltText } = render(<GameIcon input="/i/003000/003253.png" alt="l" />)
    const img = getByAltText('l') as HTMLImageElement
    // 首选 xivapi-asset 失败 → 换到 cafemaker
    fireEvent.error(img)
    expect(img.getAttribute('src')).toBe('https://cafemaker.wakingsands.com/i/003000/003253.png')
    fireEvent.load(img)
    expect(useUIStore.getState().iconLearned).toBe('cafemaker')
  })
})
