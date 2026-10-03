# EdgeOne 回源 IP 网段自动同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `healerbook` Worker 中新增每日 cron，把 Cloudflare IP 列表 `edgeone` 与腾讯云 EdgeOne 回源 IP 网段自动对齐，并在有新版本时调用 `ConfirmOriginACLUpdate`。

**Architecture:** `src/workers/edgeoneOriginSync/` 下四个文件：`sync.ts`（CIDR 标准化 / 目标集合 / 差异计算等纯函数 + 依赖注入的编排函数）、`tencentCloud.ts`（TC3-HMAC-SHA256 签名 + `callTeo`）、`cloudflareLists.ts`（Cloudflare Lists API 客户端，含批量操作轮询）、`index.ts`（从 `Env` 读配置、组装真实依赖、兜错打日志）。`scheduled.ts` 新增 cron 分支调用 `runEdgeOneOriginSync`。

**Tech Stack:** Cloudflare Workers（Web Crypto、`fetch`）、TypeScript 5.9、Vitest 4（node 环境，`crypto.subtle` 与 `Response` 为全局）

**Spec:** `design/superpowers/specs/2026-09-14-edgeone-origin-acl-sync-design.md`

## Global Constraints

- 不引入任何新依赖（不用腾讯云 / Cloudflare SDK），签名用 Web Crypto `crypto.subtle`。
- cron 表达式：`"0 3 * * *"`（UTC 03:00，每天一次），加在 `wrangler.toml` 顶层 `[triggers] crons`。
- 腾讯云：`Host` `teo.tencentcloudapi.com`、`X-TC-Version` `2022-09-01`、`Content-Type` `application/json`、`SignedHeaders` `content-type;host`，不传 `X-TC-Region`。
- production vars：`EDGEONE_ZONE_ID = "zone-3q0wz2up03uy"`、`CF_ACCOUNT_ID = "b35d3e7a2fdaf5712fa29ea9a32c6c9a"`、`CF_EDGEONE_LIST_ID = "0681de725731434689c4240e6a254b09"`。
- secrets：`TENCENTCLOUD_SECRET_ID`、`TENCENTCLOUD_SECRET_KEY`、`CF_LISTS_API_TOKEN`（由用户创建，计划内不创建）。
- 日志前缀统一 `[EdgeOne Sync]`；配置缺失时 `console.warn('[EdgeOne Sync] 配置缺失，跳过')`。
- 安全闸：Current 地址总数为 0、任一网段非法、目标集合 < 现有条目数 × 0.5 时中止，不写 Cloudflare、不确认。
- 先加后删；Cloudflare 批量操作串行；轮询默认 30 次 × 2000ms。
- 新增条目 `comment` 为 `EdgeOne <version>`，网段同时属于两个版本时取 current 版本号。
- 在 Workers 中不要把全局 `fetch` 存成对象属性再以 `obj.fetch()` 方式调用（会触发 `Illegal invocation`），一律先取到局部变量 `const fetchImpl = ... ?? fetch` 再 `fetchImpl(...)`。
- 提交信息、作者、trailer 中不得出现 "Claude" 字样（commit-msg hook 会拒绝），不加 Co-Authored-By。
- 每个任务结束前：`pnpm test:run src/workers/edgeoneOriginSync`、`pnpm exec tsc --noEmit`、`pnpm lint` 均通过。

---

## File Structure

| 文件                                                    | 操作   | 职责                                                                                                         |
| ------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------ |
| `src/workers/edgeoneOriginSync/sync.ts`                 | Create | 领域类型、`normalizeCidr` / `computeTargetSet` / `getNextVersion` / `diffItems`、`syncEdgeOneOriginAcl` 编排 |
| `src/workers/edgeoneOriginSync/sync.test.ts`            | Create | 纯函数与编排测试                                                                                             |
| `src/workers/edgeoneOriginSync/tencentCloud.ts`         | Create | `buildTc3Authorization`、`callTeo`                                                                           |
| `src/workers/edgeoneOriginSync/tencentCloud.test.ts`    | Create | 签名向量与请求测试                                                                                           |
| `src/workers/edgeoneOriginSync/cloudflareLists.ts`      | Create | `createCloudflareListsClient`                                                                                |
| `src/workers/edgeoneOriginSync/cloudflareLists.test.ts` | Create | 翻页、批量操作轮询测试                                                                                       |
| `src/workers/edgeoneOriginSync/index.ts`                | Create | `runEdgeOneOriginSync(env)`                                                                                  |
| `src/workers/edgeoneOriginSync/index.test.ts`           | Create | 配置缺失跳过、失败兜错                                                                                       |
| `src/workers/env.ts`                                    | Modify | `Env` 增加 6 个可选字段                                                                                      |
| `src/workers/scheduled.ts`                              | Modify | 新增 `'0 3 * * *'` 分支                                                                                      |
| `wrangler.toml`                                         | Modify | 顶层 crons 追加；`[env.production.vars]` 增加 3 个变量                                                       |
| `src/workers/README.md`                                 | Modify | 目录结构与 secrets 说明                                                                                      |

---

### Task 1: CIDR 标准化、目标集合与差异计算（纯函数）

**Files:**

- Create: `src/workers/edgeoneOriginSync/sync.ts`
- Test: `src/workers/edgeoneOriginSync/sync.test.ts`

**Interfaces:**

- Consumes: 无
- Produces（后续任务依赖的精确签名）：

  ```ts
  export interface OriginAclAddresses {
    IPv4: string[]
    IPv6: string[]
  }
  export interface OriginAclVersion {
    Version: string
    EntireAddresses: OriginAclAddresses
  }
  export interface OriginAclInfo {
    CurrentOriginACL: OriginAclVersion
    NextOriginACL?: OriginAclVersion | null
  }
  export interface ListItem {
    id: string
    ip: string
  }
  export interface NewListItem {
    ip: string
    comment: string
  }
  export function normalizeCidr(input: string): string
  export function countCidrs(version: OriginAclVersion | null | undefined): number
  export function getNextVersion(info: OriginAclInfo): OriginAclVersion | null
  export function computeTargetSet(info: OriginAclInfo): Map<string, string> // 标准化 CIDR -> 版本号
  export function diffItems(
    existing: ListItem[],
    target: Map<string, string>
  ): { toAdd: NewListItem[]; toRemove: string[] }
  ```

- [ ] **Step 1: 写失败测试**

