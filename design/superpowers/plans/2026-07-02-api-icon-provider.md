# API / Icon Provider 抽象与自动回退 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把分散硬编码的数据源域名收拢成两条独立 provider 链（API / icon），各自支持失败驱动自学习 + 运行时回退，全自动、无 UI、两条链均直连。

**Architecture:** 新增 `src/api/providers/` 模块（registry 表 + normalizeIcon 归一 + iconProvider/apiProvider 逻辑）。icon 输入统一归一成 `iconId: number`，由 provider 各自拼 URL；失败时按 `ICON_PROVIDERS` 顺序换源，成功源写回 `uiStore.iconLearned`。API 请求经 `requestWithFallback` 按 `API_PROVIDERS` 顺序直连，成功源写回 `uiStore.apiLearned`。React `<img>` 统一换成 `<GameIcon>` 封装，Konva 侧在 `useKonvaImage` 内用同一批 provider 函数做回退。

**Tech Stack:** React 19 + TypeScript 5.9、Zustand 5（persist）、Vitest 4（node 环境为主，DOM 用例加 `// @vitest-environment jsdom`）、pnpm。

## Global Constraints

- **必须用 pnpm**（禁止 npm/yarn）。
- 测试文件与源文件同目录，命名 `*.test.ts` / `*.test.tsx`。
- 提交信息、作者、Co-Authored-By **禁止**出现 "Claude" 字样（`.husky/commit-msg` 会拒绝）。
- 命名用 `action` 不用 `skill`。
- Zustand 状态更新走不可变模式。
- 每个 Task 结束前：改动小范围跑 `pnpm test:run <pattern>`；Task 10 完成后跑 `pnpm exec tsc --noEmit`、`pnpm lint`、`pnpm test:run`、`pnpm build` 兜底。
- 未经用户明确授权不得 `git push`；本 plan 内已声明的 `git commit` 步骤在 subagent-driven 自动流程中可自主执行。
- 两条链均直连，**不新增任何 Worker / 同源代理**。
- **不向用户暴露任何选源 UI**（不改 `EditorToolbar`，不加下拉/设置面板）。

---

## File Structure

**新增：**

- `src/api/providers/registry.ts` — provider 表（`ICON_PROVIDERS` / `API_PROVIDERS`）、类型、默认源。纯数据，无副作用。
- `src/api/providers/normalizeIcon.ts` — `normalizeIcon(input) → iconId`。纯函数。
- `src/api/providers/iconProvider.ts` — `EMPTY_IMAGE`、`buildIconUrl`、`getNextIconProvider`、`onIconSuccess`。
- `src/api/providers/apiProvider.ts` — `requestWithFallback`、`onApiSuccess`。
- `src/components/GameIcon.tsx` — React `<img>` 封装：归一 + 首选源 + onError 换源 + onLoad 自学习。
- 对应 `*.test.ts(x)`。

**改造：**

- `src/store/uiStore.ts` — 加 `iconLearned` / `apiLearned` 两字段 + 两 setter（persist 默认包含）。
- `src/api/xivapi.ts` — `getActionById` 走 `requestWithFallback` + `onApiSuccess`；`toIconPath` 返回原始路径。
- `src/utils/iconUtils.ts` — `getIconUrl` 改为 `buildIconUrl` 薄封装；删除两个硬编码 base 常量。
- `src/utils/statusIconUtils.ts` — `getStatusIconUrl` 改用 `buildIconUrl`。
- `src/utils/useKonvaImage.ts` — `useKonvaImage` / `preloadIcons` 接入 provider 回退 + 自学习。
- 7 个 `<img>` 站点 → `<GameIcon>`（Task 10 逐一列出）。

---

## Task 1: Provider registry（provider 表 + 类型 + 默认源）

**Files:**

- Create: `src/api/providers/registry.ts`
- Test: `src/api/providers/registry.test.ts`

**Interfaces:**

- Consumes: `completeIcon(icon: number): string`（来自 `3rdparty/ff14-overlay-vue`，`3253 → '003000/003253'`、`405 → '000000/000405'`）。
- Produces:
  - `type IconProviderId = 'cafemaker' | 'xivapi-asset' | 'rpglogs'`
  - `interface IconProvider { id: IconProviderId; build: (iconId: number) => string }`
  - `const ICON_PROVIDERS: IconProvider[]`、`const DEFAULT_ICON_PROVIDER: IconProviderId = 'cafemaker'`
  - `type ApiProviderId = 'xivcdn' | 'xivapi'`
  - `interface ApiProvider { id: ApiProviderId; base: string }`
  - `const API_PROVIDERS: ApiProvider[]`、`const DEFAULT_API_PROVIDER: ApiProviderId = 'xivcdn'`

- [ ] **Step 1: 写失败测试**

```ts
// src/api/providers/registry.test.ts
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:run registry`
Expected: FAIL —「Cannot find module './registry'」。

- [ ] **Step 3: 实现 registry.ts**

```ts
// src/api/providers/registry.ts
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test:run registry`
Expected: PASS（5 个用例）。

- [ ] **Step 5: 提交**

