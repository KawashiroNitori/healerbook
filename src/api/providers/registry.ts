/**
 * 数据源 provider 表：icon 链与 API 链各自独立，互为 fallback。
 * 两条链均直连（API 源已实测返回 access-control-allow-origin: *，无需代理）。
 */
import { completeIcon } from '@/../3rdparty/ff14-overlay-vue/src/resources/logic/status'

export type IconProviderId = 'xivcdn' | 'xivapi-asset' | 'rpglogs'

export interface IconProvider {
  id: IconProviderId
  build: (iconId: number) => string
}

// xivcdn / xivapi-asset 取 _hr1 高清图标（80×80，webp）
export const ICON_PROVIDERS: IconProvider[] = [
  // xivapi 的 CDN 入口。cafemaker 的 /i/ 路径会无条件 302 到这里且 302 不带缓存头，故直连
  {
    id: 'xivcdn',
    build: id => `https://xivapi-v2.xivcdn.com/api/asset?path=ui/icon/${completeIcon(id)}_hr1.tex`,
  },
  {
    id: 'xivapi-asset',
    build: id =>
      `https://v2.xivapi.com/api/asset?path=ui/icon/${completeIcon(id)}_hr1.tex&format=webp`,
  },
  // rpglogs 国内 CDN：completeIcon '003000/003253' → '003000-003253'，兜底地区可达性
  // 无 _hr1 高清版本（请求返回 404），只能取普通图标（40×40）
  {
    id: 'rpglogs',
    build: id =>
      `https://assets.rpglogs.cn/img/ff/abilities/${completeIcon(id).replace('/', '-')}.png`,
  },
]

export const DEFAULT_ICON_PROVIDER: IconProviderId = 'xivcdn'

export function isIconProviderId(id: unknown): id is IconProviderId {
  return ICON_PROVIDERS.some(p => p.id === id)
}

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
