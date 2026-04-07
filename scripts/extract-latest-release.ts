import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { marked } from 'marked'

const changelog = readFileSync('docs/changelog.md', 'utf-8')

// 提取第一个 ## date 到下一个 ## 之间的内容
const match = changelog.match(/^## (\d{4}-\d{2}-\d{2})\s*\n([\s\S]*?)(?=\n## |\n*$)/)
if (!match) {
  console.error('No changelog entry found in docs/changelog.md')
  process.exit(1)
}

const [, date, content] = match
const html = await marked(content.trim())
const id = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim()

const output = JSON.stringify({ id, date, html }, null, 2)
writeFileSync('public/latest-release.json', output)
console.log(`Extracted latest release: ${date} (${id})`)
