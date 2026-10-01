const { test } = require('node:test')
const assert = require('node:assert/strict')
const { complete } = require('./deepseek.cjs')
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
