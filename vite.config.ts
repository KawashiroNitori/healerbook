import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      // 代理 FFLogs API 到 Workers
      '/api/fflogs': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
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
