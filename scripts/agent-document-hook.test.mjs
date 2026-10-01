import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { inspectHook, patchDocuments } from './agent-document-hook.mjs'

const root = path.resolve('fixture-repo')
const opts = { root, read: () => 'first\nold\nlast\n' }
const input = (tool_name, tool_input) => ({ tool_name, tool_input, cwd: root })

test('Claude writes: valid docs pass, forbidden paths and personal paths fail', () => {
  assert.deepEqual(
    inspectHook(input('Write', { file_path: 'docs/guide.md', content: 'src/data' }), opts),
    []
  )
  assert.ok(
    inspectHook(input('Write', { file_path: 'docs/plans/a.txt', content: '' }), opts).length
  )
  assert.ok(
    inspectHook(input('Write', { file_path: 'guide.md', content: '/Users/example/work' }), opts)
      .length
  )
})
test('Claude edits validate resulting content, including boundaries', () => {
  const options = { root, read: () => '/Users/placeholder/work' }
  assert.ok(
    inspectHook(
      input('Edit', { file_path: 'a.md', old_string: 'placeholder', new_string: 'someone' }),
      options
    ).length
  )
  assert.deepEqual(
    inspectHook(
      input('Edit', {
        file_path: 'a.md',
        old_string: '/Users/placeholder/work',
        new_string: 'src/work',
      }),
      options
    ),
    []
  )
})
test('Codex additions and updates use the same policy', () => {
  const command = '*** Begin Patch\n*** Add File: a.md\n+/home/example/repo\n*** End Patch'
  assert.ok(inspectHook(input('apply_patch', { command }), opts).length)
  const update =
    '*** Begin Patch\n*** Update File: a.md\n@@\n first\n-old\n+new\n last\n*** End Patch'
  assert.equal(patchDocuments(update, root, opts.read)[0].content, 'first\nnew\nlast\n')
  assert.deepEqual(inspectHook(input('apply_patch', { command: update }), opts), [])
})
test('multiple files, moves, deletion and CRLF', () => {
  const command =
    '*** Begin Patch\n*** Delete File: gone.md\n*** Update File: a.md\n*** Move to: docs/design/a.md\n@@\n first\n-old\n+new\n last\n*** Add File: b.md\n+good\n*** End Patch'
  assert.equal(patchDocuments(command.replaceAll('\n', '\r\n'), root, opts.read).length, 2)
  assert.ok(inspectHook(input('apply_patch', { command }), opts).some(p => p.includes('design')))
})
test('EOF hunks, anchors and multiple updates', () => {
  const command =
    '*** Begin Patch\n*** Update File: a.md\n@@ first\n-old\n+new\n@@\n-last\n+end\n*** End of File\n*** End Patch'
  assert.equal(patchDocuments(command, root, opts.read)[0].content, 'first\nnew\nend\n')
})
test('malformed input fails closed; unrelated tools pass', () => {
  assert.throws(() => inspectHook(input('apply_patch', { command: 'invalid' }), opts))
  assert.throws(() =>
    inspectHook(input('Edit', { file_path: 'a.md', old_string: 'missing', new_string: '' }), opts)
  )
  assert.deepEqual(inspectHook(input('Bash', { command: 'echo hello' }), opts), [])
})

test('registered launchers preserve deny decisions through the host shell', () => {
  const repo = fileURLToPath(new URL('../', import.meta.url))
  for (const config of ['.codex/hooks.json', '.claude/settings.json']) {
    const { command } = JSON.parse(readFileSync(path.join(repo, config), 'utf8')).hooks
      .PreToolUse[0].hooks[0]
    const payload = content =>
      JSON.stringify({
        cwd: repo,
        tool_name: config.startsWith('.codex') ? 'apply_patch' : 'Write',
        tool_input: config.startsWith('.codex')
          ? {
              command: `*** Begin Patch\n*** Add File: hook-fixture.md\n+${content}\n*** End Patch`,
            }
          : { file_path: 'hook-fixture.md', content },
      })
    for (const [stdin, reason] of [
      [payload('src/data'), null],
      [payload('/Users/hook_fixture/example'), /macOS home/],
      ['invalid JSON', /could not validate/],
    ]) {
      const windows = process.platform === 'win32'
      const result = spawnSync(
        windows ? 'pwsh' : 'sh',
        windows ? ['-NoProfile', '-NonInteractive', '-Command', command] : ['-c', command],
        { cwd: path.join(repo, 'src'), input: stdin, encoding: 'utf8', timeout: 10000 }
      )
      assert.ifError(result.error)
      assert.equal(result.status, 0, result.stderr)
      if (reason) {
        const decision = JSON.parse(result.stdout).hookSpecificOutput
        assert.equal(decision.hookEventName, 'PreToolUse')
        assert.equal(decision.permissionDecision, 'deny')
        assert.match(decision.permissionDecisionReason, reason)
      } else assert.equal(result.stdout, '')
    }
  }
})
