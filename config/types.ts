/**
 * 应用配置类型定义
 */

import type { Encounter } from '../types/timeline'

/**
 * 应用配置
 */
export interface AppConfig {
  /** FFLogs 配置 */
  fflogs: FFLogsConfig
  /** TOP100 配置 */
  top100: Top100Config
  /** 定时任务配置 */
  cron: CronConfig
  /** 存储配置 */
  storage: StorageConfig
  /** 功能开关 */
  features: FeaturesConfig
}

/**
 * FFLogs 配置
 */
export interface FFLogsConfig {
  /** API URL */
  apiUrl: string
  /** API Token */
  apiToken: string
  /** 速率限制 */
  rateLimit: RateLimitConfig
}

/**
 * 速率限制配置
 */
export interface RateLimitConfig {
  /** 每分钟请求数 */
  requestsPerMinute: number
  /** 重试次数 */
  retryAttempts: number
  /** 重试延迟（毫秒） */
  retryDelayMs: number
}

/**
 * TOP100 配置
 */
export interface Top100Config {
  /** 抓取数量 */
  limit: number
  /** 副本列表 */
  encounters: EncounterConfig[]
  /** 缓存过期天数 */
  cacheExpirationDays: number
}

/**
 * 副本配置
 */
export interface EncounterConfig {
  /** 副本 ID */
  id: number
  /** 副本名称（用于 URL） */
  name: string
  /** 显示名称 */
  displayName: string
  /** 区域 */
  zone: string
  /** 难度 */
  difficulty: 'savage' | 'ultimate' | 'extreme'
  /** 是否启用 */
  enabled: boolean
}

/**
 * 定时任务配置
 */
export interface CronConfig {
  /** Cron 表达式 */
  schedule: string
  /** 时区 */
  timezone: string
  /** 是否启用 */
  enabled: boolean
}

/**
 * 存储配置
 */
export interface StorageConfig {
  /** R2 存储桶名称 */
  r2Bucket: string
  /** KV 命名空间 */
  kvNamespace: string
}

/**
 * 功能开关配置
 */
export interface FeaturesConfig {
  /** 启用 TOP100 功能 */
  enableTop100: boolean
  /** 启用手动导入 */
  enableManualImport: boolean
  /** 启用自动保存 */
  enableAutoSave: boolean
}
