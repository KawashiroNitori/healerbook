# Timeline ID 敏感词过滤实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `POST /api/timelines` 生成的共享 timeline ID 不包含任何敏感词子串（不区分大小写）；敏感词列表不以明文进入代码库，运行时不打印明文。

**Architecture:** Worker 侧重试生成 + HMAC 哈希预生成。本机用 HMAC-SHA256 把 `secrets/sensitive-words.txt` 每个词哈希、按词长分组写入入 git 的 `sensitiveWordHashes.generated.ts`。Worker 运行时滑窗 HMAC 候选 ID 子串去查表；命中则重试 nanoid。HMAC key 在本地 `.dev.vars` 与 Workers Secret 两处同值；表中 `KEY_FINGERPRINT` 字段用于 runtime drift 检测。

**Tech Stack:** Cloudflare Workers + nanoid 5 + Web Crypto (`crypto.subtle`) + Node `node:crypto` (构建期) + tsx + vitest 4

**Spec：** `design/superpowers/specs/2026-04-26-id-sensitive-word-filter-design.md`

---

## 文件结构

| 路径                                           | 状态               | 责任                                                      |
| ---------------------------------------------- | ------------------ | --------------------------------------------------------- |
| `secrets/sensitive-words.txt`                  | 新增（gitignored） | 本机敏感词明文，每行一个词                                |
| `scripts/buildSensitiveWords.ts`               | 新增               | 手动哈希生成器；读 txt + key，写出 generated.ts           |
| `src/workers/sensitiveWordHashes.generated.ts` | 新增（入 git）     | 由脚本生成；包含 `HASHES`、`LENGTHS`、`KEY_FINGERPRINT`   |
| `src/workers/sensitiveWordFilter.ts`           | 新增               | 运行时滑窗哈希匹配 + health check + drift 校验            |
| `src/workers/sensitiveWordFilter.test.ts`      | 新增               | 单元测试                                                  |
| `src/workers/sensitiveWordFilter.bench.ts`     | 新增               | vitest bench，本地手动跑                                  |
| `src/workers/timelines.ts`                     | 改                 | `handlePost` 用 `generateCleanId` 替代直接 `generateId()` |
| `src/workers/timelines.test.ts`                | 改                 | 加重试与 500 fallback 测试                                |
| `src/workers/fflogs-proxy.ts`                  | 改                 | `Env` 加 `SENSITIVE_WORDS_HMAC_KEY?: string`              |
| `package.json`                                 | 改                 | 加 `gen:sensitive-words` script                           |
| `.gitignore`                                   | 改                 | 加 `secrets/`                                             |
| `.dev.vars.example`                            | 改                 | 末尾加 `SENSITIVE_WORDS_HMAC_KEY` 注释行                  |
| `.prettierignore`                              | 新增               | 忽略 `*.generated.ts`（防止格式扰动）                     |

---

## Task 1: 项目脚手架

**目标**：把所有外围文件准备好（gitignore、env example、package.json script、`.prettierignore`），在不引入逻辑代码的前提下打地基。

**Files:**

- Modify: `.gitignore`
- Modify: `.dev.vars.example`
- Create: `.prettierignore`
- Modify: `package.json`
- Modify: `src/workers/fflogs-proxy.ts:36-56`（`Env` 接口）

- [ ] **Step 1: 在 `.gitignore` 末尾加 `secrets/`**

打开 `.gitignore`，在 `public/latest-release.json` 之后追加一行：

```
secrets/
```

- [ ] **Step 2: 在 `.dev.vars.example` 末尾加 `SENSITIVE_WORDS_HMAC_KEY`**

在文件末尾追加：

```
# 敏感词过滤 HMAC 密钥（HMAC-SHA256）
# 生成方式: openssl rand -base64 32
# 本地 .dev.vars 与线上 Workers Secret 两处必须同值
SENSITIVE_WORDS_HMAC_KEY=your_hmac_key_here
```

- [ ] **Step 3: 创建 `.prettierignore`**

```
# 自动生成的产物，避免 prettier 扰动 byte-equal 输出
*.generated.ts

# 与 .gitignore 一致的常见忽略
dist
coverage/
.wrangler/
node_modules/
```

- [ ] **Step 4: 在 `package.json` 的 `scripts` 中加 `gen:sensitive-words`**

在 `"workers:deploy"` 之后插入：

```json
    "workers:deploy": "wrangler deploy --config wrangler.toml --env production",
    "gen:sensitive-words": "tsx scripts/buildSensitiveWords.ts",
    "prepare": "husky",
```

- [ ] **Step 5: 在 `Env` 接口中加 `SENSITIVE_WORDS_HMAC_KEY` 字段**

打开 `src/workers/fflogs-proxy.ts`，定位 `export interface Env`（约 36 行），在 `ALLOWED_ORIGIN?: string` 之后加入：

