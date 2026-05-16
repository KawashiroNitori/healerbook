import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: [{ find: '@', replacement: path.resolve(__dirname, './src') }],
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      // 使用最小 Worker 入口代替完整 app，避免 @ff14-overlay/resources 在 miniflare 中无法解析。
      // 完整 app 的路由层（routes/fflogs.ts → fflogsImporter.ts → @ff14-overlay）
      // 在 DO 单元测试中不需要。
      main: path.resolve(__dirname, 'src/workers/collab/__stubs__/testWorkerEntry.ts'),
      miniflare: {
        compatibilityFlags: ['nodejs_compat_v2'],
      },
    }),
  ],
  test: {
    include: ['**/*.workers.test.ts'],
  },
})
