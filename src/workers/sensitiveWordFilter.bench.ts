/// <reference types="@cloudflare/workers-types" />

import { bench, describe } from 'vitest'
import { generateId } from '@/utils/id'
import { containsBannedSubstring } from './sensitiveWordFilter'

// 直接读真实生成模块。规模由 secrets/sensitive-words.txt 决定；
// 想测不同规模就改 txt 重跑 pnpm gen:sensitive-words 再跑 bench。

declare const process: { env: Record<string, string | undefined> } | undefined

const env = {
  // 用本地 .dev.vars 中的同一把 key（开发者自行注入或从 process.env 读）
  SENSITIVE_WORDS_HMAC_KEY:
    (typeof process !== 'undefined' ? process.env.SENSITIVE_WORDS_HMAC_KEY : undefined) ??
    'dev-bench-placeholder-key',
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
