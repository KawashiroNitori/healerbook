// 发布模型结果前的确定性处理：校验结构、限制标签、清洗 Markdown。
// 模型输出视为不可信内容：可以决定文字，但不能借 bot 身份 @ 人、放外链或藏内容。

const ALLOWED_HOSTS = ['github.com', 'xivhealer.com', 'bilibili.com', 'fflogs.com']
const TRIAGE_LABELS = new Set([
  'bug',
  'enhancement',
  'data',
  'calculation',
  'fflogs',
  'timeline',
  'documentation',
  'question',
])
const FALLBACK_LABEL = 'needs-triage'
const REMOVED_LINK = '‹外链已移除›'

const URL_END = String.raw`[^\s<>()[\]{}"'\x60]`
// 覆盖：任意 scheme://、http(s): 的任意写法（浏览器会把 https:evil.com 解析到 evil.com）、
// 协议相对的 //host 与 \\host、GFM 会自动链接的 www. 前缀。
const URL_PATTERN = new RegExp(
  [
    String.raw`\b[a-z][a-z0-9+.-]*:[\\/]{2}${URL_END}+`,
    String.raw`\bhttps?:${URL_END}*`,
    String.raw`(?<![\w:])[\\/]{2}${URL_END}+`,
    String.raw`\bwww\.${URL_END}+`,
  ].join('|'),
  'gi'
)
// 能携带外链、嵌入外部资源或隐藏内容的标签，在行内出现时直接移除。
const DANGEROUS_TAG =
  /<\/?(?:a|img|image|picture|source|video|audio|track|iframe|frame|object|embed|svg|math|details|summary|dialog|template|form|input|button|textarea|select|base|link|meta|style|script)\b[^>]*>/gi
// 行首（含引用、列表等容器标记之后）的 `<` 会开启 HTML 块，整体转义。
const LINE_START_TAG = /^((?:[ \t]*(?:>|[-*+]|\d{1,9}[.)])[ \t]*)*[ \t]*)<(?=[A-Za-z/])/gm