创建 `src/workers/edgeoneOriginSync/sync.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { normalizeCidr, computeTargetSet, diffItems, type OriginAclVersion } from './sync'

const version = (v: string, IPv4: string[], IPv6: string[] = []): OriginAclVersion => ({
  Version: v,
  EntireAddresses: { IPv4, IPv6 },
})

describe('normalizeCidr', () => {
  it('保持标准 IPv4 CIDR 不变', () => {
    expect(normalizeCidr('43.168.0.0/16')).toBe('43.168.0.0/16')
  })

  it('IPv4 主机位清零', () => {
    expect(normalizeCidr('43.168.12.34/16')).toBe('43.168.0.0/16')
  })

  it('无前缀的地址视为单主机', () => {
    expect(normalizeCidr('1.2.3.4')).toBe('1.2.3.4/32')
    expect(normalizeCidr('2402:4e00::1')).toBe('2402:4e00::1/128')
  })

  it('IPv6 压缩并转小写', () => {
    expect(normalizeCidr('2402:4E00:0037:0000:0000:0000:0000:0000/48')).toBe('2402:4e00:37::/48')
    expect(normalizeCidr('2408:8719:2000:1::/64')).toBe('2408:8719:2000:1::/64')
  })

  it('IPv6 主机位清零', () => {
    expect(normalizeCidr('2402:4e00:c031:7fd:1::/64')).toBe('2402:4e00:c031:7fd::/64')
  })

  it('IPv6 最长连续零组并列时压缩最左侧', () => {
    expect(normalizeCidr('1:0:0:2:0:0:3:4/128')).toBe('1::2:0:0:3:4/128')
  })

  it('IPv6 单个零组不压缩', () => {
    expect(normalizeCidr('1:2:3:4:5:6:0:8/128')).toBe('1:2:3:4:5:6:0:8/128')
  })

  it('非法输入抛错', () => {
    for (const bad of [
      '',
      'abc',
      '1.2.3/24',
      '256.0.0.0/8',
      '1.2.3.4/33',
      '1.2.3.4/',
      '2402::4e00::/48',
      '2402:4e00::/129',
      '1.2.3.4/24/1',
    ]) {
      expect(() => normalizeCidr(bad), bad).toThrow()
    }
  })
})

describe('computeTargetSet', () => {
  it('无新版本时只取当前版本', () => {
    const target = computeTargetSet({
      CurrentOriginACL: version('v3', ['1.1.1.0/24'], ['2402:4e00:37::/48']),
      NextOriginACL: null,
    })
    expect([...target]).toEqual([
      ['1.1.1.0/24', 'v3'],
      ['2402:4e00:37::/48', 'v3'],
    ])
  })

  it('有新版本时取并集，共有网段归属当前版本', () => {
    const target = computeTargetSet({
      CurrentOriginACL: version('v3', ['1.1.1.0/24', '2.2.2.0/24']),
      NextOriginACL: version('v4', ['2.2.2.0/24', '3.3.3.0/24']),
    })
    expect([...target]).toEqual([
      ['1.1.1.0/24', 'v3'],
      ['2.2.2.0/24', 'v3'],
      ['3.3.3.0/24', 'v4'],
    ])
  })

  it('NextOriginACL 地址为空时视为无新版本', () => {
    const target = computeTargetSet({
      CurrentOriginACL: version('v3', ['1.1.1.0/24']),
      NextOriginACL: version('', []),
    })
    expect([...target.keys()]).toEqual(['1.1.1.0/24'])
  })

  it('按标准化结果去重', () => {
    const target = computeTargetSet({
      CurrentOriginACL: version('v3', ['1.1.1.0/24', '1.1.1.9/24']),
    })
    expect([...target.keys()]).toEqual(['1.1.1.0/24'])
  })

  it('任一网段非法时抛错', () => {
    expect(() =>
      computeTargetSet({ CurrentOriginACL: version('v3', ['1.1.1.0/24', 'bogus']) })
    ).toThrow()
  })
})

describe('diffItems', () => {
  const target = new Map([
    ['1.1.1.0/24', 'v3'],
    ['3.3.3.0/24', 'v4'],
  ])

  it('计算新增与删除', () => {
    const { toAdd, toRemove } = diffItems(
      [
        { id: 'a', ip: '1.1.1.0/24' },
        { id: 'b', ip: '2.2.2.0/24' },
      ],
      target
    )
    expect(toAdd).toEqual([{ ip: '3.3.3.0/24', comment: 'EdgeOne v4' }])
    expect(toRemove).toEqual(['b'])
  })

  it('比较前先标准化，已一致时无差异', () => {
    const { toAdd, toRemove } = diffItems(
      [
        { id: 'a', ip: '1.1.1.0/24' },
        { id: 'c', ip: '3.3.3.7/24' },
      ],
      target
    )
    expect(toAdd).toEqual([])
    expect(toRemove).toEqual([])
  })

  it('重复条目只保留第一个', () => {
    const { toAdd, toRemove } = diffItems(
      [
        { id: 'a', ip: '1.1.1.0/24' },
        { id: 'a2', ip: '1.1.1.0/24' },
        { id: 'c', ip: '3.3.3.0/24' },
      ],
      target
    )
    expect(toAdd).toEqual([])
    expect(toRemove).toEqual(['a2'])
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test:run src/workers/edgeoneOriginSync/sync.test.ts`
Expected: FAIL，报 `Failed to resolve import "./sync"` 或类似模块不存在错误。

- [ ] **Step 3: 实现**

创建 `src/workers/edgeoneOriginSync/sync.ts`：