```ts
  // 敏感词过滤 HMAC 密钥（与构建期生成 sensitiveWordHashes.generated.ts 时所用同值）
  SENSITIVE_WORDS_HMAC_KEY?: string
}
```

- [ ] **Step 6: 跑 lint + tsc 确保配置不破**

```bash
pnpm lint
pnpm exec tsc --noEmit
```

预期：均无新错误。

- [ ] **Step 7: 提交**

```bash
git add .gitignore .dev.vars.example .prettierignore package.json src/workers/fflogs-proxy.ts
git commit -m "chore(id-filter): 搭脚手架 — gitignore、Env、script、prettier ignore"
```

---

## Task 2: 构建期哈希生成脚本

**目标**：实现 `scripts/buildSensitiveWords.ts`，读 txt + key，写出 `sensitiveWordHashes.generated.ts`。这是个手动命令，不挂任何 prebuild hook。

**Files:**

- Create: `scripts/buildSensitiveWords.ts`

- [ ] **Step 1: 创建 `scripts/buildSensitiveWords.ts`**

```ts
/**
 * 敏感词哈希生成脚本（手动运行：pnpm gen:sensitive-words）
 *
 * 读 secrets/sensitive-words.txt + SENSITIVE_WORDS_HMAC_KEY（env 优先，
 * 项目根 .dev.vars 作为 fallback），输出 src/workers/sensitiveWordHashes.generated.ts。
 *
 * 不打印任何词、哈希、key；只在控制台输出条目数概览或空表提示。
 */

import { createHmac } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const TXT_PATH = resolve(ROOT, 'secrets/sensitive-words.txt')
const OUT_PATH = resolve(ROOT, 'src/workers/sensitiveWordHashes.generated.ts')
const DEV_VARS_PATH = resolve(ROOT, '.dev.vars')
const FINGERPRINT_MAGIC = 'sensitive-words-fingerprint-v1'
const KEY_NAME = 'SENSITIVE_WORDS_HMAC_KEY'

function readDevVars(path: string): Record<string, string> {
  if (!existsSync(path)) return {}
  const out: Record<string, string> = {}
  for (const raw of readFileSync(path, 'utf-8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const k = line.slice(0, eq).trim()
    const v = line
      .slice(eq + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '')
    out[k] = v
  }
  return out
}

function loadKey(): string {
  const fromEnv = process.env[KEY_NAME]
  if (fromEnv && fromEnv.length > 0) return fromEnv
  const fromDevVars = readDevVars(DEV_VARS_PATH)[KEY_NAME]
  if (fromDevVars && fromDevVars.length > 0) return fromDevVars
  console.error(
    `Error: ${KEY_NAME} not set in env or ${DEV_VARS_PATH}. ` +
      `Generate one: openssl rand -base64 32`
  )
  process.exit(1)
}

function hashTrunc(key: string, input: string): string {
  return createHmac('sha256', key).update(input).digest().subarray(0, 16).toString('base64')
}

function loadWords(path: string): string[] | null {
  if (!existsSync(path)) return null
  const seen = new Set<string>()
  for (const raw of readFileSync(path, 'utf-8').split(/\r?\n/)) {
    const line = raw.trim().toLowerCase()
    if (!line || line.startsWith('#')) continue
    seen.add(line)
  }
  return [...seen]
}

function buildModule(hashesByLength: Map<number, string[]>, fingerprint: string): string {
  const lengths = [...hashesByLength.keys()].sort((a, b) => a - b)
  const lines: string[] = []
  lines.push('// AUTO-GENERATED by scripts/buildSensitiveWords.ts. DO NOT EDIT.')
  lines.push('// Run `pnpm gen:sensitive-words` to regenerate.')
  lines.push('')
  lines.push('export const HASHES: ReadonlyMap<number, ReadonlySet<string>> = new Map([')
  for (const L of lengths) {
    const sorted = [...(hashesByLength.get(L) ?? [])].sort()
    const entries = sorted.map(h => `'${h}'`).join(', ')
    lines.push(`  [${L}, new Set([${entries}])],`)
  }
  lines.push('])')
  lines.push('')
  lines.push(`export const LENGTHS: readonly number[] = [${lengths.join(', ')}]`)
  lines.push('')
  lines.push(`export const KEY_FINGERPRINT: string = '${fingerprint}'`)
  lines.push('')
  return lines.join('\n')
}

function main(): void {
  const key = loadKey()
  const fingerprint = hashTrunc(key, FINGERPRINT_MAGIC)
  const words = loadWords(TXT_PATH)

  if (words === null) {
    writeFileSync(OUT_PATH, buildModule(new Map(), fingerprint))
    console.log('Sensitive word file not found, generated empty table')
    return
  }

  const hashesByLength = new Map<number, string[]>()
  for (const word of words) {
    const L = word.length
    const arr = hashesByLength.get(L) ?? []
    arr.push(hashTrunc(key, word))
    hashesByLength.set(L, arr)
  }

  writeFileSync(OUT_PATH, buildModule(hashesByLength, fingerprint))
  console.log(`Generated ${words.length} hashes across ${hashesByLength.size} length buckets`)
}

main()
```

