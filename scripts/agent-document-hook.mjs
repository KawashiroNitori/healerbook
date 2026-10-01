#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkDocument } from './document-policy.mjs'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const normalize = text => text.replace(/\r\n/g, '\n')

// Reconstruct supported apply_patch edits in memory. Nothing is written by this hook.
export function patchDocuments(command, cwd, read = file => readFileSync(file, 'utf8')) {
  const lines = normalize(command).trimEnd().split('\n')
  if (lines.shift() !== '*** Begin Patch' || lines.pop() !== '*** End Patch') {
    throw new Error('Expected an apply_patch patch')
  }
  const documents = []
  const pending = new Map()
  while (lines.length) {
    const header = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(lines.shift())
    if (!header) throw new Error('Unrecognized patch file header')
    const [, kind, name] = header
    const source = path.resolve(cwd, name)
    if (kind === 'Delete') {
      pending.delete(source)
      continue
    }
    let target = source
    if (lines[0]?.startsWith('*** Move to: ')) {
      target = path.resolve(cwd, lines.shift().slice('*** Move to: '.length))
    }
    const body = []
    while (lines.length && !/^\*\*\* (Add|Update|Delete) File: /.test(lines[0]))
      body.push(lines.shift())
    let content
    if (kind === 'Add') {
      if (body.some(line => !line.startsWith('+'))) throw new Error('Invalid added-file patch')
      content = body.map(line => line.slice(1)).join('\n') + '\n'
    } else {
      let original = normalize(pending.get(source) ?? read(source)).split('\n')
      if (original.at(-1) === '') original.pop()
      let cursor = 0
      let index = 0
      while (index < body.length) {
        // @@ may contain a function/context anchor rather than numeric line ranges.
        let anchor = ''
        if (body[index] === '@@' || body[index].startsWith('@@ ')) anchor = body[index++].slice(3)
        if (anchor) {
          const found = original.findIndex((line, i) => i >= cursor && line === anchor)
          if (found < 0) throw new Error('Cannot locate patch anchor; use exact context')
          cursor = found + 1
        }
        const before = [],
          after = []
        let eof = false
        while (index < body.length && body[index] !== '@@' && !body[index].startsWith('@@ ')) {
          const line = body[index++]
          if (line === '*** End of File') {
            eof = true
            break
          }
          if (![' ', '+', '-'].includes(line[0]))
            throw new Error('Unsupported patch line; use exact context')
          if (line[0] !== '+') before.push(line.slice(1))
          if (line[0] !== '-') after.push(line.slice(1))
        }
        let found = -1
        for (
          let i = before.length ? cursor : original.length;
          i <= original.length - before.length;
          i++
        ) {
          if (eof && i + before.length !== original.length) continue
          if (before.every((line, offset) => original[i + offset] === line)) {
            found = i
            break
          }
        }
        if (found < 0) throw new Error('Cannot reconstruct patch; use exact file context')
        original.splice(found, before.length, ...after)
        cursor = found + after.length
      }
      content = original.join('\n') + '\n'
    }
    pending.set(target, content)
    documents.push({ file: target, content })
  }
  return documents
}

export function inspectHook(
  input,
  { root = projectRoot, read = file => readFileSync(file, 'utf8') } = {}
) {
  const cwd = input.cwd || root
  const ti = input.tool_input ?? {}
  let documents
  if (input.tool_name === 'apply_patch') {
    if (typeof ti.command !== 'string') throw new Error('Missing patch command')
    documents = patchDocuments(ti.command, cwd, read)
  } else if (input.tool_name === 'Write' || input.tool_name === 'Edit') {
    const name = ti.file_path ?? ti.filePath
    if (typeof name !== 'string' || !name) throw new Error('Missing edit path')
    const file = path.resolve(cwd, name)
    let content = ti.content
    if (input.tool_name === 'Edit') {
      if (typeof ti.old_string !== 'string' || typeof ti.new_string !== 'string' || !ti.old_string)
        throw new Error('Invalid Edit input')
      content = read(file)
      if (!content.includes(ti.old_string))
        throw new Error('Edit text not found; read the file again')
      content = ti.replace_all
        ? content.split(ti.old_string).join(ti.new_string)
        : content.replace(ti.old_string, () => ti.new_string)
    }
    if (typeof content !== 'string') throw new Error('Missing write content')
    documents = [{ file, content }]
  } else return []
  return documents.flatMap(({ file, content }) =>
    checkDocument(file, content, root).map(reason => `${path.relative(root, file)}: ${reason}`)
  )
}

function deny(reason) {
  // PowerShell -Command can turn a native exit code 2 into 1. Both clients
  // understand this JSON decision with exit code 0, without shell translation.
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    })
  )
}

export async function main() {
  try {
    const chunks = []
    for await (const chunk of process.stdin) chunks.push(chunk)
    const problems = inspectHook(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    if (problems.length) {
      deny(problems.slice(0, 10).join('\n'))
    }
  } catch (error) {
    deny(`Document hook could not validate this edit: ${error.message}`)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main()
