/// <reference types="@cloudflare/workers-types" />

import { HASHES, LENGTHS, KEY_FINGERPRINT } from './sensitiveWordHashes.generated'

export interface SensitiveWordEnv {
  SENSITIVE_WORDS_HMAC_KEY?: string
}

const FINGERPRINT_MAGIC = 'sensitive-words-fingerprint-v1'

let cachedHmacKey: CryptoKey | null = null
let cachedKeyMaterial: string | null = null
let healthChecked = false

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

export async function containsBannedSubstring(id: string, env: SensitiveWordEnv): Promise<boolean> {
  await runHealthCheck(env)

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