- [ ] **Step 2: 跑 lint 确保脚本本身合格**

```bash
pnpm lint
```

预期：无新错误。

- [ ] **Step 3: 提交**

```bash
git add scripts/buildSensitiveWords.ts
git commit -m "feat(id-filter): 加敏感词哈希构建脚本"
```

---

## Task 3: 生成首版 generated 模块（空表）

**目标**：先用空 secrets 跑一次脚本，commit 一个空 generated 模块。这样 Task 4 写 filter 时已有可 import 的真实模块（不是 stub）。

**Files:**

- Create: `src/workers/sensitiveWordHashes.generated.ts`（由脚本写出）
- 临时：开发者本机的 `.dev.vars` 添加 `SENSITIVE_WORDS_HMAC_KEY`（**不入 git**）

- [ ] **Step 1: 准备本机 `.dev.vars` 与 Workers Secret**

如果尚未配置：

```bash
openssl rand -base64 32
# 把输出复制到 .dev.vars（本机）与 Cloudflare Workers Secret（线上）

# 本机：在 .dev.vars 末尾追加（.dev.vars 已 gitignored）
# SENSITIVE_WORDS_HMAC_KEY=<那串值>

# 线上（一次性）：
pnpm dlx wrangler secret put SENSITIVE_WORDS_HMAC_KEY --config wrangler.toml --env production
```

- [ ] **Step 2: 不创建 `secrets/sensitive-words.txt`，跑生成脚本**

```bash
pnpm gen:sensitive-words
```

预期输出：

```
Sensitive word file not found, generated empty table
```

预期产物：`src/workers/sensitiveWordHashes.generated.ts` 包含空 `HASHES`、空 `LENGTHS`、非空 `KEY_FINGERPRINT`。

- [ ] **Step 3: 检查产物**

```bash
cat src/workers/sensitiveWordHashes.generated.ts
```

应当看到：

```ts
// AUTO-GENERATED ...
export const HASHES: ReadonlyMap<number, ReadonlySet<string>> = new Map([])

export const LENGTHS: readonly number[] = []

export const KEY_FINGERPRINT: string = '<16 字节 base64>'
```

- [ ] **Step 4: tsc 检查产物 valid**

```bash
pnpm exec tsc --noEmit
```

预期：无错误。

- [ ] **Step 5: 提交**

```bash
git add src/workers/sensitiveWordHashes.generated.ts
git commit -m "feat(id-filter): 加生成的敏感词哈希表（首版空表）"
```

---

## Task 4: TDD `sensitiveWordFilter.ts` 核心匹配

**目标**：实现并测试 `containsBannedSubstring`，先不含 health check / drift。Mock 生成模块以便单测。

**Files:**

- Create: `src/workers/sensitiveWordFilter.ts`
- Create: `src/workers/sensitiveWordFilter.test.ts`

- [ ] **Step 1: 写测试文件骨架，含 helper 与第一个测试**

创建 `src/workers/sensitiveWordFilter.test.ts`：

```ts
/// <reference types="@cloudflare/workers-types" />

import { describe, it, expect, vi, beforeEach } from 'vitest'

// 默认 mock 生成模块；各测试用 setupHashes() 覆盖
vi.mock('./sensitiveWordHashes.generated', () => ({
  HASHES: new Map<number, Set<string>>(),
  LENGTHS: [] as number[],
  KEY_FINGERPRINT: '',
}))

import * as generated from './sensitiveWordHashes.generated'

const TEST_KEY = 'test-key-12345678901234567890123456789012'
const FINGERPRINT_MAGIC = 'sensitive-words-fingerprint-v1'

async function hmacB64Trunc(material: string, input: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(material),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(input))
  const bytes = new Uint8Array(sig, 0, 16)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

async function setupHashes(words: string[]): Promise<void> {
  const byLen = new Map<number, Set<string>>()
  for (const w of words) {
    const h = await hmacB64Trunc(TEST_KEY, w)
    const set = byLen.get(w.length) ?? new Set<string>()
    set.add(h)
    byLen.set(w.length, set)
  }
  vi.mocked(generated, true).HASHES = byLen
  ;(generated as { LENGTHS: number[] }).LENGTHS = [...byLen.keys()].sort((a, b) => a - b)
  ;(generated as { KEY_FINGERPRINT: string }).KEY_FINGERPRINT = await hmacB64Trunc(
    TEST_KEY,
    FINGERPRINT_MAGIC
  )
}

// 每个测试都 vi.resetModules() 拿新 filter 实例，重置 module-scope state
async function freshFilter() {
  vi.resetModules()
  return await import('./sensitiveWordFilter')
}

beforeEach(() => {
  vi.mocked(generated, true).HASHES = new Map()
  ;(generated as { LENGTHS: number[] }).LENGTHS = []
  ;(generated as { KEY_FINGERPRINT: string }).KEY_FINGERPRINT = ''
})

describe('containsBannedSubstring', () => {
  it('缺 SENSITIVE_WORDS_HMAC_KEY 时返回 false（即便表有内容）', async () => {
    await setupHashes(['banword'])
    const { containsBannedSubstring } = await freshFilter()

    const result = await containsBannedSubstring('xxbanwordyy', {})
    expect(result).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试确认 fail**

```bash
pnpm test:run src/workers/sensitiveWordFilter.test.ts
```

预期：FAIL — 模块未实现。

- [ ] **Step 3: 写最小 `sensitiveWordFilter.ts`**

```ts
/// <reference types="@cloudflare/workers-types" />