```ts
/**
 * EdgeOne 回源 IP 网段 → Cloudflare IP 列表同步：领域类型与纯函数
 *
 * 设计见 design/superpowers/specs/2026-09-14-edgeone-origin-acl-sync-design.md
 */

export interface OriginAclAddresses {
  IPv4: string[]
  IPv6: string[]
}

export interface OriginAclVersion {
  Version: string
  EntireAddresses: OriginAclAddresses
}

/** DescribeOriginACL 响应中 OriginACLInfo 的所需子集 */
export interface OriginAclInfo {
  CurrentOriginACL: OriginAclVersion
  NextOriginACL?: OriginAclVersion | null
}

/** Cloudflare IP 列表中已存在的条目 */
export interface ListItem {
  id: string
  ip: string
}

/** 待追加到 Cloudflare IP 列表的条目 */
export interface NewListItem {
  ip: string
  comment: string
}

function parseIpv4(addr: string): bigint | null {
  const parts = addr.split('.')
  if (parts.length !== 4) return null
  let value = 0n
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255) return null
    value = (value << 8n) | BigInt(Number(part))
  }
  return value
}

function parseIpv6(addr: string): bigint | null {
  const halves = addr.split('::')
  if (halves.length > 2) return null
  const toGroups = (s: string) => (s === '' ? [] : s.split(':'))
  const head = toGroups(halves[0])
  const tail = halves.length === 2 ? toGroups(halves[1]) : []
  const missing = 8 - head.length - tail.length
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null
  const groups = [...head, ...Array<string>(missing).fill('0'), ...tail]
  let value = 0n
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null
    value = (value << 16n) | BigInt(parseInt(group, 16))
  }
  return value
}

function formatIpv4(value: bigint): string {
  return [24n, 16n, 8n, 0n].map(shift => ((value >> shift) & 0xffn).toString()).join('.')
}

/** RFC 5952：去前导零、小写、压缩最长（≥2 组，并列取最左）的连续零组 */
function formatIpv6(value: bigint): string {
  const groups = Array.from({ length: 8 }, (_, i) =>
    Number((value >> BigInt((7 - i) * 16)) & 0xffffn)
  )
  let bestStart = -1
  let bestLen = 0
  for (let i = 0; i < 8; ) {
    if (groups[i] !== 0) {
      i++
      continue
    }
    let j = i
    while (j < 8 && groups[j] === 0) j++
    if (j - i > bestLen) {
      bestStart = i
      bestLen = j - i
    }
    i = j
  }
  const hex = groups.map(g => g.toString(16))
  if (bestLen < 2) return hex.join(':')
  return `${hex.slice(0, bestStart).join(':')}::${hex.slice(bestStart + bestLen).join(':')}`
}

/** 标准化为「网络地址/前缀」；无前缀视为单主机；非法输入抛错 */
export function normalizeCidr(input: string): string {
  const segments = input.trim().split('/')
  if (segments.length > 2) throw new Error(`非法 CIDR: ${input}`)
  const [addr, prefixStr] = segments
  const isV6 = addr.includes(':')
  const bits = isV6 ? 128 : 32
  const value = isV6 ? parseIpv6(addr) : parseIpv4(addr)
  if (value === null) throw new Error(`非法 CIDR: ${input}`)
  let prefix = bits
  if (prefixStr !== undefined) {
    if (!/^\d{1,3}$/.test(prefixStr) || Number(prefixStr) > bits) {
      throw new Error(`非法 CIDR: ${input}`)
    }
    prefix = Number(prefixStr)
  }
  const hostBits = BigInt(bits - prefix)
  const network = (value >> hostBits) << hostBits
  return `${isV6 ? formatIpv6(network) : formatIpv4(network)}/${prefix}`
}

function allCidrs(version: OriginAclVersion | null | undefined): string[] {
  return [...(version?.EntireAddresses?.IPv4 ?? []), ...(version?.EntireAddresses?.IPv6 ?? [])]
}

export function countCidrs(version: OriginAclVersion | null | undefined): number {
  return allCidrs(version).length
}

/** NextOriginACL 存在且含地址时才视为有待生效的新版本 */
export function getNextVersion(info: OriginAclInfo): OriginAclVersion | null {
  const next = info.NextOriginACL
  return next && countCidrs(next) > 0 ? next : null
}

/** 目标集合：current ∪ next（若有），key 为标准化 CIDR，value 为所属版本号（共有时取 current） */
export function computeTargetSet(info: OriginAclInfo): Map<string, string> {
  const target = new Map<string, string>()
  const versions = [info.CurrentOriginACL, getNextVersion(info)]
  for (const version of versions) {
    if (!version) continue
    for (const cidr of allCidrs(version)) {
      const key = normalizeCidr(cidr)
      if (!target.has(key)) target.set(key, version.Version)
    }
  }
  return target
}

/** 计算需追加的条目与需删除的条目 id；现有重复条目只保留第一个 */
export function diffItems(
  existing: ListItem[],
  target: Map<string, string>
): { toAdd: NewListItem[]; toRemove: string[] } {
  const kept = new Set<string>()
  const toRemove: string[] = []
  for (const item of existing) {
    const cidr = normalizeCidr(item.ip)
    if (target.has(cidr) && !kept.has(cidr)) kept.add(cidr)
    else toRemove.push(item.id)
  }
  const toAdd = [...target]
    .filter(([cidr]) => !kept.has(cidr))
    .map(([cidr, version]) => ({ ip: cidr, comment: `EdgeOne ${version}` }))
  return { toAdd, toRemove }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test:run src/workers/edgeoneOriginSync/sync.test.ts`
Expected: PASS（全部用例通过）

- [ ] **Step 5: 类型检查与 lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: 无错误。若 `bigint` 字面量报 target 过低，检查 `tsconfig.app.json` 的 `target`（应为 ES2020+，项目为 ES2022）。

- [ ] **Step 6: Commit**

```bash
git add src/workers/edgeoneOriginSync/sync.ts src/workers/edgeoneOriginSync/sync.test.ts
git commit -m "feat(edgeone-sync): CIDR 标准化与回源网段差异计算"
```

---

### Task 2: 同步编排 `syncEdgeOneOriginAcl`

**Files:**

- Modify: `src/workers/edgeoneOriginSync/sync.ts`（文件末尾追加）
- Test: `src/workers/edgeoneOriginSync/sync.test.ts`（文件末尾追加）

**Interfaces:**

- Consumes: Task 1 的 `OriginAclInfo`、`ListItem`、`NewListItem`、`normalizeCidr`、`countCidrs`、`getNextVersion`、`computeTargetSet`、`diffItems`
- Produces:

  ```ts
  export interface SyncDeps {
    describeOriginAcl(): Promise<OriginAclInfo | null>
    confirmOriginAclUpdate(): Promise<void>
    listItems(): Promise<ListItem[]>
    addItems(items: NewListItem[]): Promise<void>
    removeItems(ids: string[]): Promise<void>
  }
  export interface SyncResult {
    currentVersion: string
    nextVersion: string | null
    targetCount: number
    added: number
    removed: number
    confirmed: boolean
  }
  export const MIN_TARGET_RATIO: number // 0.5
  export function syncEdgeOneOriginAcl(deps: SyncDeps): Promise<SyncResult>
  ```

- [ ] **Step 1: 写失败测试**

在 `sync.test.ts` 顶部 import 改为：

```ts
import { describe, it, expect, vi } from 'vitest'
import {
  normalizeCidr,
  computeTargetSet,
  diffItems,
  syncEdgeOneOriginAcl,
  type ListItem,
  type OriginAclInfo,
  type OriginAclVersion,
  type SyncDeps,
} from './sync'
```

文件末尾追加：

