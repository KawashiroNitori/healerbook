import path from 'node:path'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@\/resources/,
        replacement: path.resolve(__dirname, './3rdparty/ff14-overlay-vue/src/resources'),
      },
      {
        find: '@ff14-overlay',
        replacement: path.resolve(__dirname, './3rdparty/ff14-overlay-vue/src'),
      },
      {
        find: '@',
        replacement: path.resolve(__dirname, './src'),
      },
    ],
  },
  plugins: [
    cloudflareTest(async () => {
      const migrationsPath = path.join(__dirname, 'migrations')
      const migrations = await readD1Migrations(migrationsPath)
      return {
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          compatibilityFlags: ['nodejs_compat_v2'],
          bindings: {
            JWT_SECRET: 'test-secret',
            SYNC_AUTH_TOKEN: 'test-sync-token',
            // auth callback 经 SELF.fetch 触发真实 worker，需要这两个值非空（见 auth.ts 配置校验）。
            // 显式注入测试占位值，避免测试隐式依赖 gitignored 的 .dev.vars（本地有、CI 无 → 500）。
            FFLOGS_CLIENT_ID: 'test-client-id',
            FFLOGS_CLIENT_SECRET: 'test-client-secret',
            TEST_MIGRATIONS: migrations,
          },
        },
      }
    }),
  ],
  test: {
    include: ['**/*.workers.test.ts'],
    setupFiles: ['./src/workers/durable/applyMigrations.workers.setup.ts'],
  },
})
