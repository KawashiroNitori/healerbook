/**
 * 数据源 provider 表：icon 链与 API 链各自独立，互为 fallback。
 * 两条链均直连（API 源已实测返回 access-control-allow-origin: *，无需代理）。
 */
import { completeIcon } from '@/../3rdparty/ff14-overlay-vue/src/resources/logic/status'

export type IconProviderId = 'cafemaker' | 'xivapi-asset' | 'rpglogs'

export interface IconProvider {
  id: IconProviderId
  build: (iconId: number) => string
}

export const ICON_PROVIDERS: IconProvider[] = [
  { id: 'cafemaker', build: id => `https://cafemaker.wakingsands.com/i/${completeIcon(id)}.png` },
  {
    id: 'xivapi-asset',
    build: id => `https://v2.xivapi.com/api/asset?path=ui/icon/${completeIcon(id)}.tex&format=png`,
  },
  // rpglogs 国内 CDN：completeIcon '003000/003253' → '003000-003253'，兜底地区可达性
  {
    id: 'rpglogs',
    build: id =>
      `https://assets.rpglogs.cn/img/ff/abilities/${completeIcon(id).replace('/', '-')}.png`,
  },
]

export const DEFAULT_ICON_PROVIDER: IconProviderId = 'cafemaker'

export type ApiProviderId = 'xivcdn' | 'xivapi'

export interface ApiProvider {
  id: ApiProviderId
  base: string
}

export const API_PROVIDERS: ApiProvider[] = [
  { id: 'xivcdn', base: 'https://xivapi-v2.xivcdn.com/api' },
  { id: 'xivapi', base: 'https://v2.xivapi.com/api' },
]

export const DEFAULT_API_PROVIDER: ApiProviderId = 'xivcdn'
