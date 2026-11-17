// 分诊配额闸门：在调用模型之前用确定性规则决定是否放行，超额时只打降级标签转人工。
const { addFallbackLabel } = require('./ai-publish.cjs')

const TRUSTED = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])
const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_PER_USER = 3
const DEFAULT_TOTAL = 20

// 仓库 Variable 未设置时 GitHub 传入空字符串，此时使用默认值。
function readLimit(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback
  const n = Number(value)
  return Number.isInteger(n) && n >= 0 ? n : fallback
}

// 统计 since 之后创建的 issue（不含 PR）。列表按创建时间倒序，遇到更早的即停止；
// 计数超过 stopAt 后也提前返回，避免翻页过多。
async function countRecentIssues({ github, repo, since, creator, stopAt }) {
  let count = 0
  const params = { ...repo, state: 'all', sort: 'created', direction: 'desc', per_page: 100 }
  if (creator) params.creator = creator
  for await (const { data } of github.paginate.iterator(github.rest.issues.listForRepo, params)) {
    for (const issue of data) {
      if (Date.parse(issue.created_at) < since) return count
      if (!issue.pull_request) count++
      if (count > stopAt) return count
    }
  }
  return count
}

// 返回跳过原因；放行时返回 null。计数包含当前 issue 本身。
async function skipReason({ github, context, now, perUser, total }) {
  const issue = context.payload.issue
  if (issue.user?.type === 'Bot') return 'bot'
  if (TRUSTED.has(issue.author_association)) return null
  const since = now - DAY_MS
  const repo = context.repo
  const own = await countRecentIssues({
    github,
    repo,
    since,
    creator: issue.user.login,
    stopAt: perUser,
  })
  if (own > perUser) return `per-user（24 小时内 ${own} 个，上限 ${perUser}）`
  const all = await countRecentIssues({ github, repo, since, stopAt: total })
  if (all > total) return `total（24 小时内全仓库 ${all} 个，上限 ${total}）`
  return null
}

async function gate({ github, context, core, now = Date.now(), env = process.env }) {
  const perUser = readLimit(env.TRIAGE_DAILY_LIMIT_PER_USER, DEFAULT_PER_USER)
  const total = readLimit(env.TRIAGE_DAILY_LIMIT_TOTAL, DEFAULT_TOTAL)
  const reason = await skipReason({ github, context, now, perUser, total })
  if (!reason) {
    core.setOutput('allowed', 'true')
    return
  }
  core.setOutput('allowed', 'false')
  core.notice(`跳过模型分诊：${reason}`)
  await addFallbackLabel({ github, context, core })
}

module.exports = { gate, skipReason, countRecentIssues, readLimit }
