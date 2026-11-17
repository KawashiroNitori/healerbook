const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  sanitizeMarkdown,
  isAllowedUrl,
  publishTriage,
  publishReview,
  addFallbackLabel,
} = require('./ai-publish.cjs')

const ZWSP = '​'

test('mentions are neutralized outside fenced code; emails stay', () => {
  assert.equal(
    sanitizeMarkdown('请 @someone 和 @org/team 看看'),
    `请 @${ZWSP}someone 和 @${ZWSP}org/team 看看`
  )
  assert.equal(sanitizeMarkdown('[@x](https://github.com)'), `[@${ZWSP}x](https://github.com)`)
  assert.equal(sanitizeMarkdown('mail a@b.com'), 'mail a@b.com')
  assert.equal(sanitizeMarkdown('&#64;user'), '&amp;#64;user')
})

test('allowed hosts and their subdomains only', () => {
  for (const url of [
    'https://github.com/a/b',
    'https://www.bilibili.com/video/x',
    'https://www.fflogs.com/reports/abc#fight=1',
    'http://xivhealer.com',
    'www.github.com/x',
    'https://github.com\\@evil.com',
  ])
    assert.ok(isAllowedUrl(url), url)
  for (const url of [
    'https://evil.com',
    'https://github.com.evil.com',
    'https://github.com@evil.com',
    'https:evil.com',
    'https:/evil.com',
    '//evil.com',
    '\\\\evil.com',
    'ftp://github.com',
    'https://evil。com',
  ])
    assert.ok(!isAllowedUrl(url), url)
})

test('disallowed links are removed in every form', () => {
  assert.equal(sanitizeMarkdown('[点我](https://evil.com/x "t")'), '点我（外链已移除）')
  assert.equal(sanitizeMarkdown('![x](https://evil.com/p.png)'), '（图片已移除）')
  assert.equal(
    sanitizeMarkdown('见 https://evil.com/a 和 www.evil.com'),
    '见 ‹外链已移除› 和 ‹外链已移除›'
  )
  assert.equal(sanitizeMarkdown('[x](//evil.com)'), 'x（外链已移除）')
  assert.equal(sanitizeMarkdown('[x](https:evil.com)'), 'x（外链已移除）')
  assert.equal(sanitizeMarkdown('[1]: https://evil.com'), '[1]: ‹外链已移除›')
  const kept = '[issue](https://github.com/o/r/issues/1) https://space.bilibili.com/1'
  assert.equal(sanitizeMarkdown(kept), kept)
})

test('html that hides content or carries links is neutralized', () => {
  assert.equal(sanitizeMarkdown('a <!-- hidden --> b'), 'a &lt;!-- hidden --> b')
  assert.equal(sanitizeMarkdown('x <a href="https://evil.com">y</a> z'), 'x y z')
  assert.equal(sanitizeMarkdown('x <img src=//evil.com/p.png> z'), 'x  z')
  assert.equal(sanitizeMarkdown('<<img>img src=x>'), '')
  assert.equal(sanitizeMarkdown('<details>\n<summary>s</summary>'), '&lt;details>\n&lt;summary>s')
  assert.equal(sanitizeMarkdown('- <div>\n> <p>'), '- &lt;div>\n> &lt;p>')
  // 行内泛型不受影响。
  assert.equal(
    sanitizeMarkdown('使用 `Array<string>` 与 `a && b`'),
    '使用 `Array<string>` 与 `a && b`'
  )
})

test('top-level fenced code is kept verbatim, including suggestion blocks', () => {
  const block = '```suggestion\nconst a = `@types/node` <a href="https://evil.com">\n```'
  assert.equal(sanitizeMarkdown(`改成：\n${block}\n@x`), `改成：\n${block}\n@${ZWSP}x`)
  const tilde = '~~~\n```\n@inner\n~~~'
  assert.equal(sanitizeMarkdown(tilde), tilde)
  // 未闭合围栏在 GitHub 上延续到文末。
  assert.equal(sanitizeMarkdown('```\n@x'), '```\n@x')
})

test('fences GitHub may not treat as top-level code are still sanitized', () => {
  // 列表内缩进围栏：列表结束时围栏也结束，按文本清洗。
  assert.equal(
    sanitizeMarkdown('- item\n  ```\n@x\n  ```'),
    `- item\n  \`\`\`\n@${ZWSP}x\n  \`\`\``
  )
  // 信息串含反引号的不是围栏。
  assert.equal(sanitizeMarkdown('``` a`b\n@x'), `\`\`\` a\`b\n@${ZWSP}x`)
  // HTML 块被转义后，其后的围栏不会被当作 HTML 内容。
  assert.equal(sanitizeMarkdown('<div>\n```\n@x\n```'), '&lt;div>\n```\n@x\n```')
})

const fakeGithub = (labels = ['bug', 'question', 'needs-triage']) => {
  const calls = []
  return {
    calls,
    paginate: async () => labels.map(name => ({ name })),
    rest: {
      issues: {
        listLabelsForRepo: 'listLabelsForRepo',
        addLabels: async args => calls.push(['addLabels', args]),
        createComment: async args => calls.push(['createComment', args]),
      },
      pulls: {
        get: async () => ({ data: { head: { sha: 'h1' } } }),
        listFiles: 'listFiles',
        createReview: async args => calls.push(['createReview', args]),
      },
    },
  }
}
const repo = { owner: 'o', repo: 'r' }

test('triage publishes only allow-listed existing labels and sanitized comment', async () => {
  const github = fakeGithub()
  const context = { repo, payload: { issue: { number: 7 } } }
  await publishTriage({
    github,
    context,
    raw: JSON.stringify({
      labels: ['bug', 'bug', 'duplicate', 'data'],
      comment: '@a 见 https://evil.com',
    }),
  })
  assert.deepEqual(github.calls, [
    ['addLabels', { ...repo, issue_number: 7, labels: ['bug'] }],
    ['createComment', { ...repo, issue_number: 7, body: `@${ZWSP}a 见 ‹外链已移除›` }],
  ])
})

test('review fallback text, including model-controlled path, is sanitized', async () => {
  const github = fakeGithub()
  github.paginate = async () => [{ filename: 'src/a.ts', patch: '@@ -1,1 +1,2 @@\n a\n+b' }]
  const context = { repo, payload: { pull_request: { number: 3, head: { sha: 'h1' } } } }
  await publishReview({
    github,
    context,
    core: { info() {} },
    raw: JSON.stringify({
      summary: '总结',
      comments: [
        { path: 'src/a.ts', line: 2, body: '[P2] @x' },
        { path: '@evil', line: 99, body: 'https://evil.com' },
      ],
    }),
  })
  const [, review] = github.calls[0]
  assert.equal(review.event, 'COMMENT')
  assert.deepEqual(review.comments, [
    { path: 'src/a.ts', line: 2, side: 'RIGHT', body: `[P2] @${ZWSP}x` },
  ])
  assert.equal(review.body, `总结\n\n@${ZWSP}evil:99 — ‹外链已移除›`)
})

test('fallback label is never created implicitly', async () => {
  const warnings = []
  const github = fakeGithub(['bug'])
  await addFallbackLabel({
    github,
    context: { repo, payload: { issue: { number: 1 } } },
    core: { warning: m => warnings.push(m) },
  })
  assert.equal(github.calls.length, 0)
  assert.equal(warnings.length, 1)
})