```bash
git add src/api/providers/registry.ts src/api/providers/registry.test.ts
git commit -m "feat(providers): 新增 icon/api provider registry 表与默认源"
```

---

## Task 2: normalizeIcon 归一层

**Files:**

- Create: `src/api/providers/normalizeIcon.ts`
- Test: `src/api/providers/normalizeIcon.test.ts`

**Interfaces:**

- Produces: `normalizeIcon(input: string | number): number` — 取「去掉 query + 去掉 `_hrN` 高清后缀」后最后一段连续数字；无法解析或非有限数 → `0`。

- [ ] **Step 1: 写失败测试**

```ts
// src/api/providers/normalizeIcon.test.ts
import { describe, it, expect } from 'vitest'
import { normalizeIcon } from './normalizeIcon'

describe('normalizeIcon', () => {
  it('数字原样返回', () => expect(normalizeIcon(3253)).toBe(3253))
  it('/i/ 路径', () => expect(normalizeIcon('/i/003000/003253.png')).toBe(3253))
  it('xivapi .tex 路径', () => expect(normalizeIcon('ui/icon/003000/003253.tex')).toBe(3253))
  it('高清 _hr1 后缀不被误当作 iconId', () =>
    expect(normalizeIcon('ui/icon/002000/002645_hr1.tex')).toBe(2645))
  it('FFLogs HHHHHH-FFFFFF.png 取尾段', () => expect(normalizeIcon('003000-003253.png')).toBe(3253))
  it('无数字 → 0', () => expect(normalizeIcon('abc')).toBe(0))
  it('空串 → 0', () => expect(normalizeIcon('')).toBe(0))
  it('非有限数 → 0', () => expect(normalizeIcon(NaN)).toBe(0))
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:run normalizeIcon`
Expected: FAIL —「Cannot find module './normalizeIcon'」。

- [ ] **Step 3: 实现 normalizeIcon.ts**

```ts
// src/api/providers/normalizeIcon.ts
/**
 * 把各种 icon 输入归一成 iconId（number）。
 * 支持：'/i/HHHHHH/FFFFFF.png'、'ui/icon/HHHHHH/FFFFFF.tex'（含 _hrN 高清后缀）、
 * FFLogs 'HHHHHH-FFFFFF.png'、纯数字。无法解析 → 0。
 */
export function normalizeIcon(input: string | number): number {
  if (typeof input === 'number') return Number.isFinite(input) ? input : 0
  // 去掉 query，去掉 _hrN（高清后缀会引入尾部数字，需先剔除）
  const cleaned = input.split('?')[0].replace(/_hr\d+/gi, '')
  const groups = cleaned.match(/\d+/g)
  if (!groups || groups.length === 0) return 0
  return Number.parseInt(groups[groups.length - 1], 10)
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test:run normalizeIcon`
Expected: PASS（8 个用例）。

- [ ] **Step 5: 提交**

```bash
git add src/api/providers/normalizeIcon.ts src/api/providers/normalizeIcon.test.ts
git commit -m "feat(providers): 新增 normalizeIcon 归一层（含 _hr 高清后缀处理）"
```

---

## Task 3: uiStore 新增 learned 字段

**Files:**

- Modify: `src/store/uiStore.ts`
- Test: `src/store/uiStore.test.ts`（若已存在则追加 describe 块）

**Interfaces:**

- Consumes: `DEFAULT_ICON_PROVIDER`、`DEFAULT_API_PROVIDER`、`IconProviderId`、`ApiProviderId`（Task 1）。
- Produces: `useUIStore` 新增 state `iconLearned: IconProviderId`、`apiLearned: ApiProviderId` 与 action `setIconLearned(id)`、`setApiLearned(id)`。默认值 `cafemaker` / `xivcdn`，随 persist 持久化。

- [ ] **Step 1: 写失败测试**

```ts
// src/store/uiStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useUIStore } from './uiStore'

describe('uiStore learned 字段', () => {
  beforeEach(() => {
    useUIStore.setState({ iconLearned: 'cafemaker', apiLearned: 'xivcdn' })
  })

  it('默认 learned 源', () => {
    expect(useUIStore.getState().iconLearned).toBe('cafemaker')
    expect(useUIStore.getState().apiLearned).toBe('xivcdn')
  })
  it('setIconLearned 更新', () => {
    useUIStore.getState().setIconLearned('rpglogs')
    expect(useUIStore.getState().iconLearned).toBe('rpglogs')
  })
  it('setApiLearned 更新', () => {
    useUIStore.getState().setApiLearned('xivapi')
    expect(useUIStore.getState().apiLearned).toBe('xivapi')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:run uiStore`
Expected: FAIL — `iconLearned` 为 `undefined`，`setIconLearned` 不是函数。

- [ ] **Step 3: 改 uiStore.ts**

在文件顶部 import 区加入：

```ts
import {
  DEFAULT_ICON_PROVIDER,
  DEFAULT_API_PROVIDER,
  type IconProviderId,
  type ApiProviderId,
} from '@/api/providers/registry'
```

在 `interface UIState` 里、`canvasTool` 字段之后加入：

