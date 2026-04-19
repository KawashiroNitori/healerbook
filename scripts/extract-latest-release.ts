import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { marked } from 'marked'

const changelogPath = 'docs/changelog.md'
if (!existsSync(changelogPath)) {
  console.warn('Warning: docs/changelog.md not found, skipping generation')
  process.exit(0)
}

const changelog = readFileSync(changelogPath, 'utf-8')

// 提取第一个 ## date 到下一个 ## 之间的内容
// 注意 lookahead 用 `(?![\s\S])` 表示真·字符串结尾（/m 模式下 `$` 会匹配每行末尾，会截断多行条目）
const match = changelog.match(/^## (\d{4}-\d{2}-\d{2})\s*\n([\s\S]*?)(?=\n## |\n*(?![\s\S]))/m)
if (!match) {
  console.warn('Warning: no changelog entry found in docs/changelog.md, skipping generation')
  process.exit(0)
}

const [, date] = match
let content = match[2]

// 解析 <!-- viewUrl: /foo --> 标记（必须紧跟在 ## date 之后的第一行）
const viewUrlHeaderMatch = content.match(/^\s*<!--\s*viewUrl:\s*(\S+?)\s*-->\s*\n/)
const viewUrl = viewUrlHeaderMatch ? viewUrlHeaderMatch[1] : undefined
if (viewUrlHeaderMatch) {
  content = content.slice(viewUrlHeaderMatch[0].length)
}

// 过滤掉图片、表格、代码块、HTML 块等占地面积大的元素
const lines = content.trim().split('\n')
const filtered: string[] = []
let inCodeBlock = false
let inHtmlBlock = false
for (const line of lines) {
  if (/^```/.test(line)) {
    inCodeBlock = !inCodeBlock
    continue
  }
  if (inCodeBlock) continue
  if (/^<(details|video|iframe|table)\b/i.test(line)) inHtmlBlock = true
  if (inHtmlBlock) {
    if (/^<\/(details|video|iframe|table)>/i.test(line)) inHtmlBlock = false
    continue
  }
  if (/^!\[/.test(line) || /^\|/.test(line)) continue
  filtered.push(line)
}

const filteredText = filtered.join('\n').trim()
if (!filteredText) {
  console.warn('Warning: changelog entry is empty after filtering, skipping generation')
  process.exit(0)
}

const html = await marked(filteredText)
const id = createHash('sha256').update(filteredText).digest('hex').slice(0, 8)

const output = JSON.stringify({ id, date, html, ...(viewUrl ? { viewUrl } : {}) }, null, 2)
writeFileSync('public/latest-release.json', output)
console.log(`Extracted latest release: ${date} (${id})${viewUrl ? ` → ${viewUrl}` : ''}`)
