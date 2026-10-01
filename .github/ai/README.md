# DeepSeek GitHub Actions

三个工作流直接调用 DeepSeek API，无需 Codex CLI、OpenAI Key 或订阅登录状态。

在仓库 Settings → Secrets and variables → Actions 添加 Secret `DEEPSEEK_API_KEY`。在 [DeepSeek 平台](https://platform.deepseek.com/) 创建密钥并配置 API 余额。默认模型 `deepseek-flash`，可用仓库 Variable `DEEPSEEK_MODEL` 覆盖为支持 JSON Output 和 thinking 参数的模型。

- `deepseek-code-review.yml`：审查同仓库 PR 的 src 改动，发布中文总结和内联评论。
- `deepseek-issue-triage.yml`：新 issue 分类、添加已有白名单标签、回复摘要。查重限最近 100 条 issue/PR 列表中的 issue。
- `deepseek.yml`：可信协作者使用 `@deepseek` 触发回复；修改请求以建议或补丁文本回复。

脚本与提示词从默认分支加载，首次启用需将迁移文件合入默认分支。模型仅接收项目指南、提示词和 GitHub API 收集的 issue、评论、PR diff，不能自行读取完整源码或执行工具。上下文不足时应说明局限。

请求消息超过 250 KB 时停止，避免静默截断。API Key 只注入调用步骤，固定发送到官方 API；单次超时 120 秒，429 / 5xx 最多尝试 3 次。空响应、截断或格式错误时停止发布。独立发布 job 校验标签、内联行号和 PR 版本。

文档检查由 `scripts/document-policy.mjs` 共享，Codex 和 Claude Code 分别通过 `.codex/hooks.json`、`.claude/settings.json` 调用写入前适配器；lint-staged 保留提交前检查。支持范围和启用条件见 `AGENTS.md`。

模拟验证：`node --test .github/scripts/deepseek.test.cjs`。真实 API 调用需要配置 Secret，模拟测试不会消费额度。

参考：[官方接口](https://api-docs.deepseek.com/)。