```ts
function createFakeDeps(info: OriginAclInfo | null, initial: ListItem[]) {
  let items = [...initial]
  let nextId = 0
  const calls: string[] = []
  const deps = {
    describeOriginAcl: vi.fn(async () => {
      calls.push('describe')
      return info
    }),
    confirmOriginAclUpdate: vi.fn(async () => {
      calls.push('confirm')
    }),
    listItems: vi.fn(async () => {
      calls.push('list')
      return items.map(item => ({ ...item }))
    }),
    addItems: vi.fn(async (added: { ip: string; comment: string }[]) => {
      calls.push('add')
      items = [...items, ...added.map(a => ({ id: `new-${nextId++}`, ip: a.ip }))]
    }),
    removeItems: vi.fn(async (ids: string[]) => {
      calls.push('remove')
      items = items.filter(item => !ids.includes(item.id))
    }),
  } satisfies SyncDeps
  return { deps, calls }
}

describe('syncEdgeOneOriginAcl', () => {
  it('有新版本：先加后删，回读校验后确认', async () => {
    const { deps, calls } = createFakeDeps(
      {
        CurrentOriginACL: version('v3', ['1.1.1.0/24', '2.2.2.0/24']),
        NextOriginACL: version('v4', ['2.2.2.0/24', '3.3.3.0/24']),
      },
      [
        { id: 'a', ip: '1.1.1.0/24' },
        { id: 'b', ip: '2.2.2.0/24' },
        { id: 'z', ip: '9.9.9.0/24' },
      ]
    )
    const result = await syncEdgeOneOriginAcl(deps)
    expect(calls).toEqual(['describe', 'list', 'add', 'remove', 'list', 'confirm'])
    expect(deps.addItems).toHaveBeenCalledWith([{ ip: '3.3.3.0/24', comment: 'EdgeOne v4' }])
    expect(deps.removeItems).toHaveBeenCalledWith(['z'])
    expect(result).toEqual({
      currentVersion: 'v3',
      nextVersion: 'v4',
      targetCount: 3,
      added: 1,
      removed: 1,
      confirmed: true,
    })
  })

  it('无新版本：删除旧网段且不确认', async () => {
    const { deps, calls } = createFakeDeps(
      { CurrentOriginACL: version('v4', ['2.2.2.0/24', '3.3.3.0/24']), NextOriginACL: null },
      [
        { id: 'a', ip: '1.1.1.0/24' },
        { id: 'b', ip: '2.2.2.0/24' },
        { id: 'c', ip: '3.3.3.0/24' },
      ]
    )
    const result = await syncEdgeOneOriginAcl(deps)
    expect(calls).toEqual(['describe', 'list', 'remove', 'list'])
    expect(result.confirmed).toBe(false)
    expect(result.nextVersion).toBeNull()
    expect(result.removed).toBe(1)
  })

  it('无差异时不写入；有新版本仍确认', async () => {
    const { deps, calls } = createFakeDeps(
      {
        CurrentOriginACL: version('v3', ['1.1.1.0/24']),
        NextOriginACL: version('v4', ['2.2.2.0/24']),
      },
      [
        { id: 'a', ip: '1.1.1.0/24' },
        { id: 'b', ip: '2.2.2.0/24' },
      ]
    )
    const result = await syncEdgeOneOriginAcl(deps)
    expect(calls).toEqual(['describe', 'list', 'confirm'])
    expect(result).toMatchObject({ added: 0, removed: 0, confirmed: true })
  })

  it('OriginACLInfo 为空或当前版本无地址时中止', async () => {
    for (const info of [null, { CurrentOriginACL: version('v3', []) }]) {
      const { deps } = createFakeDeps(info, [{ id: 'a', ip: '1.1.1.0/24' }])
      await expect(syncEdgeOneOriginAcl(deps)).rejects.toThrow('CurrentOriginACL 为空')
      expect(deps.addItems).not.toHaveBeenCalled()
      expect(deps.removeItems).not.toHaveBeenCalled()
      expect(deps.confirmOriginAclUpdate).not.toHaveBeenCalled()
    }
  })

  it('存在非法网段时中止', async () => {
    const { deps } = createFakeDeps({ CurrentOriginACL: version('v3', ['1.1.1.0/24', 'bogus']) }, [
      { id: 'a', ip: '1.1.1.0/24' },
    ])
    await expect(syncEdgeOneOriginAcl(deps)).rejects.toThrow('非法 CIDR')
    expect(deps.listItems).not.toHaveBeenCalled()
    expect(deps.confirmOriginAclUpdate).not.toHaveBeenCalled()
  })

  it('目标集合少于现有条目 50% 时中止', async () => {
    const { deps } = createFakeDeps({ CurrentOriginACL: version('v3', ['1.1.1.0/24']) }, [
      { id: 'a', ip: '1.1.1.0/24' },
      { id: 'b', ip: '2.2.2.0/24' },
      { id: 'c', ip: '3.3.3.0/24' },
    ])
    await expect(syncEdgeOneOriginAcl(deps)).rejects.toThrow('疑似异常数据')
    expect(deps.addItems).not.toHaveBeenCalled()
    expect(deps.removeItems).not.toHaveBeenCalled()
    expect(deps.confirmOriginAclUpdate).not.toHaveBeenCalled()
  })

  it('回读结果与目标不一致时抛错且不确认', async () => {
    const { deps } = createFakeDeps(
      {
        CurrentOriginACL: version('v3', ['1.1.1.0/24']),
        NextOriginACL: version('v4', ['3.3.3.0/24']),
      },
      [{ id: 'a', ip: '1.1.1.0/24' }]
    )
    deps.addItems.mockImplementation(async () => {}) // 假装写入成功但实际未生效
    await expect(syncEdgeOneOriginAcl(deps)).rejects.toThrow('回读校验失败')
    expect(deps.confirmOriginAclUpdate).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test:run src/workers/edgeoneOriginSync/sync.test.ts`
Expected: FAIL，`syncEdgeOneOriginAcl` 未导出（`is not a function`）。

- [ ] **Step 3: 实现**

在 `sync.ts` 文件末尾追加：

```ts
export interface SyncDeps {
  describeOriginAcl(): Promise<OriginAclInfo | null>
  confirmOriginAclUpdate(): Promise<void>
  listItems(): Promise<ListItem[]>
  addItems(items: NewListItem[]): Promise<void>
  removeItems(ids: string[]): Promise<void>
}

export interface SyncResult {
  currentVersion: string
  nextVersion: string | null
  targetCount: number
  added: number
  removed: number
  confirmed: boolean
}

/** 目标集合少于现有条目数的该比例时视为异常数据，中止同步，防止误清空列表 */
export const MIN_TARGET_RATIO = 0.5

export async function syncEdgeOneOriginAcl(deps: SyncDeps): Promise<SyncResult> {
  const info = await deps.describeOriginAcl()
  if (!info || countCidrs(info.CurrentOriginACL) === 0) {
    throw new Error('CurrentOriginACL 为空，中止同步')
  }
  const next = getNextVersion(info)
  const target = computeTargetSet(info)

  const existing = await deps.listItems()
  if (target.size < existing.length * MIN_TARGET_RATIO) {
    throw new Error(
      `目标 ${target.size} 条少于现有 ${existing.length} 条的 ${MIN_TARGET_RATIO * 100}%，疑似异常数据，中止同步`
    )
  }

  const { toAdd, toRemove } = diffItems(existing, target)
  // 先加后删：中途失败时列表只多不少，不会误拦回源流量
  if (toAdd.length > 0) await deps.addItems(toAdd)
  if (toRemove.length > 0) await deps.removeItems(toRemove)

  if (toAdd.length > 0 || toRemove.length > 0) {
    const after = await deps.listItems()
    const afterSet = new Set(after.map(item => normalizeCidr(item.ip)))
    const matches = after.length === target.size && [...target.keys()].every(c => afterSet.has(c))
    if (!matches) {
      throw new Error(`回读校验失败：列表 ${after.length} 条，目标 ${target.size} 条`)
    }
  }

  let confirmed = false
  if (next) {
    await deps.confirmOriginAclUpdate()
    confirmed = true
  }

  return {
    currentVersion: info.CurrentOriginACL.Version,
    nextVersion: next?.Version ?? null,
    targetCount: target.size,
    added: toAdd.length,
    removed: toRemove.length,
    confirmed,
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test:run src/workers/edgeoneOriginSync/sync.test.ts`
Expected: PASS

- [ ] **Step 5: 类型检查与 lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: 无错误

- [ ] **Step 6: Commit**

```bash
git add src/workers/edgeoneOriginSync/sync.ts src/workers/edgeoneOriginSync/sync.test.ts
git commit -m "feat(edgeone-sync): 回源网段同步编排与安全闸"
```

---

### Task 3: 腾讯云 TC3 签名与 `callTeo`

**Files:**

