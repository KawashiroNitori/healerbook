# DeepSeek GitHub Actions

三个工作流直接调用 DeepSeek API，无需 Codex CLI、OpenAI Key 或订阅登录状态。

在仓库 Settings → Secrets and variables → Actions 添加 Secret `DEEPSEEK_API_KEY`。在 [DeepSeek 平台](https://platform.deepseek.com/) 创建密钥并配置 API 余额。默认模型 `deepseek-flash`，可用仓库 Variable `DEEPSEEK_MODEL` 覆盖为支持 JSON Output 和 thinking 参数的模型。

- `deepseek-code-review.yml`：审查同仓库 PR 的 src 改动，发布中文总结和内联评论。
- `deepseek-issue-triage.yml`：新 issue 分类、添加已有白名单标签、回复摘要。查重限最近 100 条 issue/PR 列表中的 issue。
- `deepseek.yml`：可信协作者使用 `@deepseek` 触发回复；修改请求以建议或补丁文本回复。

脚本与提示词从默认分支加载，首次启用需将迁移文件合入默认分支。模型仅接收提示词（审查与回复另附项目指南，分诊使用自包含的 `triage.md`）和 GitHub API 收集的 issue、评论、PR diff，不能自行读取完整源码或执行工具。上下文不足时应说明局限。

## 分诊配额

任何人新建 issue 都会触发分诊，因此 `gate` job 在调用模型前检查配额（`.github/scripts/triage-gate.cjs`）：

- Bot 账号不调用模型。
- OWNER / MEMBER / COLLABORATOR 不受限。
- 其他账号 24 小时内新建的 issue 超过 `TRIAGE_DAILY_LIMIT_PER_USER`（默认 3）不调用模型；全仓库 24 小时内新建的 issue 超过 `TRIAGE_DAILY_LIMIT_TOTAL`（默认 20）不调用模型。两者都可用仓库 Variable 覆盖，计数包含当前 issue。
- 被跳过的 issue 添加 `needs-triage` 标签转人工。该标签需在仓库中预先创建，不存在时只输出告警。

## 上下文与输出

- issue / PR 正文截断到 6000 字符，查重用的历史 issue 只保留前 300 字符。评论附带 `author_association`，供模型区分可信协作者与外部用户。
- 请求消息超过 250 KB 时按顺序裁剪：较早的历史 issue、较早的评论、最大的 PR patch、正文、request。裁剪记录写入 `truncation` 字段，提示词要求模型说明局限。
- API Key 只注入调用步骤，固定发送到官方 API；单次超时 120 秒，429 / 5xx 最多尝试 3 次。空响应、截断或格式错误时停止发布。
- 独立发布 job（`.github/scripts/ai-publish.cjs`）校验标签、内联行号和 PR 版本，并清洗所有要发布的 Markdown：顶层代码块原样保留；其余部分打断 @ 提醒，转义字符引用、注释和行首 HTML，移除能携带外链或隐藏内容的标签，链接仅保留 github.com、xivhealer.com、bilibili.com、fflogs.com 及其子域名。

文档检查由 `scripts/document-policy.mjs` 共享，Codex 和 Claude Code 分别通过 `.codex/hooks.json`、`.claude/settings.json` 调用写入前适配器；lint-staged 保留提交前检查。支持范围和启用条件见 `AGENTS.md`。

模拟验证：`node --test .github/scripts/*.test.cjs`。真实 API 调用需要配置 Secret，模拟测试不会消费额度。

参考：[官方接口](https://api-docs.deepseek.com/)。
