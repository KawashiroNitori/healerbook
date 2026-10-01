import os from 'node:os'
import path from 'node:path'
import { env } from 'node:process'

export function localPathHits(filePath, content) {
  if (!/\.(md|mdx)$/i.test(filePath)) return []
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
    n => n && n.length >= 3 && !generics.has(n.toLowerCase())
  )

  const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const usernameRes = usernames.map(n => ({
    name: n,
    re: new RegExp(`\\b${escapeRegex(n)}\\b`, 'i'),
  }))

  const stripNoise = line => line.replace(/https?:\/\/\S+/g, '').replace(/git@[^\s:]+:\S+/g, '')

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

  return hits
}

export function docsPathProblem(filePath, root) {
  const relative = path
    .relative(root, path.resolve(root, filePath))
    .replace(/\\/g, '/')
    .toLowerCase()
  if (!relative.startsWith('docs/')) return null
  const hit = ['superpowers', 'spec', 'plan', 'design'].find(word => relative.includes(word))
  return hit ? `Published docs/ path contains ${hit}; put internal notes in design/.` : null
}

export function checkDocument(filePath, content, root) {
  const problems = []
  const pathProblem = docsPathProblem(filePath, root)
  if (pathProblem) problems.push(pathProblem)
  for (const hit of localPathHits(filePath, content))
    problems.push(`Line ${hit.line}: ${hit.rule}; use a repository-relative path or placeholder.`)
  return problems
}
