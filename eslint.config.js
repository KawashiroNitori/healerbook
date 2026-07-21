import js from '@eslint/js'
import globals from 'globals'
import i18next from 'eslint-plugin-i18next'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// 仅匹配「完全不含 CJK 中文字符」的字符串。把它放进 no-literal-string 的
// words.exclude，等价于"只对含中文的字面量告警"，避免纯英文/技术字面量误报。
const NO_CJK_STRING = /^[^一-鿿㐀-䶿]*$/

export default defineConfig([
  globalIgnores(['dist', '3rdparty', '**/.vitepress/cache']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  // i18n 回归闸：防止 UI 层新增硬编码中文文案。仅对含 CJK 字符的字面量以 warn 告警，
  // 并排除 console.*/t()/i18n.t()/track() 等调用参数，避免海量误报淹没 warning。
  {
    files: ['src/components/**/*.{ts,tsx}', 'src/pages/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}'],
    plugins: { i18next },
    rules: {
      'i18next/no-literal-string': [
        'warn',
        {
          mode: 'all',
          words: { exclude: [NO_CJK_STRING] },
          callees: {
            exclude: [
              'i18n(ext)?',
              't',
              'console(\\.(log|warn|error|info|debug|trace))?',
              'track',
              'require',
              'addEventListener',
              'removeEventListener',
              'postMessage',
              'getElementById',
              'dispatch',
              'commit',
              'includes',
              'indexOf',
              'endsWith',
              'startsWith',
            ],
          },
        },
      ],
    },
  },
])
