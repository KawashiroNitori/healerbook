/// <reference types="@cloudflare/workers-types" />

import { FFLogsClientV2 } from './fflogsClientV2'

export interface Env {
  FFLOGS_CLIENT_ID?: string
  FFLOGS_CLIENT_SECRET?: string
  SYNC_AUTH_TOKEN?: string
  healerbook: KVNamespace
  healerbook_timelines: D1Database
  FFLOGS_OAUTH_REDIRECT_URI?: string
  JWT_SECRET?: string
  ALLOWED_ORIGIN?: string
  SENSITIVE_WORDS_HMAC_KEY?: string
}

export type AppEnv = {
  Bindings: Env
  Variables: {
    auth?: { userId: string; username: string }
  }
}

export function createClient(env: Env): FFLogsClientV2 {
  if (!env.FFLOGS_CLIENT_ID || !env.FFLOGS_CLIENT_SECRET) {
    throw new Error('FFLogs v2 credentials not configured')
  }
  return new FFLogsClientV2({
    clientId: env.FFLOGS_CLIENT_ID,
    clientSecret: env.FFLOGS_CLIENT_SECRET,
    kv: env.healerbook,
  })
}