```ts
/** 图标源自学习首选（失败驱动，无 UI 选择） */
iconLearned: IconProviderId
/** API 源自学习首选（失败驱动，无 UI 选择） */
apiLearned: ApiProviderId
```

在 `interface UIState` 的 action 区、`setCanvasTool` 之后加入：

```ts
  /** 写回图标自学习首选 */
  setIconLearned: (id: IconProviderId) => void
  /** 写回 API 自学习首选 */
  setApiLearned: (id: ApiProviderId) => void
```

在 `create` 初始 state 里、`canvasTool: 'pan',` 之后加入：

```ts
      iconLearned: DEFAULT_ICON_PROVIDER,
      apiLearned: DEFAULT_API_PROVIDER,
```

在 action 实现区、`setCanvasTool: tool => set({ canvasTool: tool }),` 之后加入：

```ts
      setIconLearned: id => set({ iconLearned: id }),

      setApiLearned: id => set({ apiLearned: id }),
```

> 说明：persist 的 `partialize` 只剔除 `theme / draggingId / manualLock`，`iconLearned` / `apiLearned` 落在 `...rest` 中，自动持久化，无需改 partialize。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test:run uiStore`
Expected: PASS（3 个新用例；已有用例不受影响）。

- [ ] **Step 5: 提交**

```bash
git add src/store/uiStore.ts src/store/uiStore.test.ts
git commit -m "feat(providers): uiStore 新增 iconLearned/apiLearned 自学习字段"
```

---

## Task 4: iconProvider（buildIconUrl + 换源 + 自学习）

**Files:**

- Create: `src/api/providers/iconProvider.ts`
- Test: `src/api/providers/iconProvider.test.ts`

**Interfaces:**

- Consumes: `ICON_PROVIDERS`、`DEFAULT_ICON_PROVIDER`、`IconProviderId`（Task 1）；`normalizeIcon`（Task 2）；`useUIStore`（Task 3）。
- Produces:
  - `const EMPTY_IMAGE: string`（1x1 透明 PNG data URI）
  - `buildIconUrl(input: string | number, provider?: IconProviderId): string` — 默认 provider = `useUIStore.getState().iconLearned`；`iconId <= 0` → `EMPTY_IMAGE`。
  - `getNextIconProvider(tried: IconProviderId[]): IconProviderId | undefined` — 按 `ICON_PROVIDERS` 顺序返回首个未试源。
  - `onIconSuccess(provider: IconProviderId): void` — 与当前 `iconLearned` 不同则写回。

- [ ] **Step 1: 写失败测试**

```ts
// src/api/providers/iconProvider.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useUIStore } from '@/store/uiStore'
import { EMPTY_IMAGE, buildIconUrl, getNextIconProvider, onIconSuccess } from './iconProvider'

