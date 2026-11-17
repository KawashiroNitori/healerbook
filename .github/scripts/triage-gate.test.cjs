const { test } = require('node:test')
const assert = require('node:assert/strict')
const { gate, readLimit } = require('./triage-gate.cjs')

const NOW = Date.parse('2026-11-17T12:00:00Z')
const hoursAgo = h => new Date(NOW - h * 3600 * 1000).toISOString()
const repo = { owner: 'o', repo: 'r' }

// issues 按创建时间倒序；listForRepo 带 creator 时按作者过滤。
function fakeGithub(issues, labels = ['needs-triage']) {
  const calls = []
  return {
    calls,
    paginate: Object.assign(async () => labels.map(name => ({ name })), {
      iterator: (_, params) => {
        calls.push(['list', params.creator ?? null])
        const data = issues.filter(i => !params.creator || i.user === params.creator)
        return (async function* () {
          for (let i = 0; i < data.length; i += 100) yield { data: data.slice(i, i + 100) }
        })()
      },
    }),
    rest: {
      issues: {
        listForRepo: 'listForRepo',
        listLabelsForRepo: 'listLabelsForRepo',
        addLabels: async args => calls.push(['addLabels', args.labels]),
      },
    },
  }
}

async function runGate({
  issues,
  author = 'alice',
  association = 'NONE',
  type = 'User',
  env = {},
}) {
  const github = fakeGithub(issues)
  const outputs = {}
  const core = {
    setOutput: (k, v) => (outputs[k] = v),
    notice() {},
    warning() {},
  }
  const context = {
    repo,
    payload: {
      issue: { number: 1, user: { login: author, type }, author_association: association },
    },
  }
  await gate({ github, context, core, now: NOW, env })
  return { allowed: outputs.allowed, calls: github.calls }
}

const issue = (user, h, extra = {}) => ({ user, created_at: hoursAgo(h), ...extra })

test('within quota runs the model', async () => {
  const { allowed, calls } = await runGate({ issues: [issue('alice', 0), issue('bob', 1)] })
  assert.equal(allowed, 'true')
  assert.ok(!calls.some(([name]) => name === 'addLabels'))
})

test('per-user quota counts the last 24h, excludes PRs, and falls back to label', async () => {
  const issues = [
    issue('alice', 0),
    issue('alice', 1),
    issue('alice', 2, { pull_request: {} }),
    issue('alice', 3),
    issue('alice', 30),
  ]
  assert.equal((await runGate({ issues })).allowed, 'true')
  const over = await runGate({ issues: [issue('alice', 0), ...issues] })
  assert.equal(over.allowed, 'false')
  assert.deepEqual(over.calls.at(-1), ['addLabels', ['needs-triage']])
})

test('repository-wide quota', async () => {
  const issues = Array.from({ length: 21 }, (_, i) => issue(`u${i}`, i / 2))
  issues[0].user = 'alice'
  assert.equal((await runGate({ issues })).allowed, 'false')
  assert.equal((await runGate({ issues, env: { TRIAGE_DAILY_LIMIT_TOTAL: '30' } })).allowed, 'true')
})

test('bots skip; trusted authors bypass quota without listing', async () => {
  const many = Array.from({ length: 50 }, (_, i) => issue('owner', i / 10))
  assert.equal((await runGate({ issues: [], type: 'Bot' })).allowed, 'false')
  const trusted = await runGate({ issues: many, author: 'owner', association: 'OWNER' })
  assert.equal(trusted.allowed, 'true')
  assert.equal(trusted.calls.length, 0)
})

test('limit variables: empty or invalid values fall back to defaults', () => {
  assert.equal(readLimit('', 3), 3)
  assert.equal(readLimit(undefined, 3), 3)
  assert.equal(readLimit('abc', 3), 3)
  assert.equal(readLimit('-1', 3), 3)
  assert.equal(readLimit('0', 3), 0)
  assert.equal(readLimit('10', 3), 10)
})