- Create: `src/workers/edgeoneOriginSync/tencentCloud.ts`
- Test: `src/workers/edgeoneOriginSync/tencentCloud.test.ts`

**Interfaces:**

- Consumes: 无
- Produces:
  ```ts
  export interface TencentCloudCredentials {
    secretId: string
    secretKey: string
  }
  export function buildTc3Authorization(
    credentials: TencentCloudCredentials,
    payload: string,
    timestamp: number
  ): Promise<string>
  export interface CallTeoOptions {
    fetch?: typeof fetch
    now?: () => number
  }
  export function callTeo<T>(
    credentials: TencentCloudCredentials,
    action: string,
    body: Record<string, unknown>,
    options?: CallTeoOptions
  ): Promise<T>
  ```

签名测试向量由独立的 Python 实现（按腾讯云 TC3-HMAC-SHA256 文档算法）预先算出：
SecretId `AKIDEXAMPLE`、SecretKey `EXAMPLESECRETKEY`、timestamp `1789383620`（UTC 日期 `2026-09-14`）、
payload `{"ZoneId":"zone-3q0wz2up03uy"}` → Signature `a2555ef12b2be8598b4304acc2ca1d27f900121ea86c071c6972f14314fe183d`。

- [ ] **Step 1: 写失败测试**

创建 `src/workers/edgeoneOriginSync/tencentCloud.test.ts`：

```ts
import { describe, it, expect, vi } from 'vitest'
import { buildTc3Authorization, callTeo } from './tencentCloud'

const credentials = { secretId: 'AKIDEXAMPLE', secretKey: 'EXAMPLESECRETKEY' }
const payload = '{"ZoneId":"zone-3q0wz2up03uy"}'
const EXPECTED_AUTHORIZATION =
  'TC3-HMAC-SHA256 Credential=AKIDEXAMPLE/2026-09-14/teo/tc3_request, SignedHeaders=content-type;host, Signature=a2555ef12b2be8598b4304acc2ca1d27f900121ea86c071c6972f14314fe183d'

describe('buildTc3Authorization', () => {
  it('与独立实现算出的 TC3 签名一致', async () => {
    await expect(buildTc3Authorization(credentials, payload, 1789383620)).resolves.toBe(
      EXPECTED_AUTHORIZATION
    )
  })
})

describe('callTeo', () => {
  it('发送签名请求并返回 Response 字段', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({ Response: { OriginACLInfo: { Status: 'online' }, RequestId: 'r1' } })
        )
    )
    const result = await callTeo<{ OriginACLInfo: { Status: string } }>(
      credentials,
      'DescribeOriginACL',
      { ZoneId: 'zone-3q0wz2up03uy' },
      { fetch: fetchMock, now: () => 1789383620123 }
    )
    expect(result.OriginACLInfo.Status).toBe('online')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://teo.tencentcloudapi.com')
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe(payload)
    const headers = init?.headers as Record<string, string>
    expect(headers['Authorization']).toBe(EXPECTED_AUTHORIZATION)
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers['X-TC-Action']).toBe('DescribeOriginACL')
    expect(headers['X-TC-Timestamp']).toBe('1789383620')
    expect(headers['X-TC-Version']).toBe('2022-09-01')
  })

  it('Response.Error 存在时抛错', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            Response: {
              Error: { Code: 'AuthFailure.SignatureExpire', Message: '签名过期' },
              RequestId: 'r2',
            },
          })
        )
    )
    await expect(
      callTeo(
        credentials,
        'DescribeOriginACL',
        { ZoneId: 'z' },
        {
          fetch: fetchMock as unknown as typeof fetch,
        }
      )
    ).rejects.toThrow('AuthFailure.SignatureExpire')
  })

  it('HTTP 非 2xx 时抛错', async () => {
    const fetchMock = vi.fn(async () => new Response('bad gateway', { status: 502 }))
    await expect(
      callTeo(
        credentials,
        'DescribeOriginACL',
        { ZoneId: 'z' },
        {
          fetch: fetchMock as unknown as typeof fetch,
        }
      )
    ).rejects.toThrow('HTTP 502')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test:run src/workers/edgeoneOriginSync/tencentCloud.test.ts`
Expected: FAIL，模块 `./tencentCloud` 不存在。

- [ ] **Step 3: 实现**

创建 `src/workers/edgeoneOriginSync/tencentCloud.ts`：