import { HASHES, LENGTHS } from './sensitiveWordHashes.generated'

export interface SensitiveWordEnv {
  SENSITIVE_WORDS_HMAC_KEY?: string
}

let cachedHmacKey: CryptoKey | null = null
let cachedKeyMaterial: string | null = null

async function getHmacKey(material: string): Promise<CryptoKey> {
  if (cachedHmacKey && cachedKeyMaterial === material) return cachedHmacKey
  cachedKeyMaterial = material
  cachedHmacKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(material),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  return cachedHmacKey
}

function hashToBase64Trunc(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf, 0, 16)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

export async function containsBannedSubstring(id: string, env: SensitiveWordEnv): Promise<boolean> {
  if (!env.SENSITIVE_WORDS_HMAC_KEY || LENGTHS.length === 0) return false

  const key = await getHmacKey(env.SENSITIVE_WORDS_HMAC_KEY)
  const lower = id.toLowerCase()
  const enc = new TextEncoder()

  for (const L of LENGTHS) {
    const bucket = HASHES.get(L)
    if (!bucket) continue
    const limit = lower.length - L
    for (let i = 0; i <= limit; i++) {
      const sub = lower.slice(i, i + L)
      const sig = await crypto.subtle.sign('HMAC', key, enc.encode(sub))
      if (bucket.has(hashToBase64Trunc(sig))) return true
    }
  }
  return false
}
```

- [ ] **Step 4: 跑测试确认 pass**

```bash
pnpm test:run src/workers/sensitiveWordFilter.test.ts
```

预期：1 条 PASS。

- [ ] **Step 5: 加更多测试 — 命中、位置、大小写、不命中、空表**

在 `describe` 内追加：

```ts
it('ID 含敏感词子串时返回 true', async () => {
  await setupHashes(['banword'])
  const { containsBannedSubstring } = await freshFilter()

  const result = await containsBannedSubstring('xxbanwordyy', {
    SENSITIVE_WORDS_HMAC_KEY: TEST_KEY,
  })
  expect(result).toBe(true)
})

it('不区分大小写：词写小写、ID 大写仍命中', async () => {
  await setupHashes(['banword'])
  const { containsBannedSubstring } = await freshFilter()

  const result = await containsBannedSubstring('xxBANWORDyy', {
    SENSITIVE_WORDS_HMAC_KEY: TEST_KEY,
  })
  expect(result).toBe(true)
})

it('命中位置：起始 / 中间 / 末尾', async () => {
  await setupHashes(['banword'])
  const { containsBannedSubstring } = await freshFilter()
  const env = { SENSITIVE_WORDS_HMAC_KEY: TEST_KEY }

  expect(await containsBannedSubstring('banwordxxxx', env)).toBe(true)
  expect(await containsBannedSubstring('xxbanwordxx', env)).toBe(true)
  expect(await containsBannedSubstring('xxxxbanword', env)).toBe(true)
})

it('不命中：随机 ID 与表里词不重叠', async () => {
  await setupHashes(['banword'])
  const { containsBannedSubstring } = await freshFilter()

  const result = await containsBannedSubstring('AbCdEfGhIjKlMnOpQrStU', {
    SENSITIVE_WORDS_HMAC_KEY: TEST_KEY,
  })
  expect(result).toBe(false)
})

