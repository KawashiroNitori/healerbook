import { describe, it, expect } from 'vitest'
import {
  ICON_PROVIDERS,
  DEFAULT_ICON_PROVIDER,
  API_PROVIDERS,
  DEFAULT_API_PROVIDER,
} from './registry'

describe('registry', () => {
  const icon = (id: string) => ICON_PROVIDERS.find(p => p.id === id)!

  it('xivcdn 拼 query 型（无 format，返回 webp）', () => {
    expect(icon('xivcdn').build(3253)).toBe(
      'https://xivapi-v2.xivcdn.com/api/asset?path=ui/icon/003000/003253_hr1.tex'
    )
  })
  it('xivapi-asset 拼 query 型（format=webp）', () => {
    expect(icon('xivapi-asset').build(405)).toBe(
      'https://v2.xivapi.com/api/asset?path=ui/icon/000000/000405_hr1.tex&format=webp'
    )
  })
  it('rpglogs 从 iconId 重建 FFLogs 路径（斜杠换连字符）', () => {
    expect(icon('rpglogs').build(3253)).toBe(
      'https://assets.rpglogs.cn/img/ff/abilities/003000-003253.png'
    )
  })
  it('icon 源顺序：xivcdn → xivapi-asset → rpglogs', () => {
    expect(ICON_PROVIDERS.map(p => p.id)).toEqual(['xivcdn', 'xivapi-asset', 'rpglogs'])
    expect(DEFAULT_ICON_PROVIDER).toBe('xivcdn')
  })
  it('API 源顺序：xivcdn → xivapi', () => {
    expect(API_PROVIDERS.map(p => p.id)).toEqual(['xivcdn', 'xivapi'])
    expect(API_PROVIDERS[0].base).toBe('https://xivapi-v2.xivcdn.com/api')
    expect(API_PROVIDERS[1].base).toBe('https://v2.xivapi.com/api')
    expect(DEFAULT_API_PROVIDER).toBe('xivcdn')
  })
})