describe('iconProvider', () => {
  beforeEach(() => useUIStore.setState({ iconLearned: 'cafemaker' }))

  it('显式 provider 拼 URL', () => {
    expect(buildIconUrl(3253, 'cafemaker')).toBe(
      'https://cafemaker.wakingsands.com/i/003000/003253.png'
    )
    expect(buildIconUrl(3253, 'rpglogs')).toBe(
      'https://assets.rpglogs.cn/img/ff/abilities/003000-003253.png'
    )
  })
  it('省略 provider 时用 iconLearned', () => {
    useUIStore.setState({ iconLearned: 'rpglogs' })
    expect(buildIconUrl('/i/003000/003253.png')).toBe(
      'https://assets.rpglogs.cn/img/ff/abilities/003000-003253.png'
    )
  })
  it('无法解析 → EMPTY_IMAGE', () => {
    expect(buildIconUrl('', 'cafemaker')).toBe(EMPTY_IMAGE)
    expect(buildIconUrl('abc', 'cafemaker')).toBe(EMPTY_IMAGE)
  })
  it('getNextIconProvider 按顺序返回未试源', () => {
    expect(getNextIconProvider([])).toBe('cafemaker')
    expect(getNextIconProvider(['cafemaker'])).toBe('xivapi-asset')
    expect(getNextIconProvider(['cafemaker', 'xivapi-asset'])).toBe('rpglogs')
    expect(getNextIconProvider(['cafemaker', 'xivapi-asset', 'rpglogs'])).toBeUndefined()
  })
  it('onIconSuccess 与当前不同才写回', () => {
    onIconSuccess('cafemaker')
    expect(useUIStore.getState().iconLearned).toBe('cafemaker')
    onIconSuccess('rpglogs')
    expect(useUIStore.getState().iconLearned).toBe('rpglogs')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:run iconProvider`
Expected: FAIL —「Cannot find module './iconProvider'」。

- [ ] **Step 3: 实现 iconProvider.ts**

```ts
// src/api/providers/iconProvider.ts
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test:run iconProvider`
Expected: PASS（5 个用例）。

- [ ] **Step 5: 提交**

```bash
git add src/api/providers/iconProvider.ts src/api/providers/iconProvider.test.ts
git commit -m "feat(providers): 新增 iconProvider（buildIconUrl/换源/自学习）"
```

---

## Task 5: apiProvider（requestWithFallback + 自学习）

**Files:**

- Create: `src/api/providers/apiProvider.ts`
- Test: `src/api/providers/apiProvider.test.ts`

**Interfaces:**

- Consumes: `API_PROVIDERS`、`ApiProviderId`（Task 1）；`useUIStore`（Task 3）。
- Produces:
  - `interface ApiResult<T> { data: T; provider: ApiProviderId }`
  - `requestWithFallback<T>(path: string, preferred?: ApiProviderId): Promise<ApiResult<T>>` — 首选优先、其余顺序回退；每次 6s 超时、`cache: 'force-cache'`；全失败 throw。
  - `onApiSuccess(provider: ApiProviderId): void` — 与当前 `apiLearned` 不同则写回。

- [ ] **Step 1: 写失败测试**

```ts
// src/api/providers/apiProvider.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useUIStore } from '@/store/uiStore'
import { requestWithFallback, onApiSuccess } from './apiProvider'

const okRes = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response
const badRes = () => ({ ok: false, status: 500, json: async () => ({}) }) as unknown as Response

describe('apiProvider', () => {
  beforeEach(() => useUIStore.setState({ apiLearned: 'xivcdn' }))
  afterEach(() => vi.unstubAllGlobals())

  it('首选成功返回 {data, provider}', async () => {
    const fetchMock = vi.fn(async () => okRes({ hello: 'world' }))
    vi.stubGlobal('fetch', fetchMock)
    const r = await requestWithFallback<{ hello: string }>('/sheet/Action/1')
    expect(r).toEqual({ data: { hello: 'world' }, provider: 'xivcdn' })
    expect(fetchMock.mock.calls[0][0]).toBe('https://xivapi-v2.xivcdn.com/api/sheet/Action/1')
  })

  it('首选失败回退到下一源', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(badRes())
      .mockResolvedValueOnce(okRes({ ok: 1 }))
    vi.stubGlobal('fetch', fetchMock)
    const r = await requestWithFallback('/x')
    expect(r.provider).toBe('xivapi')
    expect(fetchMock.mock.calls[1][0]).toBe('https://v2.xivapi.com/api/x')
  })

  it('preferred 参数决定首选顺序', async () => {
    const fetchMock = vi.fn(async () => okRes({ ok: 1 }))
    vi.stubGlobal('fetch', fetchMock)
    await requestWithFallback('/y', 'xivapi')
    expect(fetchMock.mock.calls[0][0]).toBe('https://v2.xivapi.com/api/y')
  })

  it('全部失败则抛错', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => badRes())
    )
    await expect(requestWithFallback('/z')).rejects.toThrow()
  })

  it('onApiSuccess 与当前不同才写回', () => {
    onApiSuccess('xivcdn')
    expect(useUIStore.getState().apiLearned).toBe('xivcdn')
    onApiSuccess('xivapi')
    expect(useUIStore.getState().apiLearned).toBe('xivapi')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:run apiProvider`
Expected: FAIL —「Cannot find module './apiProvider'」。

- [ ] **Step 3: 实现 apiProvider.ts**

```ts
// src/api/providers/apiProvider.ts
/**
 * API 链：直连 + 顺序回退 + 失败驱动自学习。
 * 源已实测返回 access-control-allow-origin: *，无需代理。
 */
import { API_PROVIDERS, type ApiProviderId } from './registry'
import { useUIStore } from '@/store/uiStore'

const TIMEOUT_MS = 6000

export interface ApiResult<T> {
  data: T
  provider: ApiProviderId
}

export async function requestWithFallback<T>(
  path: string,
  preferred: ApiProviderId = useUIStore.getState().apiLearned
): Promise<ApiResult<T>> {
  const ordered = [
    ...API_PROVIDERS.filter(p => p.id === preferred),
    ...API_PROVIDERS.filter(p => p.id !== preferred),
  ]
  for (const p of ordered) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
      const res = await fetch(p.base + path, { signal: controller.signal, cache: 'force-cache' })
      clearTimeout(timer)
      if (!res.ok) continue
      const data = (await res.json()) as T
      return { data, provider: p.id }
    } catch {
      // 超时 / 网络错误 → 试下一源
    }
  }
  throw new Error(`All API providers failed for ${path}`)
}

export function onApiSuccess(provider: ApiProviderId): void {
  const store = useUIStore.getState()
  if (store.apiLearned !== provider) store.setApiLearned(provider)
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test:run apiProvider`
Expected: PASS（5 个用例）。

- [ ] **Step 5: 提交**

```bash
git add src/api/providers/apiProvider.ts src/api/providers/apiProvider.test.ts
git commit -m "feat(providers): 新增 apiProvider（requestWithFallback/自学习）"
```

---

## Task 6: xivapi.ts 接入 requestWithFallback

**Files:**

- Modify: `src/api/xivapi.ts`
- Test: `src/api/xivapi.test.ts`

**Interfaces:**

- Consumes: `requestWithFallback`、`onApiSuccess`（Task 5）。
- Produces: `getActionById(actionId)` 行为不变（返回 `CafeMakerAction | null`），但改经 provider 回退；`CafeMakerAction.Icon` / `IconHD` 现在是**原始路径**（如 `ui/icon/002000/002645.tex`），交由下游 `normalizeIcon` 归一。

- [ ] **Step 1: 写失败测试**

```ts
// src/api/xivapi.test.ts
import { describe, it, expect, afterEach, vi } from 'vitest'
import { getActionById } from './xivapi'

const RESP = {
  row_id: 16536,
  fields: {
    Name: '深仁厚泽',
    Icon: { path: 'ui/icon/002000/002645.tex', path_hr1: 'ui/icon/002000/002645_hr1.tex' },
    ClassJobLevel: 30,
    Range: 30,
    EffectRange: 0,
    Cast100ms: 0,
    Recast100ms: 900,
    PrimaryCostType: 0,
    PrimaryCostValue: 0,
    ClassJob: { value: 1 },
  },
  transient: { 'Description@as(html)': '<p>desc</p>' },
}
const okRes = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response
const badRes = () => ({ ok: false, status: 500, json: async () => ({}) }) as unknown as Response

describe('getActionById', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('返回 CafeMakerAction，Icon 为原始路径', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okRes(RESP))
    )
    const action = await getActionById(16536)
    expect(action?.Name).toBe('深仁厚泽')
    expect(action?.Icon).toBe('ui/icon/002000/002645.tex')
    expect(action?.IconHD).toBe('ui/icon/002000/002645_hr1.tex')
  })

  it('全部源失败返回 null', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => badRes())
    )
    expect(await getActionById(16536)).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:run xivapi`
Expected: FAIL — `Icon` 仍是包装后的 `https://v2.xivapi.com/api/asset?...` URL，断言不符。