it('LENGTHS 为空时直接 no-op 返回 false', async () => {
  // 不调 setupHashes，保持空表
  const { containsBannedSubstring } = await freshFilter()

  const result = await containsBannedSubstring('AbCdEfGhIjKlMnOpQrStU', {
    SENSITIVE_WORDS_HMAC_KEY: TEST_KEY,
  })
  expect(result).toBe(false)
})
```

- [ ] **Step 6: 跑测试确认 6 条全 pass**

```bash
pnpm test:run src/workers/sensitiveWordFilter.test.ts
```

预期：6 条 PASS。

- [ ] **Step 7: 提交**

```bash
git add src/workers/sensitiveWordFilter.ts src/workers/sensitiveWordFilter.test.ts
git commit -m "feat(id-filter): 加 sensitiveWordFilter 核心 HMAC 滑窗匹配"
```

---

## Task 5: 加 health check 日志

**目标**：在 filter 首次调用时往 console 写一行健康状态（启用 / 缺 key / 空表），仅写一次。

**Files:**

- Modify: `src/workers/sensitiveWordFilter.ts`
- Modify: `src/workers/sensitiveWordFilter.test.ts`

- [ ] **Step 1: 加测试 — 启用 / 缺 key / 空表 三种 log，且每种只 log 一次**

在测试 `describe` 内追加：

```ts
it('首次调用 log "active: N entries across M lengths"，且只 log 一次', async () => {
  await setupHashes(['banword'])
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  const { containsBannedSubstring } = await freshFilter()

  await containsBannedSubstring('aaa', { SENSITIVE_WORDS_HMAC_KEY: TEST_KEY })
  await containsBannedSubstring('bbb', { SENSITIVE_WORDS_HMAC_KEY: TEST_KEY })

  const activeCalls = logSpy.mock.calls.filter(c =>
    String(c[0]).includes('[sensitive-words] active')
  )
  expect(activeCalls).toHaveLength(1)
  expect(String(activeCalls[0][0])).toContain('1 entries across 1 lengths')

  logSpy.mockRestore()
})

it('缺 key 时首次调用 log "disabled: missing"，只 log 一次', async () => {
  await setupHashes(['banword'])
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const { containsBannedSubstring } = await freshFilter()

  await containsBannedSubstring('aaa', {})
  await containsBannedSubstring('bbb', {})

  const calls = warnSpy.mock.calls.filter(c =>
    String(c[0]).includes('[sensitive-words] disabled: missing')
  )
  expect(calls).toHaveLength(1)

  warnSpy.mockRestore()
})

it('空表时首次调用 log "disabled: empty hash table"', async () => {
  // 不调 setupHashes，保持空表
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const { containsBannedSubstring } = await freshFilter()

  await containsBannedSubstring('aaa', { SENSITIVE_WORDS_HMAC_KEY: TEST_KEY })

  const calls = warnSpy.mock.calls.filter(c =>
    String(c[0]).includes('[sensitive-words] disabled: empty hash table')
  )
  expect(calls).toHaveLength(1)

  warnSpy.mockRestore()
})
```

- [ ] **Step 2: 跑测试确认 fail**

```bash
pnpm test:run src/workers/sensitiveWordFilter.test.ts
```

预期：3 个新测试 FAIL。

- [ ] **Step 3: 在 filter 中加 `runHealthCheck`**

修改 `src/workers/sensitiveWordFilter.ts`。

在 `import` 之后加 module-scope flag：

```ts
let healthChecked = false
```

在 `containsBannedSubstring` 之前插入：

```ts
async function runHealthCheck(env: SensitiveWordEnv): Promise<void> {
  if (healthChecked) return
  healthChecked = true

  if (!env.SENSITIVE_WORDS_HMAC_KEY) {
    console.warn('[sensitive-words] disabled: missing SENSITIVE_WORDS_HMAC_KEY')
    return
  }
  if (LENGTHS.length === 0) {
    console.warn('[sensitive-words] disabled: empty hash table')
    return
  }

  let total = 0
  for (const L of LENGTHS) total += HASHES.get(L)?.size ?? 0
  console.log(`[sensitive-words] active: ${total} entries across ${LENGTHS.length} lengths`)
}
```

修改 `containsBannedSubstring`，在第一行加：

```ts
export async function containsBannedSubstring(id: string, env: SensitiveWordEnv): Promise<boolean> {
  await runHealthCheck(env)

  if (!env.SENSITIVE_WORDS_HMAC_KEY || LENGTHS.length === 0) return false
  // ...（原有逻辑保持不变）
}
```

- [ ] **Step 4: 跑全部 filter 测试**

```bash
pnpm test:run src/workers/sensitiveWordFilter.test.ts
```

预期：之前 6 条 + 新增 3 条 = 9 条 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/workers/sensitiveWordFilter.ts src/workers/sensitiveWordFilter.test.ts
git commit -m "feat(id-filter): 加 sensitiveWordFilter 健康状态日志（首次调用 log）"
```

---

## Task 6: 加 KEY_FINGERPRINT drift 校验

**目标**：runtime 首次调用时算 fingerprint 对比 generated 模块写死的值，对不上写 warn。Drift 时 fail-open（继续走滑窗匹配，但因 key 不同自然不会命中）。

