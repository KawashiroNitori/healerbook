import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { marked } from 'marked'

const changelogPath = 'docs/changelog.md'
if (!existsSync(changelogPath)) {
  console.warn('Warning: docs/changelog.md not found, skipping generation')
  process.exit(0)
}

const changelog = readFileSync(changelogPath, 'utf-8')

// 提取第一个 ## date 到下一个 ## 之间的内容
const match = changelog.match(/^## (\d{4}-\d{2}-\d{2})\s*\n([\s\S]*?)(?=\n## |\n*$)/m)
if (!match) {
  console.warn('Warning: no changelog entry found in docs/changelog.md, skipping generation')
  process.exit(0)
}

const [, date, content] = match

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
const id = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim()

const output = JSON.stringify({ id, date, html }, null, 2)
writeFileSync('public/latest-release.json', output)
console.log(`Extracted latest release: ${date} (${id})`)