- [ ] **Step 3: 改 xivapi.ts**

删除第 6 行常量 `const XIVAPI_BASE_URL = ...`，在 import 区（文件顶部注释块之后）加入：

```ts
import { requestWithFallback, onApiSuccess } from './providers/apiProvider'
```

把 `toIconPath` 改为返回原始路径：

```ts
function toIconPath(path: string): string {
  // 返回原始路径，交由下游 normalizeIcon 归一 + provider 拼 URL
  return path
}
```

把 `getActionById` 整个函数体替换为：

```ts
export async function getActionById(actionId: number): Promise<CafeMakerAction | null> {
  try {
    const search = new URLSearchParams({
      fields: ACTION_FIELDS,
      transient: 'Description@as(html)',
    })
    const path = `/sheet/Action/${actionId}?${search.toString()}`
    const { data, provider } = await requestWithFallback<XIVAPIResponse>(path)
    onApiSuccess(provider)
    return convertResponse(actionId, data)
  } catch (error) {
    console.error(`Error fetching action ${actionId}:`, error)
    return null
  }
}
```

> `convertResponse` / `getActionsByIds` 不变。`toIconPath` 保留（现为恒等）以最小化 `convertResponse` 改动。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test:run xivapi`
Expected: PASS（2 个用例）。

- [ ] **Step 5: 提交**

```bash
git add src/api/xivapi.ts src/api/xivapi.test.ts
git commit -m "feat(providers): xivapi getActionById 走 requestWithFallback，Icon 归一为原始路径"
```

---

## Task 7: iconUtils / statusIconUtils 接入 buildIconUrl

**Files:**

- Modify: `src/utils/iconUtils.ts`
- Modify: `src/utils/statusIconUtils.ts`
- Test: `src/utils/statusIconUtils.test.ts`

**Interfaces:**

- Consumes: `buildIconUrl`（Task 4）。
- Produces: `getIconUrl(iconPath: string): string`（签名不变，内部走 `buildIconUrl`）；`getStatusIconUrl(statusId): string | undefined`（用 `buildIconUrl` 拼首选源）。

> 前置确认（Task 1 时已 grep）：`ICON_BASE_URL` / `FFLOGS_ICON_BASE_URL` 无 `iconUtils.ts` 之外的引用，可安全删除。

- [ ] **Step 1: 写失败测试**

```ts
// src/utils/statusIconUtils.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useUIStore } from '@/store/uiStore'
import { getStatusIconUrl, getStatusName } from './statusIconUtils'