**Files:**

- Modify: `src/workers/sensitiveWordFilter.ts`
- Modify: `src/workers/sensitiveWordFilter.test.ts`

- [ ] **Step 1: 写测试 — fingerprint 不一致 log warn 并不命中**

```ts
it('runtime key 与 KEY_FINGERPRINT 不一致时 log drift warn，且不命中', async () => {
  // 用 OTHER_KEY 算出 banword 哈希以及 fingerprint，模拟 generated 表
  const OTHER_KEY = 'other-key-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  const hashedWithOther = await hmacB64Trunc(OTHER_KEY, 'banword')
  const fingerprintWithOther = await hmacB64Trunc(OTHER_KEY, FINGERPRINT_MAGIC)
  vi.mocked(generated, true).HASHES = new Map([[7, new Set([hashedWithOther])]])
  ;(generated as { LENGTHS: number[] }).LENGTHS = [7]
  ;(generated as { KEY_FINGERPRINT: string }).KEY_FINGERPRINT = fingerprintWithOther

  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const { containsBannedSubstring } = await freshFilter()

  // runtime 用 TEST_KEY（不同），匹配应失败 + log drift
  const hit = await containsBannedSubstring('xxbanwordyy', {
    SENSITIVE_WORDS_HMAC_KEY: TEST_KEY,
  })
  expect(hit).toBe(false)

  const driftCalls = warnSpy.mock.calls.filter(c =>
    String(c[0]).includes('[sensitive-words] key drift')
  )
  expect(driftCalls).toHaveLength(1)

  warnSpy.mockRestore()
})

it('runtime key 与 KEY_FINGERPRINT 一致时不 log drift', async () => {
  await setupHashes(['banword']) // setupHashes 内部已 set 与 TEST_KEY 一致的 fingerprint
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const { containsBannedSubstring } = await freshFilter()

  await containsBannedSubstring('xxbanwordyy', { SENSITIVE_WORDS_HMAC_KEY: TEST_KEY })

  const driftCalls = warnSpy.mock.calls.filter(c =>
    String(c[0]).includes('[sensitive-words] key drift')
  )
  expect(driftCalls).toHaveLength(0)

  warnSpy.mockRestore()
})
```

- [ ] **Step 2: 跑测试确认 fail**

```bash
pnpm test:run src/workers/sensitiveWordFilter.test.ts
```

预期：drift 测试 FAIL（无校验逻辑）。

- [ ] **Step 3: 在 filter 中加 fingerprint 校验**

修改 `src/workers/sensitiveWordFilter.ts`。

修改 import：

```ts
import { HASHES, LENGTHS, KEY_FINGERPRINT } from './sensitiveWordHashes.generated'
```

在 `let healthChecked = false` 之前加常量：

```ts
const FINGERPRINT_MAGIC = 'sensitive-words-fingerprint-v1'
```

修改 `runHealthCheck`，在 `LENGTHS.length === 0` 检查之后插入 drift 校验，并把 active log 推后到通过校验之后：

```ts
async function runHealthCheck(env: SensitiveWordEnv): Promise<void> {
  if (healthChecked) return
  healthChecked = true

  if (!env.SENSITIVE_WORDS_HMAC_KEY) {
    console.warn('[sensitive-words] disabled: missing SENSITIVE_WORDS_HMAC_KEY')
    return
  }
  if (LENGTHS.length === 0) {
    console.warn('[sensitive-words] disabled: empty hash table')
    return
  }

  const key = await getHmacKey(env.SENSITIVE_WORDS_HMAC_KEY)
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(FINGERPRINT_MAGIC))
  const fp = hashToBase64Trunc(sig)
  if (fp !== KEY_FINGERPRINT) {
    console.warn(
      '[sensitive-words] key drift: runtime key does not match generated table; filter will not match anything'
    )
    return
  }

  let total = 0
  for (const L of LENGTHS) total += HASHES.get(L)?.size ?? 0
  console.log(`[sensitive-words] active: ${total} entries across ${LENGTHS.length} lengths`)
}
```

- [ ] **Step 4: 跑全部 filter 测试**

```bash
pnpm test:run src/workers/sensitiveWordFilter.test.ts
```

预期：所有测试 PASS（drift case 因 runtime HMAC 与 generated hash 来源不同 key，自然不命中——不需要额外短路；之前的 active log 测试因 setupHashes 已设了一致 fingerprint 不受影响）。

- [ ] **Step 5: 提交**

```bash
git add src/workers/sensitiveWordFilter.ts src/workers/sensitiveWordFilter.test.ts
git commit -m "feat(id-filter): 加 KEY_FINGERPRINT drift 校验"
```

---

## Task 7: 集成到 `timelines.ts handlePost` — 重试 + 500 fallback

