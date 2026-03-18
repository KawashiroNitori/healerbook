/**
 * 默认配置
 */

import type { AppConfig } from './types'

export const defaultConfig: AppConfig = {
  fflogs: {
    apiUrl: 'https://www.fflogs.com/api/v2/client',
    apiToken: '', // 从环境变量读取
    rateLimit: {
      requestsPerMinute: 30,
      retryAttempts: 3,
      retryDelayMs: 1000,
    },
  },

  top100: {
    limit: 100, // 默认抓取 100 条
    encounters: [
      // Anabaseios (Savage) - 7.0 零式
      {
        id: 95,
        name: 'p9s',
        displayName: 'P9S',
        zone: 'Anabaseios',
        difficulty: 'savage',
        enabled: true,
      },
      {
        id: 96,
        name: 'p10s',
        displayName: 'P10S',
        zone: 'Anabaseios',
        difficulty: 'savage',
        enabled: true,
      },
      {
        id: 97,
        name: 'p11s',
        displayName: 'P11S',
        zone: 'Anabaseios',
        difficulty: 'savage',
        enabled: true,
      },
      {
        id: 98,
        name: 'p12s',
        displayName: 'P12S (Part 1)',
        zone: 'Anabaseios',
        difficulty: 'savage',
        enabled: true,
      },
      {
        id: 99,
        name: 'p12s-p2',
        displayName: 'P12S (Part 2)',
        zone: 'Anabaseios',
        difficulty: 'savage',
        enabled: true,
      },

      // Ultimates - 绝境战
      {
        id: 1068,
        name: 'TOP',
        displayName: 'The Omega Protocol (绝欧米茄)',
        zone: 'Ultimate',
        difficulty: 'ultimate',
        enabled: true,
      },
      {
        id: 1065,
        name: 'DSR',
        displayName: "Dragonsong's Reprise (绝龙诗)",
        zone: 'Ultimate',
        difficulty: 'ultimate',
        enabled: true,
      },
      {
        id: 1062,
        name: 'TEA',
        displayName: 'The Epic of Alexander (绝亚历山大)',
        zone: 'Ultimate',
        difficulty: 'ultimate',
        enabled: true,
      },
      {
        id: 1061,
        name: 'UWU',
        displayName: "The Weapon's Refrain (绝神兵)",
        zone: 'Ultimate',
        difficulty: 'ultimate',
        enabled: true,
      },
      {
        id: 1060,
        name: 'UCOB',
        displayName: 'The Unending Coil of Bahamut (绝巴哈)',
        zone: 'Ultimate',
        difficulty: 'ultimate',
        enabled: true,
      },
    ],
    cacheExpirationDays: 7,
  },

  cron: {
    schedule: '0 2 * * *', // 每天凌晨 2 点（UTC）
    timezone: 'UTC',
    enabled: true,
  },

  storage: {
    r2Bucket: 'healerbook-data',
    kvNamespace: 'HEALERBOOK_KV',
  },

  features: {
    enableTop100: true,
    enableManualImport: true,
    enableAutoSave: true,
  },
}
