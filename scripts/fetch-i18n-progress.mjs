/**
 * 拉取 Crowdin 各语言翻译 / 审校进度，写入 src/i18n/progress.json。
 *
 * 由 Crowdin Sync workflow 在译文回流时运行，快照随回流 PR 一起进仓库；
 * 前端据此决定哪些语言对用户可见（见 src/i18n/availability.ts）。
 *
 * 刻意不接入 `pnpm build`：生产构建环境没有 Crowdin 凭证，且翻译进度是慢变量，
 * 与译文同源同频更新即可。本地手动跑需先在 .env 提供凭证。
 *
 * 无第三方依赖（用 Node 内置 fetch），workflow 中无需 pnpm install。
 */
import { writeFileSync } from 'node:fs'

const projectId = process.env.CROWDIN_PROJECT_ID
const token = process.env.CROWDIN_PERSONAL_TOKEN

if (!projectId || !token) {
  console.warn('[i18n-progress] 缺少 CROWDIN_PROJECT_ID / CROWDIN_PERSONAL_TOKEN，跳过')
  process.exit(0)
}

const res = await fetch(
  `https://api.crowdin.com/api/v2/projects/${projectId}/languages/progress?limit=100`,
  { headers: { Authorization: `Bearer ${token}` } }
)

if (!res.ok) {
  console.error(`[i18n-progress] Crowdin API ${res.status}: ${await res.text()}`)
  process.exit(1)
}

const { data } = await res.json()

// languageId 与应用内的 AppLanguage 取值一致（zh-TW / ja / en / de / fr），
// 项目里多出的目标语言（如 ko）一并记录，由前端按 SUPPORTED_LOCALES 取用
const progress = {}
for (const { data: row } of data) {
  progress[row.languageId] = {
    translated: row.translationProgress,
    approved: row.approvalProgress,
  }
}

const sorted = Object.fromEntries(Object.entries(progress).sort(([a], [b]) => a.localeCompare(b)))
writeFileSync('src/i18n/progress.json', `${JSON.stringify(sorted, null, 2)}\n`)

const summary = Object.entries(sorted)
  .map(([l, p]) => `${l} ${p.translated}/${p.approved}%`)
  .join('  ')
console.log(`[i18n-progress] 已写入 src/i18n/progress.json（翻译/审校）: ${summary}`)