**目标**：把 `generateId()` 包成 `generateCleanId(env)`，最多 32 次重试，全失败返 500。

**Files:**

- Modify: `src/workers/timelines.ts:91-125`（`handlePost`）
- Modify: `src/workers/timelines.test.ts`

- [ ] **Step 1: 在 timelines.test.ts 顶部 import 区加 `vi`（如未导入）**

打开 `src/workers/timelines.test.ts`，确认顶部：

```ts
import { describe, it, expect, vi } from 'vitest'
```

如果原本只有 `describe, it, expect`，补上 `vi`。

- [ ] **Step 2: 加测试 — 前 3 次命中、第 4 次干净**

在 `describe('POST /api/timelines'`内追加：

```ts
it('过滤器命中前 3 次后第 4 次过审，仍返回 201', async () => {
  const filterModule = await import('./sensitiveWordFilter')
  const spy = vi.spyOn(filterModule, 'containsBannedSubstring')
  spy
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(true)
    .mockResolvedValue(false)

  const env = makeMockEnv(makeMockD1())
  const token = await makeAccessToken('user1', 'TestUser', 'test-secret')
  const req = new Request('https://example.com/api/timelines', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ timeline: MINIMAL_TIMELINE }),
  })
  const res = await handleTimelines(req, env)
  expect(res.status).toBe(201)
  expect(spy).toHaveBeenCalledTimes(4)

  spy.mockRestore()
})

it('过滤器连续 32 次命中后返回 500 id_generation_failed', async () => {
  const filterModule = await import('./sensitiveWordFilter')
  const spy = vi.spyOn(filterModule, 'containsBannedSubstring')
  spy.mockResolvedValue(true)

  const env = makeMockEnv(makeMockD1())
  const token = await makeAccessToken('user1', 'TestUser', 'test-secret')
  const req = new Request('https://example.com/api/timelines', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ timeline: MINIMAL_TIMELINE }),
  })
  const res = await handleTimelines(req, env)
  expect(res.status).toBe(500)
  const body = (await res.json()) as { error: string }
  expect(body.error).toBe('id_generation_failed')
  expect(spy).toHaveBeenCalledTimes(32)

  spy.mockRestore()
})

it('过滤器从不命中（默认空表）时与既有路径一致：201 + 21 位 ID', async () => {
  // 不 spy；用真实 filter，generated 模块当前空表 → no-op → 总返 false
  const env = makeMockEnv(makeMockD1())
  const token = await makeAccessToken('user1', 'TestUser', 'test-secret')
  const req = new Request('https://example.com/api/timelines', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ timeline: MINIMAL_TIMELINE }),
  })
  const res = await handleTimelines(req, env)
  expect(res.status).toBe(201)
  const body = (await res.json()) as { id: string }
  expect(body.id).toMatch(/^[0-9A-Za-z]{21}$/)
})
```

- [ ] **Step 3: 跑测试确认前两条 fail**

```bash
pnpm test:run src/workers/timelines.test.ts
```

预期：spy 测试 FAIL（filter 没被调）。第三条 PASS（兼容路径）。

- [ ] **Step 4: 修改 `handlePost` 接入 filter**

打开 `src/workers/timelines.ts`，文件顶部 import 区追加（**用 namespace import**，让 `vi.spyOn` 在 timelines.test 里能拦截 — named import 受 ESM live binding 影响，spy 可能失效）：

```ts
import * as sensitiveWordFilter from './sensitiveWordFilter'
```

在文件顶部常量区（`function formatIssues` 之前）加：

```ts
const ID_GEN_MAX_ATTEMPTS = 32

class IdGenerationError extends Error {
  constructor() {
    super('id generation exhausted')
  }
}

async function generateCleanId(env: Env): Promise<string> {
  for (let i = 0; i < ID_GEN_MAX_ATTEMPTS; i++) {
    const id = generateId()
    if (!(await sensitiveWordFilter.containsBannedSubstring(id, env))) return id
  }
  throw new IdGenerationError()
}
```

修改 `handlePost`，把：

```ts
const newId = generateId()
```

替换为：

```ts
let newId: string
try {
  newId = await generateCleanId(env)
} catch (e) {
  if (e instanceof IdGenerationError) {
    return jsonRes({ error: 'id_generation_failed' }, 500, env.ALLOWED_ORIGIN)
  }
  throw e
}
```

- [ ] **Step 5: 跑 timelines 全部测试**

```bash
pnpm test:run src/workers/timelines.test.ts
```

预期：全部 PASS。

- [ ] **Step 6: 跑全量门禁**

```bash
pnpm test:run
pnpm lint
pnpm exec tsc --noEmit
```

预期：均无错误。

- [ ] **Step 7: 提交**

```bash
git add src/workers/timelines.ts src/workers/timelines.test.ts
git commit -m "feat(id-filter): 在 handlePost 接入过滤器并最多重试 32 次"
```

