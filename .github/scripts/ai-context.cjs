const fs = require('node:fs')

// 单条正文的字符上限：当前 issue / PR 正文保留几 KB，查重用的历史 issue 只保留开头。
const BODY_LIMIT = 6000
const RECENT_BODY_LIMIT = 300

// 按码点截断，避免切开代理对；截断时附注原长度，让模型知道内容不完整。
function truncate(text, limit) {
  if (typeof text !== 'string') return null
  if (text.length <= limit) return text
  const chars = Array.from(text)
  if (chars.length <= limit) return text
  return `${chars.slice(0, limit).join('')}\n…（已截断，原文 ${chars.length} 字符）`
}

async function buildContext({ github, context, mode }) {
  const repo = context.repo
  const event = context.payload
  const number = event.issue?.number ?? event.pull_request?.number
  if (!Number.isInteger(number)) throw new Error('Missing issue or pull request number')
  const issue = (await github.rest.issues.get({ ...repo, issue_number: number })).data
  const comments = await github.paginate(github.rest.issues.listComments, {
    ...repo,
    issue_number: number,
    per_page: 100,
  })
  const data = {
    repository: `${repo.owner}/${repo.repo}`,
    number,
    issue: {
      title: issue.title,
      body: truncate(issue.body, BODY_LIMIT),
      author: issue.user?.login ?? null,
      author_association: issue.author_association ?? null,
      labels: issue.labels.map(l => (typeof l === 'string' ? l : l.name)),
    },
    comments: comments.slice(-50).map(c => ({
      author: c.user?.login ?? null,
      author_association: c.author_association ?? null,
      body: c.body,
    })),
    // 由 issue 本身触发时为 null：请求就是 issue 标题和正文，不再重复拼一份。
    request: event.comment?.body ?? event.review?.body ?? null,
  }
  if (issue.pull_request) {
    const pr = (await github.rest.pulls.get({ ...repo, pull_number: number })).data
    const files = await github.paginate(github.rest.pulls.listFiles, {
      ...repo,
      pull_number: number,
      per_page: 100,
    })
    data.pull_request = {
      base: pr.base.sha,
      head: pr.head.sha,
      files: files.map(f => ({
        filename: f.filename,
        status: f.status,
        patch: f.patch ?? null,
      })),
    }
  }
  if (mode === 'triage') {
    data.available_labels = (
      await github.paginate(github.rest.issues.listLabelsForRepo, {
        ...repo,
        per_page: 100,
      })
    ).map(l => l.name)
    data.recent_issues = (
      await github.rest.issues.listForRepo({
        ...repo,
        state: 'all',
        per_page: 100,
        sort: 'created',
        direction: 'desc',
      })
    ).data
      .filter(i => !i.pull_request && i.number !== number)
      .map(i => ({ number: i.number, title: i.title, body: truncate(i.body, RECENT_BODY_LIMIT) }))
  }
  return data
}

async function prepare({ github, context, core, mode }) {
  const data = await buildContext({ github, context, mode })
  fs.writeFileSync('ai-context.json', JSON.stringify(data))
  core.info(`Prepared ${mode} context for #${data.number}`)
}

module.exports = prepare
module.exports.buildContext = buildContext
module.exports.truncate = truncate
