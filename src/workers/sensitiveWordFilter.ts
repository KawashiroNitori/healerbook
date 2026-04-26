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