---

## Task 8: Benchmark

**目标**：加 `sensitiveWordFilter.bench.ts`，本地手动跑（`pnpm vitest bench`），不进 CI、不进默认 test:run。

**Files:**

- Create: `src/workers/sensitiveWordFilter.bench.ts`

- [ ] **Step 1: 创建 bench 文件**

```ts
/// <reference types="@cloudflare/workers-types" />

import { bench, describe } from 'vitest'
import { generateId } from '@/utils/id'
import { containsBannedSubstring } from './sensitiveWordFilter'

// 直接读真实生成模块。规模由 secrets/sensitive-words.txt 决定；
// 想测不同规模就改 txt 重跑 pnpm gen:sensitive-words 再跑 bench。

const env = {
  // 用本地 .dev.vars 中的同一把 key（开发者自行注入或从 process.env 读）
  SENSITIVE_WORDS_HMAC_KEY: process.env.SENSITIVE_WORDS_HMAC_KEY ?? 'dev-bench-placeholder-key',
}

describe('sensitiveWordFilter benchmarks', () => {
  bench('containsBannedSubstring (random ID)', async () => {
    await containsBannedSubstring(generateId(), env)
  })

  bench('generateCleanId-equivalent (1 attempt expected)', async () => {
    // 等价复刻 timelines.ts 的 generateCleanId（不 export 那个 helper）
    for (let i = 0; i < 32; i++) {
      const id = generateId()
      if (!(await containsBannedSubstring(id, env))) return
    }
  })
})
```

- [ ] **Step 2: 验证 bench 命令能跑通**

```bash
pnpm vitest bench --run src/workers/sensitiveWordFilter.bench.ts
```

预期：输出两条 bench 结果（ops/sec），无错误。

- [ ] **Step 3: 提交**

```bash
git add src/workers/sensitiveWordFilter.bench.ts
git commit -m "feat(id-filter): 加 sensitiveWordFilter benchmark（本地手动跑）"
```

---

## Task 9: 端到端验证 + 全量门禁

**目标**：本机做一次端到端：放真实词表 → 重新生成 → 跑全量测试 + lint + tsc + 启动 dev 看启用日志。所有都过才算完。

**Files:**

- 临时：`secrets/sensitive-words.txt`（开发者本机，不入 git）
- 重生成：`src/workers/sensitiveWordHashes.generated.ts`

- [ ] **Step 1: 放一份真实敏感词 txt**

在 `secrets/sensitive-words.txt` 写入实际词表（每行一个；空行与 `#` 注释跳过）。

- [ ] **Step 2: 重新生成哈希表**

```bash
pnpm gen:sensitive-words
```

预期输出：`Generated N hashes across M length buckets`。

- [ ] **Step 3: 跑全量测试**

```bash
pnpm test:run
```

预期：全部 PASS。

- [ ] **Step 4: lint + tsc**

```bash
pnpm lint
pnpm exec tsc --noEmit
```

预期：均无错误。

- [ ] **Step 5: 启动 dev，观察启用日志**

```bash
pnpm dev
```

在另一个 shell 用 curl 触发一次 POST（带合法 JWT），或在浏览器发布一次时间轴。dev 控制台应当看到一行（仅一次）：

```
[sensitive-words] active: <N> entries across <M> lengths
```

不应当看到任何敏感词明文或哈希。

- [ ] **Step 6: 确认 secrets/ 不在 git status**

```bash
git status --short
```

预期：`secrets/sensitive-words.txt` 不出现在输出中（已被 `.gitignore` 排除）。

- [ ] **Step 7: 提交更新后的生成模块**

```bash
git add src/workers/sensitiveWordHashes.generated.ts
git commit -m "feat(id-filter): 重新生成哈希表（首批真实词）"
```

- [ ] **Step 8: 推送 + 部署 readiness**

```bash
git push
```

部署前 checklist：

- [ ] Cloudflare `wrangler secret put SENSITIVE_WORDS_HMAC_KEY` 已与本机 `.dev.vars` 同值
- [ ] 本机 `secrets/sensitive-words.txt` 已 gitignore（确认 `git status` 不显示该文件）
- [ ] `src/workers/sensitiveWordHashes.generated.ts` 已 commit 入 git
- [ ] 全部 test/lint/tsc 通过

---

## 完成标准（自审）

- 能在本机改词表 → `pnpm gen:sensitive-words` → 哈希模块更新 → 测试通过 → push
- 部署后线上 worker 日志能看到 `[sensitive-words] active: ...`
- 错误注入：临时改 Workers Secret 后 deploy → 日志出现 `key drift: ...`
- 错误注入：临时把 generated 模块手改成空 → 日志出现 `disabled: empty hash table`，发布请求不被阻塞
