import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { execSync } from 'child_process'
import { cloudflare } from '@cloudflare/vite-plugin'
import { VitePWA } from 'vite-plugin-pwa'

function getCommitHash() {
  if (process.env.CF_PAGES_COMMIT_SHA) return process.env.CF_PAGES_COMMIT_SHA.slice(0, 7)
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim()
  } catch {
    return 'dev'
  }
}

// https://vite.dev/config/
export default defineConfig({
  define: {
    __COMMIT_HASH__: JSON.stringify(getCommitHash()),
  },
  plugins: [
    react(),
    cloudflare({
      // 配置 Worker 入口
      configPath: './wrangler.toml',
    }),
    VitePWA({
      // 静默更新：新版本下次访问自动生效
      registerType: 'autoUpdate',
      // 让插件自动注入 SW 注册脚本到 index.html，src 代码零侵入
      injectRegister: 'auto',
      // 不生成 manifest.webmanifest，纯 SW 缓存
      manifest: false,
      workbox: {
        // precache 所有 Vite 构建产物：lazy chunk（EditorPage 等）首访 install 期间
        // 后台下载，二访起从 SW cache 命中，实现"前置预加载"目标
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2,ttf}'],
        // SPA 客户端路由 fallback：/timeline/:id 等未匹配静态文件的请求回退到 index.html
        navigateFallback: '/index.html',
        // /api/* 走 Cloudflare Workers，/docs/* 是独立 VitePress 站点，二者都不走 SPA fallback
        navigateFallbackDenylist: [/^\/api/, /^\/docs/],
        // 旧版本 SW 缓存清理
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          konva: ['konva', 'react-konva'],
          radix: [
            '@radix-ui/react-alert-dialog',
            '@radix-ui/react-dialog',
            '@radix-ui/react-scroll-area',
            '@radix-ui/react-select',
            '@radix-ui/react-slot',
            '@radix-ui/react-switch',
          ],
          query: ['@tanstack/react-query'],
          graphql: ['graphql', 'graphql-request'],
          router: ['react-router-dom'],
        },
      },
    },
  },
  server: {
    proxy: {
      '/docs': {
        target: 'http://localhost:5174',
        rewrite: path => path,
      },
    },
  },
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