function isAllowedUrl(raw) {
  let url
  try {
    const absolute = /^[\\/]{2}/.test(raw)
      ? `https:${raw}`
      : /^www\./i.test(raw)
        ? `https://${raw}`
        : raw
    url = new URL(absolute)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  return ALLOWED_HOSTS.some(domain => host === domain || host.endsWith(`.${domain}`))
}

// 按行拆出顶层 fenced code block。代码块内 Markdown/HTML/@ 都不生效，原样保留
// （保证 suggestion 块可直接提交）。只认缩进为 0 的围栏：缩进围栏可能属于列表项，
// 而列表结束时围栏也随之结束，这里统一按普通文本清洗，宁可多洗。
function splitFences(text) {
  const segments = []
  let buffer = []
  let fence = null
  const flush = code => {
    if (buffer.length) segments.push({ code, text: buffer.join('\n') })
    buffer = []
  }
  for (const line of text.split('\n')) {
    if (!fence) {
      const open = /^(`{3,}|~{3,})(.*)$/.exec(line)
      if (open && !(open[1][0] === '`' && open[2].includes('`'))) {
        flush(false)
        fence = open[1]
      }
      buffer.push(line)
      continue
    }
    buffer.push(line)
    const close = /^ {0,3}(`{3,}|~{3,})[ \t]*\r?$/.exec(line)
    if (close && close[1][0] === fence[0] && close[1].length >= fence.length) {
      flush(true)
      fence = null
    }
  }
  // 未闭合的围栏在 GitHub 上会延续到文末，同样视为代码。
  flush(fence !== null)
  return segments
}

function sanitizeText(text) {
  let out = text
    // 字符引用可拼出 @、URL 等，统一按字面显示。
    .replace(/&(?=#|[A-Za-z][A-Za-z0-9]*;)/g, '&amp;')
    // 注释、CDATA、处理指令可隐藏内容：转义后按原文可见。
    .replace(/<(?=[!?])/g, '&lt;')
    .replace(LINE_START_TAG, '$1&lt;')
  let previous
  do {
    previous = out
    out = out.replace(DANGEROUS_TAG, '')
  } while (out !== previous)
  out = out
    .replace(URL_PATTERN, match => (isAllowedUrl(match) ? match : REMOVED_LINK))
    .replace(
      new RegExp(String.raw`(!?)\[([^\]\n]*)\]\(\s*${REMOVED_LINK}[^)\n]*\)`, 'g'),
      (_, image, label) => (image ? '（图片已移除）' : `${label}（外链已移除）`)
    )
    // 零宽空格打断 @ 提醒（含 @org/team），邮箱等前接单词字符的不受影响。
    .replace(/(?<![A-Za-z0-9_])@(?=[A-Za-z0-9_-])/g, '@​')
  return out
}

function sanitizeMarkdown(text) {
  return splitFences(String(text))
    .map(segment => (segment.code ? segment.text : sanitizeText(segment.text)))
    .join('\n')
}

async function repoLabels(github, repo) {
  const labels = await github.paginate(github.rest.issues.listLabelsForRepo, {
    ...repo,
    per_page: 100,
  })
  return new Set(labels.map(l => l.name))
}

// 不自动创建标签：标签不存在时只告警，避免 bot 往仓库里加东西。
async function addFallbackLabel({ github, context, core }) {
  const existing = await repoLabels(github, context.repo)
  if (!existing.has(FALLBACK_LABEL)) {
    core.warning(`仓库缺少 ${FALLBACK_LABEL} 标签，未添加降级标签`)
    return
  }
  await github.rest.issues.addLabels({
    ...context.repo,
    issue_number: context.payload.issue.number,
    labels: [FALLBACK_LABEL],
  })
}

async function publishTriage({ github, context, raw }) {
  const result = JSON.parse(raw)
  if (!Array.isArray(result.labels) || typeof result.comment !== 'string' || !result.comment.trim())
    throw new Error('Invalid triage result')
  const existing = await repoLabels(github, context.repo)
  const labels = [...new Set(result.labels)].filter(l => TRIAGE_LABELS.has(l) && existing.has(l))
  const target = { ...context.repo, issue_number: context.payload.issue.number }
  if (labels.length) await github.rest.issues.addLabels({ ...target, labels })
  await github.rest.issues.createComment({ ...target, body: sanitizeMarkdown(result.comment) })
}

async function publishRespond({ github, context, raw }) {
  if (!raw?.trim()) throw new Error('Empty DeepSeek response')
  const issue_number = context.payload.issue?.number ?? context.payload.pull_request?.number
  if (!Number.isInteger(issue_number)) throw new Error('Missing target number')
  await github.rest.issues.createComment({
    ...context.repo,
    issue_number,
    body: sanitizeMarkdown(raw),
  })
}

// 解析 patch，得到每个文件右侧可评论的行号。
function commentableLines(files) {
  const lines = new Map()
  for (const file of files) {
    const valid = new Set()
    let line = 0
    for (const text of (file.patch ?? '').split('\n')) {
      const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text)
      if (hunk) {
        line = Number(hunk[1])
        continue
      }
      if (text.startsWith('+') || text.startsWith(' ')) valid.add(line++)
    }
    lines.set(file.filename, valid)
  }
  return lines
}

async function publishReview({ github, context, core, raw }) {
  const result = JSON.parse(raw)
  if (
    typeof result.summary !== 'string' ||
    !result.summary.trim() ||
    !Array.isArray(result.comments)
  )
    throw new Error('Invalid review result')
  const target = { ...context.repo, pull_number: context.payload.pull_request.number }
  const pr = (await github.rest.pulls.get(target)).data
  if (pr.head.sha !== context.payload.pull_request.head.sha) {
    core.info('PR changed; skip stale review')
    return
  }
  const files = await github.paginate(github.rest.pulls.listFiles, { ...target, per_page: 100 })
  const lines = commentableLines(files)
  let summary = result.summary
  const comments = []
  for (const c of result.comments) {
    if (typeof c.body !== 'string' || !c.body.trim()) throw new Error('Invalid review comment')
    if (Number.isInteger(c.line) && lines.get(c.path)?.has(c.line))
      comments.push({ path: c.path, line: c.line, side: 'RIGHT', body: sanitizeMarkdown(c.body) })
    else summary += `\n\n${c.path}:${c.line} — ${c.body}`
  }
  // 无法内联的评论连同 path 一起并入总结后再整体清洗。
  await github.rest.pulls.createReview({
    ...target,
    commit_id: pr.head.sha,
    event: 'COMMENT',
    body: sanitizeMarkdown(summary),
    comments,
  })
}

module.exports = {
  ALLOWED_HOSTS,
  FALLBACK_LABEL,
  sanitizeMarkdown,
  isAllowedUrl,
  addFallbackLabel,
  publishTriage,
  publishRespond,
  publishReview,
}
