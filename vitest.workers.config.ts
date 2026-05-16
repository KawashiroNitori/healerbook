import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'
import path from 'path'

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
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        compatibilityFlags: ['nodejs_compat_v2'],
      },
    }),
  ],
  test: {
    include: ['**/*.workers.test.ts'],
  },
})
