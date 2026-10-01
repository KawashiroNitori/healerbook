const fs = require('node:fs')

module.exports = async ({ github, context, core, mode }) => {
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
    issue: { title: issue.title, body: issue.body, labels: issue.labels.map(l => l.name) },
    comments: comments.slice(-50).map(c => ({ author: c.user.login, body: c.body })),
    request:
      event.comment?.body ??
      event.review?.body ??
      [event.issue?.title, event.issue?.body].filter(Boolean).join('\n'),
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
      .map(i => ({ number: i.number, title: i.title, body: i.body?.slice(0, 4000) }))
  }
  fs.writeFileSync('ai-context.json', JSON.stringify(data))
  core.info(`Prepared ${mode} context for #${number}`)
}
