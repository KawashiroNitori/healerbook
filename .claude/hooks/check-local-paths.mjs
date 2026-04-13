#!/usr/bin/env node

// PreToolUse hook: reject .md/.mdx writes that contain local device paths
// or the current user's username, to avoid leaking machine identity into
// committed documentation.

import { stdin, stderr, exit, env } from 'node:process'
import os from 'node:os'
import path from 'node:path'

const chunks = []
for await (const chunk of stdin) chunks.push(chunk)
const input = JSON.parse(Buffer.concat(chunks).toString())

const toolName = input.tool_name ?? ''
const ti = input.tool_input ?? {}

let content = ''
if (toolName === 'Write') content = ti.content ?? ''
else if (toolName === 'Edit') content = ti.new_string ?? ''
else if (toolName === 'NotebookEdit') content = ti.new_source ?? ''
else exit(0)

if (!content) exit(0)

const filePath = ti.file_path ?? ti.filePath ?? ''
if (!/\.(md|mdx)$/i.test(filePath)) exit(0)

const pathPatterns = [
  { name: 'macOS home', re: /\/Users\/[A-Za-z0-9._-]+\// },
  { name: 'Linux home', re: /\/home\/[A-Za-z0-9._-]+\// },
  { name: 'WSL mount', re: /\/mnt\/[a-z]\// },
  { name: 'Windows drive', re: /(?:^|[^A-Za-z0-9])[A-Za-z]:[\\/][A-Za-z0-9._\\/-]/ },
  { name: 'UNC path', re: /\\\\[A-Za-z0-9._-]+\\/ },
]

const candidates = new Set()
candidates.add(os.userInfo().username)
const home = os.homedir()
if (home) candidates.add(path.basename(home))
for (const k of ['USER', 'USERNAME', 'LOGNAME']) {
  if (env[k]) candidates.add(env[k])
}
const generics = new Set(['root', 'user', 'admin', 'test', 'runner', 'ubuntu', 'node'])
const usernames = [...candidates].filter(
  n => n && n.length >= 3 && !generics.has(n.toLowerCase()),
)

const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const usernameRes = usernames.map(n => ({
  name: n,
  re: new RegExp(`\\b${escapeRegex(n)}\\b`, 'i'),
}))

const stripNoise = line =>
  line.replace(/https?:\/\/\S+/g, '').replace(/git@[^\s:]+:\S+/g, '')

const hits = []
const lines = content.split(/\r?\n/)
for (let i = 0; i < lines.length; i++) {
  const stripped = stripNoise(lines[i])
  let matched = null
  for (const { name, re } of pathPatterns) {
    if (re.test(stripped)) {
      matched = name
      break
    }
  }
  if (!matched) {
    for (const { re } of usernameRes) {
      if (re.test(stripped)) {
        matched = 'current username'
        break
      }
    }
  }
  if (matched) hits.push({ line: i + 1, rule: matched, text: lines[i].trim() })
}

if (hits.length === 0) exit(0)

stderr.write(
  `Refusing to write ${filePath}: detected local device path or current username.\n` +
    hits
      .slice(0, 10)
      .map(h => `  line ${h.line} [${h.rule}]: ${h.text}`)
      .join('\n') +
    '\n' +
    `Replace with a relative path or remove the offending segment before retrying.\n`,
)
exit(2)
