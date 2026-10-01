#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import { docsPathProblem } from './document-policy.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const files = process.argv.slice(2)
if (!files.length) {
  console.error('Usage: node scripts/enforce-docs-paths.mjs <file...>')
  process.exitCode = 1
}
for (const file of files) {
  const reason = docsPathProblem(file, root)
  if (!reason) continue
  console.error(`Refusing ${file}: ${reason}`)
  process.exitCode = 2
}
