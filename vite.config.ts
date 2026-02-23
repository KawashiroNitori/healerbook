import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { cloudflare } from '@cloudflare/vite-plugin'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    cloudflare({
      // 配置 Worker 入口
      configPath: './wrangler.toml',
    }),
  ],
  resolve: {
    alias: [
      // ff14-overlay-vue 内部的 @/ 别名（更具体的路径优先匹配）
      {
        find: /^@\/resources/,
        replacement: path.resolve(__dirname, './3rdparty/ff14-overlay-vue/src/resources'),
      },
      // 我们项目的别名
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
  // @ts-expect-error - test 配置由 vitest 提供
  test: {
    globals: true,
    environment: 'node',
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/ff14-overlay-vue/**', // 排除子模块测试
    ],
  },
})