```ts
/**
 * 腾讯云 EdgeOne（teo）API 调用：TC3-HMAC-SHA256 签名 + 请求封装
 *
 * 签名算法：https://cloud.tencent.com/document/api/1552/80725
 */

const TEO_HOST = 'teo.tencentcloudapi.com'
const TEO_SERVICE = 'teo'
const TEO_VERSION = '2022-09-01'
const CONTENT_TYPE = 'application/json'
const SIGNED_HEADERS = 'content-type;host'

export interface TencentCloudCredentials {
  secretId: string
  secretKey: string
}

const encoder = new TextEncoder()

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('')
}

async function sha256Hex(message: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(message)))
}

async function hmacSha256(key: BufferSource, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message))
}

export async function buildTc3Authorization(
  credentials: TencentCloudCredentials,
  payload: string,
  timestamp: number
): Promise<string> {
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
  const canonicalRequest = [
    'POST',
    '/',
    '',
    `content-type:${CONTENT_TYPE}\nhost:${TEO_HOST}\n`,
    SIGNED_HEADERS,
    await sha256Hex(payload),
  ].join('\n')
  const credentialScope = `${date}/${TEO_SERVICE}/tc3_request`
  const stringToSign = [
    'TC3-HMAC-SHA256',
    String(timestamp),
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n')

  const secretDate = await hmacSha256(encoder.encode(`TC3${credentials.secretKey}`), date)
  const secretService = await hmacSha256(secretDate, TEO_SERVICE)
  const secretSigning = await hmacSha256(secretService, 'tc3_request')
  const signature = toHex(await hmacSha256(secretSigning, stringToSign))

  return `TC3-HMAC-SHA256 Credential=${credentials.secretId}/${credentialScope}, SignedHeaders=${SIGNED_HEADERS}, Signature=${signature}`
}

export interface CallTeoOptions {
  fetch?: typeof fetch
  now?: () => number
}

interface TeoEnvelope {
  Response?: {
    Error?: { Code: string; Message: string }
    RequestId?: string
  }
}

export async function callTeo<T>(
  credentials: TencentCloudCredentials,
  action: string,
  body: Record<string, unknown>,
  options: CallTeoOptions = {}
): Promise<T> {
  // 取到局部变量再调用，避免 Workers 中以方法形式调用全局 fetch 触发 Illegal invocation
  const fetchImpl = options.fetch ?? fetch
  const timestamp = Math.floor((options.now ?? Date.now)() / 1000)
  const payload = JSON.stringify(body)

  const res = await fetchImpl(`https://${TEO_HOST}`, {
    method: 'POST',
    headers: {
      Authorization: await buildTc3Authorization(credentials, payload, timestamp),
      'Content-Type': CONTENT_TYPE,
      'X-TC-Action': action,
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Version': TEO_VERSION,
    },
    body: payload,
  })
  if (!res.ok) {
    throw new Error(`[TencentCloud] ${action} HTTP ${res.status}`)
  }
  const json = (await res.json()) as TeoEnvelope
  const error = json.Response?.Error
  if (error) {
    throw new Error(
      `[TencentCloud] ${action} 失败: ${error.Code} ${error.Message} (RequestId=${json.Response?.RequestId})`
    )
  }
  return json.Response as T
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test:run src/workers/edgeoneOriginSync/tencentCloud.test.ts`
Expected: PASS。若签名不一致，逐项核对 canonicalRequest 拼接（`'POST\n/\n\ncontent-type:application/json\nhost:teo.tencentcloudapi.com\n\ncontent-type;host\n' + sha256(payload)`），不要修改测试向量。

- [ ] **Step 5: 类型检查与 lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: 无错误。若 `importKey` 的 `key` 参数报 `Uint8Array<ArrayBufferLike>` 不可赋值给 `BufferSource`，把 `encoder.encode(...)` 的结果以 `.buffer as ArrayBuffer` 传入（`TextEncoder.encode` 返回的 Uint8Array 独占其 buffer，偏移为 0）。

- [ ] **Step 6: Commit**

```bash
git add src/workers/edgeoneOriginSync/tencentCloud.ts src/workers/edgeoneOriginSync/tencentCloud.test.ts
git commit -m "feat(edgeone-sync): 腾讯云 TC3 签名与 teo API 调用"
```

---

### Task 4: Cloudflare Lists API 客户端

**Files:**

- Create: `src/workers/edgeoneOriginSync/cloudflareLists.ts`
- Test: `src/workers/edgeoneOriginSync/cloudflareLists.test.ts`

**Interfaces:**

- Consumes: Task 1 的 `ListItem`、`NewListItem`（`import type { ListItem, NewListItem } from './sync'`）
- Produces:
  ```ts
  export interface CloudflareListsConfig {
    accountId: string
    listId: string
    apiToken: string
    fetch?: typeof fetch
    sleep?: (ms: number) => Promise<void>
    pollIntervalMs?: number // 默认 2000
    maxPolls?: number // 默认 30
  }
  export interface CloudflareListsClient {
    listItems(): Promise<ListItem[]>
    addItems(items: NewListItem[]): Promise<void>
    removeItems(ids: string[]): Promise<void>
  }
  export function createCloudflareListsClient(config: CloudflareListsConfig): CloudflareListsClient
  ```

Cloudflare API（均带 `Authorization: Bearer <token>`）：

- `GET  /accounts/{account}/rules/lists/{list}/items?per_page=500[&cursor=...]` → `result: {id, ip, ...}[]`，`result_info.cursors.after` 为下一页 cursor
- `POST /accounts/{account}/rules/lists/{list}/items`，body `[{ip, comment}]` → `result.operation_id`
- `DELETE /accounts/{account}/rules/lists/{list}/items`，body `{items: [{id}]}` → `result.operation_id`
- `GET  /accounts/{account}/rules/lists/bulk_operations/{operation_id}` → `result.status`：`pending` / `running` / `completed` / `failed`（failed 时有 `result.error`）

- [ ] **Step 1: 写失败测试**

创建 `src/workers/edgeoneOriginSync/cloudflareLists.test.ts`：

```ts
import { describe, it, expect, vi } from 'vitest'
import { createCloudflareListsClient } from './cloudflareLists'

const BASE = 'https://api.cloudflare.com/client/v4/accounts/acc/rules/lists'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function envelope(result: unknown, extra: Record<string, unknown> = {}) {
  return { success: true, errors: [], messages: [], result, ...extra }
}

function setup(responses: Response[]) {
  const fetchMock = vi.fn<typeof fetch>(async () => {
    const res = responses.shift()
    if (!res) throw new Error('unexpected fetch')
    return res
  })
  const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {})
  const client = createCloudflareListsClient({
    accountId: 'acc',
    listId: 'list',
    apiToken: 'tok',
    fetch: fetchMock,
    sleep,
    maxPolls: 3,
  })
  return { client, fetchMock, sleep }
}

