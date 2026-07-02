import { describe, it, expect } from 'vitest'
import {
  ICON_PROVIDERS,
  DEFAULT_ICON_PROVIDER,
  API_PROVIDERS,
  DEFAULT_API_PROVIDER,
} from './registry'

describe('registry', () => {
  const icon = (id: string) => ICON_PROVIDERS.find(p => p.id === id)!

  it('cafemaker 拼直链', () => {
    expect(icon('cafemaker').build(3253)).toBe(
      'https://cafemaker.wakingsands.com/i/003000/003253.png'
    )
  })
  it('xivapi-asset 拼 query 型', () => {
    expect(icon('xivapi-asset').build(405)).toBe(
      'https://v2.xivapi.com/api/asset?path=ui/icon/000000/000405.tex&format=png'
    )
  })
  it('rpglogs 从 iconId 重建 FFLogs 路径（斜杠换连字符）', () => {
    expect(icon('rpglogs').build(3253)).toBe(
      'https://assets.rpglogs.cn/img/ff/abilities/003000-003253.png'
    )
  })
  it('icon 源顺序：cafemaker → xivapi-asset → rpglogs', () => {
    expect(ICON_PROVIDERS.map(p => p.id)).toEqual(['cafemaker', 'xivapi-asset', 'rpglogs'])
    expect(DEFAULT_ICON_PROVIDER).toBe('cafemaker')
  })
  it('API 源顺序：xivcdn → xivapi', () => {
    expect(API_PROVIDERS.map(p => p.id)).toEqual(['xivcdn', 'xivapi'])
    expect(API_PROVIDERS[0].base).toBe('https://xivapi-v2.xivcdn.com/api')
    expect(API_PROVIDERS[1].base).toBe('https://v2.xivapi.com/api')
    expect(DEFAULT_API_PROVIDER).toBe('xivcdn')
  })
})
