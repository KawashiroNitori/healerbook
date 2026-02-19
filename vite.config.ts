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
      '/api/icons': {
        target: 'https://cafemaker.wakingsands.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/icons/, ''),
      },
    },
  },
  test: {
    globals: true,
    environment: 'node',
  },
})
