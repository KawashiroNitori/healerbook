import { coverageConfigDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
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
      // cloudflare:workers 是 workerd 虚拟模块，node 环境不存在；用 stub 代替，
      // 使 index.ts → TimelineDoc 的导入链在 node 测试中也能解析。
      {
        find: 'cloudflare:workers',
        replacement: path.resolve(__dirname, './src/workers/collab/__stubs__/cloudflareWorkers.ts'),
      },
    ],
  },
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    globals: true,
    environment: 'node',
    exclude: ['**/node_modules/**', '**/dist/**', '**/ff14-overlay-vue/**', '**/*.workers.test.ts'],
    coverage: {
      exclude: [
        ...coverageConfigDefaults.exclude,
        '3rdparty/**',
        'src/workers/collab/__stubs__/**',
      ],
    },
  },
})
