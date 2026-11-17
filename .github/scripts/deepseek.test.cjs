const { test } = require('node:test')
const assert = require('node:assert/strict')
const { complete, buildMessages, fitContext } = require('./deepseek.cjs')
const schema = require('../ai/triage.schema.json')
const base = { apiKey: 'test-only', model: 'deepseek-flash', messages: [], schema }
const reply = (content, finish_reason = 'stop') =>
  new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason }] }))
test('official endpoint and structured response', async () => {
  const result = await complete({
    ...base,
    fetchImpl: async (url, init) => {
      assert.equal(url, 'https://api.deepseek.com/chat/completions')
      assert.equal(JSON.parse(init.body).response_format.type, 'json_object')
      return reply('{"labels":["bug"],"comment":"摘要"}')
    },
  })
  assert.deepEqual(JSON.parse(result).labels, ['bug'])
})
test('empty, malformed, truncated and wrong-shaped results fail closed', async () => {
  for (const [content, reason] of [
    ['', 'stop'],
    ['bad', 'stop'],
    ['{}', 'stop'],
    ['{"labels":[1],"comment":"x"}', 'stop'],
    ['{}', 'length'],
  ])
    await assert.rejects(complete({ ...base, fetchImpl: async () => reply(content, reason) }))
})
test('temporary errors retry; authentication errors do not', async () => {
  let calls = 0
  await complete({
    ...base,
    wait: async () => {},
    fetchImpl: async () =>
      ++calls < 3 ? new Response('', { status: 429 }) : reply('{"labels":[],"comment":"x"}'),
  })
  assert.equal(calls, 3)
  calls = 0
  await assert.rejects(
    complete({
      ...base,
      fetchImpl: async () => {
        calls++
        return new Response('private', { status: 401 })
      },
    }),
    /HTTP 401/
  )
  assert.equal(calls, 1)
})
test('missing key and oversized context fail before a request', async () => {
  const fetchImpl = () => {
    throw new Error('Unexpected network')
  }
  await assert.rejects(complete({ ...base, apiKey: '', fetchImpl }), /DEEPSEEK_API_KEY/)
  await assert.rejects(
    complete({ ...base, messages: [{ content: 'a'.repeat(250001) }], fetchImpl }),
    /250 KB/
  )
})
test('plain text replies', async () => {
  assert.equal(
    await complete({ ...base, schema: null, fetchImpl: async () => reply('回复') }),
    '回复'
  )
})
test('triage prompt is self-contained; other modes include the project guide', () => {
  const read = path => (path === 'AGENTS.md' ? 'GUIDE' : path.endsWith('.json') ? '{}' : 'PROMPT')
  const data = { issue: { title: 't', body: 'b' } }
  const system = mode => buildMessages({ mode, data, read }).messages[0].content
  assert.ok(!system('triage').includes('GUIDE'))
  assert.ok(system('review').includes('GUIDE'))
  assert.ok(system('respond').includes('GUIDE'))
})
test('oversized context is trimmed in priority order instead of failing', () => {
  const body = '正文'.repeat(3000)
  const data = {
    issue: { title: 't', body },
    comments: Array.from({ length: 50 }, (_, i) => ({ author: `u${i}`, body: 'c'.repeat(3000) })),
    request: null,
    recent_issues: Array.from({ length: 100 }, (_, i) => ({
      number: i,
      title: `t${i}`,
      body: 'r'.repeat(2000),
    })),
  }
  const { messages } = buildMessages({
    mode: 'triage',
    data,
    read: p => (p.endsWith('.json') ? '{}' : 'P'),
  })
  assert.ok(Buffer.byteLength(JSON.stringify(messages), 'utf8') <= 250000)
  const fitted = JSON.parse(messages[1].content.slice(messages[1].content.indexOf('{')))
  // 历史 issue 先被裁掉，保留的是最新的；评论和正文保持完整。
  assert.ok(fitted.recent_issues.length < 100)
  assert.equal(fitted.recent_issues[0].number, 0)
  assert.equal(fitted.comments.length, 50)
  assert.equal(fitted.issue.body, body)
  assert.match(fitted.truncation[0], /recent_issues/)
})
test('largest patches are omitted first; body is trimmed only as a last resort', () => {
  const data = {
    issue: { title: 't', body: 'b'.repeat(6000) },
    comments: [],
    request: 'req',
    pull_request: {
      files: [
        { filename: 'big.ts', patch: 'p'.repeat(300000) },
        { filename: 'small.ts', patch: '+x' },
      ],
    },
  }
  const fitted = fitContext(data, 150000)
  assert.equal(fitted.pull_request.files[0].patch_omitted, true)
  assert.equal(fitted.pull_request.files[1].patch, '+x')
  assert.equal(fitted.issue.body, data.issue.body)
  assert.equal(data.pull_request.files[0].patch.length, 300000, 'input is not mutated')

  const huge = fitContext(
    { issue: { title: 't', body: '正文'.repeat(100000) }, request: 'req' },
    100000
  )
  assert.match(huge.issue.body, /已截断/)
  assert.equal(huge.request, 'req')
  assert.ok(Buffer.byteLength(JSON.stringify(JSON.stringify(huge))) <= 100000)
})
test('small context is untouched', () => {
  const data = { issue: { title: 't', body: 'b' }, comments: [], request: null }
  assert.deepEqual(fitContext(data, 250000), data)
})
test('context body truncation is code-point safe and annotated', () => {
  const { truncate } = require('./ai-context.cjs')
  assert.equal(truncate('abc', 5), 'abc')
  assert.equal(truncate(null, 5), null)
  assert.equal(truncate('😀😀😀', 2), '😀😀\n…（已截断，原文 3 字符）')
})
