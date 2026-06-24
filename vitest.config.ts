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
      // jsdom 环境下用简化 stub 替换 Radix DropdownMenu，
      // 使 fireEvent.click 可以正常触发菜单打开（Radix 只监听 pointerdown）。
      // 注意：必须在 @/ 通配别名之前声明，否则 @/ 先匹配后此条永远不会生效。
      {
        find: '@/components/ui/dropdown-menu',
        replacement: path.resolve(__dirname, './src/components/ui/__mocks__/dropdown-menu.tsx'),
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
