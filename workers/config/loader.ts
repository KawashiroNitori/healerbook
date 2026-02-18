/**
 * 配置加载器
 * 从环境变量和 KV 存储加载配置
 */

import { defaultConfig } from '../../config/default'
import type { AppConfig } from '../../config/types'

/**
 * Cloudflare Workers 环境变量
 */
export interface Env {
  /** 环境名称 */
  ENVIRONMENT: string

  // FFLogs
  /** FFLogs API Token */
  FFLOGS_API_TOKEN: string
  /** FFLogs API URL */
  FFLOGS_API_URL?: string

  // TOP100
  /** TOP100 抓取数量 */
  TOP100_LIMIT?: string
  /** 缓存过期天数 */
  CACHE_EXPIRATION_DAYS?: string

  // Cron
  /** Cron 表达式 */
  CRON_SCHEDULE?: string
  /** 是否启用 Cron */
  CRON_ENABLED?: string

  // Rate Limiting
  /** 每分钟请求数 */
  RATE_LIMIT_RPM?: string
  /** 重试次数 */
  RETRY_ATTEMPTS?: string

  // KV (用于动态配置)
  KV: KVNamespace
}

/**
 * 加载配置
 * 优先级：KV 动态配置 > 环境变量 > 默认配置
 */
export async function loadConfig(env: Env): Promise<AppConfig> {
  // 1. 从默认配置开始
  const config: AppConfig = JSON.parse(JSON.stringify(defaultConfig))

  // 2. 从环境变量覆盖
  if (env.FFLOGS_API_TOKEN) {
    config.fflogs.apiToken = env.FFLOGS_API_TOKEN
  }

  if (env.FFLOGS_API_URL) {
    config.fflogs.apiUrl = env.FFLOGS_API_URL
  }

  if (env.TOP100_LIMIT) {
    config.top100.limit = parseInt(env.TOP100_LIMIT, 10)
  }

  if (env.CRON_SCHEDULE) {
    config.cron.schedule = env.CRON_SCHEDULE
  }

  if (env.CRON_ENABLED) {
    config.cron.enabled = env.CRON_ENABLED === 'true'
  }

  if (env.RATE_LIMIT_RPM) {
    config.fflogs.rateLimit.requestsPerMinute = parseInt(env.RATE_LIMIT_RPM, 10)
  }

  if (env.RETRY_ATTEMPTS) {
    config.fflogs.rateLimit.retryAttempts = parseInt(env.RETRY_ATTEMPTS, 10)
  }

  if (env.CACHE_EXPIRATION_DAYS) {
    config.top100.cacheExpirationDays = parseInt(env.CACHE_EXPIRATION_DAYS, 10)
  }

  // 3. 从 KV 读取动态配置（可选，用于无需重新部署即可修改）
  try {
    const dynamicConfig = await env.KV.get('config:dynamic', 'json')
    if (dynamicConfig) {
      // 深度合并动态配置
      mergeConfig(config, dynamicConfig)
    }
  } catch (error) {
    console.warn('Failed to load dynamic config from KV:', error)
  }

  // 4. 验证配置
  validateConfig(config)

  return config
}

/**
 * 深度合并配置对象
 */
function mergeConfig(target: any, source: any): void {
  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      if (!target[key]) target[key] = {}
      mergeConfig(target[key], source[key])
    } else {
      target[key] = source[key]
    }
  }
}

/**
 * 验证配置
 */
function validateConfig(config: AppConfig): void {
  // 验证 FFLogs API Token
  if (!config.fflogs.apiToken) {
    throw new Error('FFLOGS_API_TOKEN is required')
  }

  // 验证 TOP100 限制
  if (config.top100.limit < 1 || config.top100.limit > 1000) {
    throw new Error('TOP100_LIMIT must be between 1 and 1000')
  }

  // 验证速率限制
  if (config.fflogs.rateLimit.requestsPerMinute < 1) {
    throw new Error('RATE_LIMIT_RPM must be at least 1')
  }

  // 验证 Cron 表达式格式（简单验证）
  const cronParts = config.cron.schedule.split(' ')
  if (cronParts.length !== 5) {
    throw new Error('Invalid CRON_SCHEDULE format (expected 5 parts)')
  }

  // 验证缓存过期天数
  if (config.top100.cacheExpirationDays < 1) {
    throw new Error('CACHE_EXPIRATION_DAYS must be at least 1')
  }
}
