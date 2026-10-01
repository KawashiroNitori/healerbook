#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { localPathHits } from './document-policy.mjs'
const files = process.argv.slice(2)
if (!files.length) {
  console.error('Usage: node scripts/check-local-paths.mjs <file...>')
  process.exitCode = 1
}
for (const file of files) {
  if (!/\.(md|mdx)$/i.test(file)) continue
  const hits = localPathHits(file, readFileSync(file, 'utf8'))
  if (!hits.length) continue
  console.error(`Refusing ${file}: ` + hits.map(h => `line ${h.line} [${h.rule}]`).join(', '))
  process.exitCode = 2
}
