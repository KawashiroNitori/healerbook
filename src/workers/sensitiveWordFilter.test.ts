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
})