describe('getStatusIconUrl', () => {
  beforeEach(() => useUIStore.setState({ iconLearned: 'cafemaker' }))

  it('已知 statusId 用首选源拼 URL', () => {
    // 麻痹 statusId=2（statusData[2] = [name, iconId, ...]）
    const url = getStatusIconUrl(2)
    expect(url).toMatch(/^https:\/\/cafemaker\.wakingsands\.com\/i\/\d{6}\/\d{6}\.png$/)
  })
  it('未知 statusId → undefined', () => {
    expect(getStatusIconUrl(999999999)).toBeUndefined()
    expect(getStatusName(999999999)).toBeUndefined()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:run statusIconUtils`
Expected: FAIL — 断言前先确认能 import；实现改动前 URL 仍来自旧硬编码（本用例应先失败于 import 或断言，视改动而定）。

> 若 statusId=2 在数据中不存在导致 `undefined`，改用任一存在的 statusId：`node -e "const s=require('./3rdparty/ff14-overlay-vue/src/resources/generated/status.json'); console.log(Object.keys(s).slice(0,5))"` 取一个真实 id 替换测试中的 `2`。

- [ ] **Step 3: 改 iconUtils.ts**

整个文件替换为：

```ts
/**
 * 图标 URL 工具（兼容旧签名，内部走 provider 链）
 */
import { buildIconUrl } from '@/api/providers/iconProvider'

/**
 * 拼接图标 URL：归一输入 → 用当前 iconLearned 首选源拼 URL。
 * @param iconPath 图标路径 / 数字 id / 完整旧 URL
 */
export function getIconUrl(iconPath: string): string {
  return buildIconUrl(iconPath)
}
```

- [ ] **Step 4: 改 statusIconUtils.ts**

把 import 行改为（去掉 `completeIcon`，新增 `buildIconUrl`）：

```ts
import { statusData } from '@/../3rdparty/ff14-overlay-vue/src/resources/logic/status'
import { buildIconUrl } from '@/api/providers/iconProvider'
```

把 `getStatusIconUrl` 函数体替换为：

```ts
export function getStatusIconUrl(statusId: number): string | undefined {
  const statusInfo = statusData[statusId]
  if (!statusInfo) return undefined
  return buildIconUrl(statusInfo[1]) // statusInfo[1] = 图标 ID
}
```

`getStatusName` 不变。

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm test:run statusIconUtils`
Expected: PASS（2 个用例）。

- [ ] **Step 6: 提交**

```bash
git add src/utils/iconUtils.ts src/utils/statusIconUtils.ts src/utils/statusIconUtils.test.ts
git commit -m "feat(providers): iconUtils/statusIconUtils 接入 buildIconUrl，删除硬编码 base"
```

---

## Task 8: useKonvaImage 接入回退 + 自学习

**Files:**

- Modify: `src/utils/useKonvaImage.ts`
- Test: `src/utils/useKonvaImage.test.tsx`

**Interfaces:**

- Consumes: `buildIconUrl`、`getNextIconProvider`、`onIconSuccess`（Task 4）；`normalizeIcon`（Task 2）；`IconProviderId`（Task 1）；`useUIStore`（Task 3）。
- Produces: `useKonvaImage(iconPath): HTMLImageElement | null`（签名不变，内部按 provider 顺序换源，加载成功写回 learned）；`preloadIcons(iconPaths): Promise<Map<...>>`（签名不变，用 `buildIconUrl` 首选源，不做逐源回退）。

- [ ] **Step 1: 写失败测试（jsdom + 可控 Image mock）**

```tsx
// src/utils/useKonvaImage.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useUIStore } from '@/store/uiStore'
import { useKonvaImage } from './useKonvaImage'

// 可控 Image：记录 src 赋值，手动触发 onload/onerror
class FakeImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  private _src = ''
  static instances: FakeImage[] = []
  constructor() {
    FakeImage.instances.push(this)
  }
  set src(v: string) {
    this._src = v
  }
  get src() {
    return this._src
  }
}

beforeEach(() => {
  FakeImage.instances = []
  useUIStore.setState({ iconLearned: 'cafemaker' })
  vi.stubGlobal('Image', FakeImage as unknown as typeof Image)
})
afterEach(() => vi.unstubAllGlobals())

describe('useKonvaImage 回退', () => {
  it('首源 error 后换到下一源；下一源 load 成功写回 learned', () => {
    const { result } = renderHook(() => useKonvaImage('/i/003000/003253.png'))
    const img = FakeImage.instances[0]
    expect(img.src).toBe('https://cafemaker.wakingsands.com/i/003000/003253.png')

    act(() => img.onerror?.())
    expect(img.src).toBe(
      'https://v2.xivapi.com/api/asset?path=ui/icon/003000/003253.tex&format=png'
    )

    act(() => img.onload?.())
    expect(result.current).toBe(img as unknown as HTMLImageElement)
    expect(useUIStore.getState().iconLearned).toBe('xivapi-asset')
  })

  it('全部源 error → image 为 null', () => {
    const { result } = renderHook(() => useKonvaImage('/i/003000/003253.png'))
    const img = FakeImage.instances[0]
    act(() => img.onerror?.()) // → xivapi-asset
    act(() => img.onerror?.()) // → rpglogs
    act(() => img.onerror?.()) // 全试尽
    expect(result.current).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:run useKonvaImage`
Expected: FAIL — 旧实现只 `getIconUrl` 一次、error 直接 setImage(null)，不换源。

- [ ] **Step 3: 改 useKonvaImage.ts**

把 import 区替换为：

```ts
import { useState, useEffect } from 'react'
import { buildIconUrl, getNextIconProvider, onIconSuccess } from '@/api/providers/iconProvider'
import { useUIStore } from '@/store/uiStore'
import type { IconProviderId } from '@/api/providers/registry'
```

把 `useKonvaImage` 的 `useEffect` 整体替换为：

```ts
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
```

把 `preloadIcons` 里两处 `img.src = getIconUrl(path)` 改为 `img.src = buildIconUrl(path)`，并删除对 `getIconUrl` 的 import（已在上面 import 区移除）。`preloadIcons` 其余逻辑不变（预加载不做逐源回退，失败即跳过）。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test:run useKonvaImage`
Expected: PASS（2 个用例）。

- [ ] **Step 5: 提交**

```bash
git add src/utils/useKonvaImage.ts src/utils/useKonvaImage.test.tsx
git commit -m "feat(providers): useKonvaImage 按 provider 顺序换源 + 加载成功自学习"
```

---

## Task 9: GameIcon 组件

**Files:**

- Create: `src/components/GameIcon.tsx`
- Test: `src/components/GameIcon.test.tsx`

**Interfaces:**

- Consumes: `normalizeIcon`（Task 2）；`buildIconUrl`、`getNextIconProvider`、`onIconSuccess`、`EMPTY_IMAGE`（Task 4）；`useUIStore`（Task 3）；`IconProviderId`（Task 1）。
- Produces: `GameIcon` 组件，props = `{ input: string | number } & Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'>`。渲染 `<img>`：初始首选源、`onError` 顺序换源、`onLoad` 写回 learned、`data-icon-id` 标注、透传其余 img 属性（`className`/`alt`/`onMouseEnter` 等）。

- [ ] **Step 1: 写失败测试（jsdom）**

```tsx
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:run GameIcon`
Expected: FAIL —「Cannot find module './GameIcon'」。

- [ ] **Step 3: 实现 GameIcon.tsx**

```tsx
// src/components/GameIcon.tsx
import { useEffect, useState, type ImgHTMLAttributes } from 'react'
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
    provider: IconProviderId
    tried: IconProviderId[]
    failed: boolean
  }>(() => ({ provider: learned, tried: [learned], failed: false }))

  // input 变化（组件复用）时重置换源进度
  useEffect(() => {
    const start = useUIStore.getState().iconLearned
    setState({ provider: start, tried: [start], failed: false })
  }, [iconId])

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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test:run GameIcon`
Expected: PASS（4 个用例）。

- [ ] **Step 5: 提交**

```bash
git add src/components/GameIcon.tsx src/components/GameIcon.test.tsx
git commit -m "feat(providers): 新增 GameIcon 组件（首选源/换源/自学习/占位）"
```

---

## Task 10: 7 个 `<img>` 站点切换到 GameIcon

**Files:**

- Modify: `src/components/ActionTooltip.tsx`
- Modify: `src/components/StatDataDialog.tsx`
- Modify: `src/components/ExportSoumaDialog.tsx`
- Modify: `src/components/Timeline/SkillTrackLabels.tsx`
- Modify: `src/components/FilterMenu/EditPresetDialog.tsx`
- Modify: `src/components/TimelineTable/TableDataRow.tsx`
- Modify: `src/components/TimelineTable/TableHeader.tsx`

**Interfaces:**

- Consumes: `GameIcon`（Task 9）。
- 说明：每个文件把 `<img src={getIconUrl(EXPR)} .../>` 换成 `<GameIcon input={EXPR} .../>`，删除现存的 `onError={e => { e.currentTarget.style.display = 'none' }}` 兜底（GameIcon 已内建换源 + EMPTY_IMAGE 占位），并删除该文件对 `getIconUrl` 的 import（每个文件仅此一处用它）、加上 `import { GameIcon } from '@/components/GameIcon'`。

- [ ] **Step 1: ActionTooltip.tsx**

删除 `import { getIconUrl } from '@/utils/iconUtils'`，加 `import { GameIcon } from '@/components/GameIcon'`。将：

```tsx
<img
  src={getIconUrl(apiData.Icon || displayedAction.icon)}
  alt={apiData.Name || displayedAction.name}
  className="w-full h-full object-cover"
/>
```

替换为：

```tsx
<GameIcon
  input={apiData.Icon || displayedAction.icon}
  alt={apiData.Name || displayedAction.name}
  className="w-full h-full object-cover"
/>
```

- [ ] **Step 2: StatDataDialog.tsx**

删 `getIconUrl` import、加 `GameIcon` import。将：

```tsx
<img src={getIconUrl(action.iconHD || action.icon)} alt={action.name} className="w-7 h-7 rounded" />
```

替换为：

```tsx
<GameIcon input={action.iconHD || action.icon} alt={action.name} className="w-7 h-7 rounded" />
```

- [ ] **Step 3: ExportSoumaDialog.tsx**

删 `getIconUrl` import、加 `GameIcon` import。将：

```tsx
<img src={getIconUrl(action.icon)} alt="" className="h-full w-full object-cover" />
```

替换为：

```tsx
<GameIcon input={action.icon} alt="" className="h-full w-full object-cover" />
```

- [ ] **Step 4: EditPresetDialog.tsx**

删 `getIconUrl` import、加 `GameIcon` import。将：

```tsx
<img src={getIconUrl(action.icon)} alt="" className="h-full w-full object-cover" />
```

替换为：

```tsx
<GameIcon input={action.icon} alt="" className="h-full w-full object-cover" />
```

- [ ] **Step 5: SkillTrackLabels.tsx**（删除 display:none 兜底）

删 `getIconUrl` import、加 `GameIcon` import。将：

```tsx
<img
  src={getIconUrl(track.actionIcon)}
  alt={track.actionName}
  className="w-6 h-6 rounded cursor-pointer"
  onError={e => {
    e.currentTarget.style.display = 'none'
  }}
  onMouseEnter={e => {
    if (action) onHoverAction(action, e.currentTarget.getBoundingClientRect())
  }}
  onMouseLeave={onUnhoverAction}
  onClick={e => {
    if (action) onClickAction(action, e.currentTarget.getBoundingClientRect())
  }}
/>
```

替换为：

```tsx
<GameIcon
  input={track.actionIcon}
  alt={track.actionName}
  className="w-6 h-6 rounded cursor-pointer"
  onMouseEnter={e => {
    if (action) onHoverAction(action, e.currentTarget.getBoundingClientRect())
  }}
  onMouseLeave={onUnhoverAction}
  onClick={e => {
    if (action) onClickAction(action, e.currentTarget.getBoundingClientRect())
  }}
/>
```

- [ ] **Step 6: TableDataRow.tsx**（删除 display:none 兜底）

删 `getIconUrl` import、加 `GameIcon` import。将：

```tsx
<img
  src={getIconUrl(markerAction?.icon ?? track.actionIcon)}
  alt={markerAction?.name ?? track.actionName}
  className="pointer-events-none absolute top-1/2 left-1/2 w-6 h-6 -translate-x-1/2 -translate-y-1/2 rounded-sm shadow-md"
  onError={e => {
    e.currentTarget.style.display = 'none'
  }}
/>
```

替换为：

```tsx
<GameIcon
  input={markerAction?.icon ?? track.actionIcon}
  alt={markerAction?.name ?? track.actionName}
  className="pointer-events-none absolute top-1/2 left-1/2 w-6 h-6 -translate-x-1/2 -translate-y-1/2 rounded-sm shadow-md"
/>
```

- [ ] **Step 7: TableHeader.tsx**（删除 display:none 兜底，保留 hover/click）

删 `getIconUrl` import、加 `GameIcon` import。将 `<img` 起始标签改为 `<GameIcon`，把 `src={getIconUrl(track.actionIcon)}` 改为 `input={track.actionIcon}`，删除紧随其后的：

```tsx
                  onError={e => {
                    e.currentTarget.style.display = 'none'
                  }}
```

其余 `onMouseEnter` / `onMouseLeave` / `onClick` 属性及 `/>` 收尾保持不变。改后开头形如：

```tsx
                <GameIcon
                  input={track.actionIcon}
                  alt={track.actionName}
                  className="w-6 h-6 rounded cursor-pointer"
                  onMouseEnter={e => {
```

- [ ] **Step 8: 全量校验**

Run:

```bash
pnpm exec tsc --noEmit
pnpm lint
pnpm test:run
pnpm build
```

Expected: 四者均通过（tsc 无错、lint 无错、全部测试 PASS、build 成功）。

- [ ] **Step 9: 提交**

```bash
git add src/components/ActionTooltip.tsx src/components/StatDataDialog.tsx src/components/ExportSoumaDialog.tsx src/components/Timeline/SkillTrackLabels.tsx src/components/FilterMenu/EditPresetDialog.tsx src/components/TimelineTable/TableDataRow.tsx src/components/TimelineTable/TableHeader.tsx
git commit -m "feat(providers): 7 个图标 <img> 站点切换到 GameIcon 统一回退"
```

---

## 完成标准

- [ ] `src/api/providers/` 四个模块 + 测试齐备，全部 PASS。
- [ ] `uiStore` 有 `iconLearned` / `apiLearned` 且随 persist 持久化。
- [ ] API 请求经 `requestWithFallback` 两源直连回退，成功写回 `apiLearned`。
- [ ] icon（`<img>` 与 Konva）均经 provider 链，onError 顺序换源（cafemaker → xivapi-asset → rpglogs），onLoad 写回 `iconLearned`。
- [ ] 无任何选源 UI，`EditorToolbar` 与 `src/workers/` 未改动。
- [ ] `pnpm exec tsc --noEmit`、`pnpm lint`、`pnpm test:run`、`pnpm build` 全绿。

## 手动验收（实现后）

1. 清空 localStorage 打开编辑器，导入一份 FFLogs 报告 → 技能/状态图标正常显示（走 cafemaker）。
2. DevTools Network 屏蔽 `cafemaker.wakingsands.com` → 图标自动回退到 `v2.xivapi.com`，刷新后 `ui-store` 里 `iconLearned` 变为 `xivapi-asset`。
3. 再屏蔽 `v2.xivapi.com` → 回退到 `assets.rpglogs.cn`。
4. 屏蔽 `xivapi-v2.xivcdn.com` 的 API 请求 → 技能详情仍能加载（回退到 `v2.xivapi.com`），`apiLearned` 变为 `xivapi`。