describe('createCloudflareListsClient', () => {
  it('listItems 按 cursor 翻页并只保留 id / ip', async () => {
    const { client, fetchMock } = setup([
      jsonResponse(
        envelope([{ id: 'a', ip: '1.1.1.0/24', created_on: '2026-05-21T13:38:12Z' }], {
          result_info: { cursors: { after: 'c1' } },
        })
      ),
      jsonResponse(envelope([{ id: 'b', ip: '2.2.2.0/24' }], { result_info: { cursors: {} } })),
    ])
    await expect(client.listItems()).resolves.toEqual([
      { id: 'a', ip: '1.1.1.0/24' },
      { id: 'b', ip: '2.2.2.0/24' },
    ])
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/list/items?per_page=500`)
    expect(fetchMock.mock.calls[1][0]).toBe(`${BASE}/list/items?per_page=500&cursor=c1`)
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer tok')
  })

  it('addItems 提交后轮询到 completed', async () => {
    const { client, fetchMock, sleep } = setup([
      jsonResponse(envelope({ operation_id: 'op1' })),
      jsonResponse(envelope({ id: 'op1', status: 'running' })),
      jsonResponse(envelope({ id: 'op1', status: 'completed' })),
    ])
    const items = [{ ip: '3.3.3.0/24', comment: 'EdgeOne v4' }]
    await client.addItems(items)
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/list/items`)
    expect(fetchMock.mock.calls[0][1]?.method).toBe('POST')
    expect(fetchMock.mock.calls[0][1]?.body).toBe(JSON.stringify(items))
    expect(fetchMock.mock.calls[1][0]).toBe(`${BASE}/bulk_operations/op1`)
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(sleep).toHaveBeenCalledWith(2000)
  })

  it('removeItems 按 id 删除并轮询', async () => {
    const { client, fetchMock } = setup([
      jsonResponse(envelope({ operation_id: 'op2' })),
      jsonResponse(envelope({ id: 'op2', status: 'completed' })),
    ])
    await client.removeItems(['b', 'c'])
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/list/items`)
    expect(fetchMock.mock.calls[0][1]?.method).toBe('DELETE')
    expect(fetchMock.mock.calls[0][1]?.body).toBe(
      JSON.stringify({ items: [{ id: 'b' }, { id: 'c' }] })
    )
  })

  it('批量操作 failed 时抛错', async () => {
    const { client } = setup([
      jsonResponse(envelope({ operation_id: 'op3' })),
      jsonResponse(envelope({ id: 'op3', status: 'failed', error: 'invalid ip' })),
    ])
    await expect(client.addItems([{ ip: 'x', comment: 'y' }])).rejects.toThrow('invalid ip')
  })

  it('轮询超过 maxPolls 时抛错', async () => {
    const { client } = setup([
      jsonResponse(envelope({ operation_id: 'op4' })),
      jsonResponse(envelope({ id: 'op4', status: 'pending' })),
      jsonResponse(envelope({ id: 'op4', status: 'running' })),
      jsonResponse(envelope({ id: 'op4', status: 'running' })),
    ])
    await expect(client.removeItems(['a'])).rejects.toThrow('轮询超时')
  })

  it('API 返回 success=false 时抛错并带上错误信息', async () => {
    const { client } = setup([
      jsonResponse(
        {
          success: false,
          errors: [{ code: 10000, message: 'Authentication error' }],
          result: null,
        },
        403
      ),
    ])
    await expect(client.listItems()).rejects.toThrow('Authentication error')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test:run src/workers/edgeoneOriginSync/cloudflareLists.test.ts`
Expected: FAIL，模块 `./cloudflareLists` 不存在。

- [ ] **Step 3: 实现**

创建 `src/workers/edgeoneOriginSync/cloudflareLists.ts`：

```ts
/**
 * Cloudflare 账户级 IP 列表（Rules Lists）API 客户端
 *
 * 写操作是异步批量操作：提交后需轮询 bulk_operations 至 completed。
 * 同一列表同一时刻只允许一个批量操作，调用方需串行调用 addItems / removeItems。
 */

import type { ListItem, NewListItem } from './sync'

const API_BASE = 'https://api.cloudflare.com/client/v4'

export interface CloudflareListsConfig {
  accountId: string
  listId: string
  apiToken: string
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  pollIntervalMs?: number
  maxPolls?: number
}

export interface CloudflareListsClient {
  listItems(): Promise<ListItem[]>
  addItems(items: NewListItem[]): Promise<void>
  removeItems(ids: string[]): Promise<void>
}

interface CfEnvelope<T> {
  success: boolean
  errors?: { code: number; message: string }[]
  result: T
  result_info?: { cursors?: { after?: string } }
}

export function createCloudflareListsClient(config: CloudflareListsConfig): CloudflareListsClient {
  // 取到局部变量再调用，避免 Workers 中以方法形式调用全局 fetch 触发 Illegal invocation
  const fetchImpl = config.fetch ?? fetch
  const sleep =
    config.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)))
  const pollIntervalMs = config.pollIntervalMs ?? 2000
  const maxPolls = config.maxPolls ?? 30
  const listsBase = `${API_BASE}/accounts/${config.accountId}/rules/lists`
  const itemsUrl = `${listsBase}/${config.listId}/items`

  async function request<T>(method: string, url: string, body?: unknown): Promise<CfEnvelope<T>> {
    const res = await fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const json = (await res.json()) as CfEnvelope<T>
    if (!res.ok || !json.success) {
      const detail = (json.errors ?? []).map(e => `${e.code} ${e.message}`).join('; ')
      throw new Error(`[Cloudflare Lists] ${method} ${url} 失败: HTTP ${res.status} ${detail}`)
    }
    return json
  }

  async function waitForOperation(operationId: string): Promise<void> {
    for (let i = 0; i < maxPolls; i++) {
      const { result } = await request<{ status: string; error?: string }>(
        'GET',
        `${listsBase}/bulk_operations/${operationId}`
      )
      if (result.status === 'completed') return
      if (result.status === 'failed') {
        throw new Error(
          `[Cloudflare Lists] 批量操作 ${operationId} 失败: ${result.error ?? 'unknown'}`
        )
      }
      if (i < maxPolls - 1) await sleep(pollIntervalMs)
    }
    throw new Error(`[Cloudflare Lists] 批量操作 ${operationId} 轮询超时`)
  }

  return {
    async listItems() {
      const items: ListItem[] = []
      let cursor: string | undefined
      do {
        const url = `${itemsUrl}?per_page=500${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
        const page = await request<ListItem[]>('GET', url)
        items.push(...page.result.map(({ id, ip }) => ({ id, ip })))
        cursor = page.result_info?.cursors?.after
      } while (cursor)
      return items
    },

    async addItems(items) {
      const { result } = await request<{ operation_id: string }>('POST', itemsUrl, items)
      await waitForOperation(result.operation_id)
    },

    async removeItems(ids) {
      const { result } = await request<{ operation_id: string }>('DELETE', itemsUrl, {
        items: ids.map(id => ({ id })),
      })
      await waitForOperation(result.operation_id)
    },
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test:run src/workers/edgeoneOriginSync/cloudflareLists.test.ts`
Expected: PASS（`addItems` 用例中 running → completed 仅 sleep 1 次；超时用例 3 次轮询后抛错）

- [ ] **Step 5: 类型检查与 lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: 无错误

- [ ] **Step 6: Commit**

```bash
git add src/workers/edgeoneOriginSync/cloudflareLists.ts src/workers/edgeoneOriginSync/cloudflareLists.test.ts
git commit -m "feat(edgeone-sync): Cloudflare IP 列表 API 客户端"
```

---

### Task 5: 接入 cron、Env 与配置

**Files:**

- Create: `src/workers/edgeoneOriginSync/index.ts`
- Test: `src/workers/edgeoneOriginSync/index.test.ts`
- Modify: `src/workers/env.ts`（`Env` 接口末尾）
- Modify: `src/workers/scheduled.ts`（import 区与 `switch`）
- Modify: `wrangler.toml`（第 7 行 crons；`[env.production.vars]`）
- Modify: `src/workers/README.md`（目录结构列表、Secrets 代码块）

**Interfaces:**

- Consumes: `syncEdgeOneOriginAcl`、`OriginAclInfo`（Task 2 / Task 1）、`callTeo`（Task 3）、`createCloudflareListsClient`（Task 4）
- Produces: `export async function runEdgeOneOriginSync(env: Env): Promise<void>`（永不抛出）

- [ ] **Step 1: 扩展 `Env`**

在 `src/workers/env.ts` 的 `Env` 接口中 `FFLOGS_PROXY_SECRET?: string` 之后追加：

```ts
  /** EdgeOne 站点 ID；与下列 5 项齐全时每日 cron 同步回源 IP 网段到 Cloudflare IP 列表 */
  EDGEONE_ZONE_ID?: string
  /** Cloudflare 账户 ID（IP 列表所属账户） */
  CF_ACCOUNT_ID?: string
  /** Cloudflare IP 列表 `edgeone` 的 List ID */
  CF_EDGEONE_LIST_ID?: string
  /** 腾讯云 CAM 子用户长期密钥，仅需 teo:DescribeOriginACL / teo:ConfirmOriginACLUpdate */
  TENCENTCLOUD_SECRET_ID?: string
  TENCENTCLOUD_SECRET_KEY?: string
  /** Cloudflare API Token，仅需 Account Filter Lists: Edit */
  CF_LISTS_API_TOKEN?: string
```

- [ ] **Step 2: 写失败测试**

创建 `src/workers/edgeoneOriginSync/index.test.ts`：

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Env } from '../env'
import { runEdgeOneOriginSync } from './index'

const fullEnv = {
  EDGEONE_ZONE_ID: 'zone-x',
  CF_ACCOUNT_ID: 'acc',
  CF_EDGEONE_LIST_ID: 'list',
  TENCENTCLOUD_SECRET_ID: 'id',
  TENCENTCLOUD_SECRET_KEY: 'key',
  CF_LISTS_API_TOKEN: 'tok',
} as unknown as Env

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('runEdgeOneOriginSync', () => {
  it('配置缺失时跳过且不发请求', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await runEdgeOneOriginSync({ ...fullEnv, CF_LISTS_API_TOKEN: undefined })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith('[EdgeOne Sync] 配置缺失，跳过')
  })

  it('同步失败时记录错误日志而不抛出', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              Response: { Error: { Code: 'AuthFailure', Message: 'bad' }, RequestId: 'r' },
            })
          )
      )
    )
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(runEdgeOneOriginSync(fullEnv)).resolves.toBeUndefined()
    expect(error).toHaveBeenCalledWith(expect.stringContaining('[EdgeOne Sync] 失败'))
    expect(error).toHaveBeenCalledWith(expect.stringContaining('AuthFailure'))
  })
})
```

- [ ] **Step 3: 运行测试确认失败**

Run: `pnpm test:run src/workers/edgeoneOriginSync/index.test.ts`
Expected: FAIL，模块 `./index` 不存在。

- [ ] **Step 4: 实现 `index.ts`**

创建 `src/workers/edgeoneOriginSync/index.ts`：

```ts
/**
 * EdgeOne 回源 IP 网段同步 cron 入口：读取配置、组装依赖、兜错打日志
 */

import type { Env } from '../env'
import { createCloudflareListsClient } from './cloudflareLists'
import { syncEdgeOneOriginAcl, type OriginAclInfo } from './sync'
import { callTeo } from './tencentCloud'

export async function runEdgeOneOriginSync(env: Env): Promise<void> {
  const {
    EDGEONE_ZONE_ID: zoneId,
    CF_ACCOUNT_ID: accountId,
    CF_EDGEONE_LIST_ID: listId,
    TENCENTCLOUD_SECRET_ID: secretId,
    TENCENTCLOUD_SECRET_KEY: secretKey,
    CF_LISTS_API_TOKEN: apiToken,
  } = env
  if (!zoneId || !accountId || !listId || !secretId || !secretKey || !apiToken) {
    console.warn('[EdgeOne Sync] 配置缺失，跳过')
    return
  }

  const credentials = { secretId, secretKey }
  const lists = createCloudflareListsClient({ accountId, listId, apiToken })

  try {
    console.log('[EdgeOne Sync] 启动')
    const result = await syncEdgeOneOriginAcl({
      describeOriginAcl: async () => {
        const res = await callTeo<{ OriginACLInfo?: OriginAclInfo | null }>(
          credentials,
          'DescribeOriginACL',
          { ZoneId: zoneId }
        )
        return res.OriginACLInfo ?? null
      },
      confirmOriginAclUpdate: async () => {
        await callTeo(credentials, 'ConfirmOriginACLUpdate', { ZoneId: zoneId })
      },
      listItems: () => lists.listItems(),
      addItems: items => lists.addItems(items),
      removeItems: ids => lists.removeItems(ids),
    })
    console.log(
      `[EdgeOne Sync] 结束 (current=${result.currentVersion}, next=${result.nextVersion ?? '-'}, ` +
        `target=${result.targetCount}, added=${result.added}, removed=${result.removed}, confirmed=${result.confirmed})`
    )
  } catch (err) {
    console.error(`[EdgeOne Sync] 失败: ${err instanceof Error ? err.message : String(err)}`)
  }
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm test:run src/workers/edgeoneOriginSync`
Expected: PASS（本目录 4 个测试文件全部通过）

- [ ] **Step 6: 接入 `scheduled.ts`**

在 `src/workers/scheduled.ts` 的 import 区（`from './top100Sync'` 之后）追加：

```ts
import { runEdgeOneOriginSync } from './edgeoneOriginSync'
```

在 `switch (event.cron)` 中 `case '0 */12 * * *':` 分支之后、`default:` 之前插入：

```ts
    case '0 3 * * *':
      ctx.waitUntil(runEdgeOneOriginSync(env))
      return
```

- [ ] **Step 7: 修改 `wrangler.toml`**

第 7 行改为：

```toml
crons = ["0 */12 * * *", "*/10 * * * *", "0 3 * * *"]
```

在 `[env.production.vars]` 段中 `FFLOGS_PROXY_BASE = "https://ffproxy.xivhealer.com"` 之后追加：

```toml
# EdgeOne 回源 IP 网段每日同步到 Cloudflare IP 列表（cron 0 3 * * *）。
# 另需 secrets：TENCENTCLOUD_SECRET_ID / TENCENTCLOUD_SECRET_KEY / CF_LISTS_API_TOKEN；缺任一项则跳过。
EDGEONE_ZONE_ID = "zone-3q0wz2up03uy"
CF_ACCOUNT_ID = "b35d3e7a2fdaf5712fa29ea9a32c6c9a"
CF_EDGEONE_LIST_ID = "0681de725731434689c4240e6a254b09"
```

- [ ] **Step 8: 更新 `src/workers/README.md`**

「目录结构」列表中 `collab/` 条目之后新增一行：

```markdown
- `edgeoneOriginSync/` —— 每日 cron（`0 3 * * *`）把腾讯云 EdgeOne 回源 IP 网段同步到 Cloudflare IP 列表 `edgeone`：`sync.ts`（CIDR 标准化、差异计算、编排与安全闸）、`tencentCloud.ts`（TC3 签名）、`cloudflareLists.ts`（Lists API）、`index.ts`（cron 入口）。
```

「环境变量 (Secrets)」代码块中 `wrangler secret put SYNC_AUTH_TOKEN` 之后追加：

```bash

# EdgeOne 回源 IP 网段同步（仅 production；缺任一项则跳过）
# 腾讯云 CAM 子用户长期密钥，仅授予 teo:DescribeOriginACL、teo:ConfirmOriginACLUpdate
wrangler secret put TENCENTCLOUD_SECRET_ID --env production
wrangler secret put TENCENTCLOUD_SECRET_KEY --env production
# Cloudflare API Token，仅 Account Filter Lists: Edit
wrangler secret put CF_LISTS_API_TOKEN --env production
```

- [ ] **Step 9: 全量验证**

Run: `pnpm test:run && pnpm exec tsc --noEmit && pnpm lint`
Expected: 全部通过

- [ ] **Step 10: Commit**

```bash
git add src/workers/edgeoneOriginSync/index.ts src/workers/edgeoneOriginSync/index.test.ts src/workers/env.ts src/workers/scheduled.ts wrangler.toml src/workers/README.md
git commit -m "feat(edgeone-sync): 接入每日 cron 与生产配置"
```

---

## 计划外（需用户参与，不由 subagent 执行）

1. 用户创建 CAM 子用户长期密钥与 Cloudflare `Account Filter Lists: Edit` Token，执行 README 中的 `wrangler secret put ... --env production`。
2. 用户授权后部署。
3. 手动触发验证：本地 `.dev.vars` 填入 3 个 secret，`pnpm exec wrangler dev --env production --test-scheduled`，请求 `http://localhost:8787/__scheduled?cron=0+3+*+*+*`，日志应出现 `[EdgeOne Sync] 结束 (...)`；注意这会真实写入 Cloudflare 列表并调用确认接口。若腾讯云报 Region 相关错误，在 `callTeo` 请求头补 `X-TC-Region`。
