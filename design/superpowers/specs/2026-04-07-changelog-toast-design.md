# Changelog Toast 设计文档

> 轻量机制：用户访问首页时，若有新版本发布，弹出 toast 展示更新内容。

## 整体流程

```
docs/changelog.md (唯一编辑点)
       │
       └──→ prebuild 脚本 → public/latest-release.json（最新一条）
                              │
                     React HomePage fetch
                              │
                  对比 localStorage.lastSeenReleaseId
                              │
                     不同 → 弹 toast
                              │
                     "查看详情" → 跳转 VitePress changelog 页
```

## 数据格式

### docs/changelog.md

按日期分组的标准 markdown：

```markdown
## 2026-04-07

- 新增伤害事件轨道**折叠/展开**切换
- 支持 `TOP100` 减伤方案参考
- 修复登录后用户名丢失的问题

## 2026-03-20

- 时间轴云端分享与协作
```

### public/latest-release.json

```json
{
  "id": "abf8829",
  "date": "2026-04-07",
  "html": "<ul><li>新增伤害事件轨道<strong>折叠/展开</strong>切换</li>...</ul>"
}
```

- `id`：`git rev-parse --short HEAD` 的输出
- `date`：changelog 中最新条目的日期字符串
- `html`：该条目 markdown 内容经 `marked` 转换后的 HTML

## 文件清单

| 文件                                | 操作 | 说明                                        |
| ----------------------------------- | ---- | ------------------------------------------- |
| `docs/changelog.md`                 | 新建 | 更新日志源文件                              |
| `scripts/extract-latest-release.ts` | 新建 | 提取最新条目 → `public/latest-release.json` |
| `src/hooks/useChangelogToast.ts`    | 新建 | fetch + localStorage 比较 + 弹 toast        |
| `src/pages/HomePage.tsx`            | 修改 | 调用 `useChangelogToast()`                  |
| `package.json`                      | 修改 | 添加 `marked` devDep + `prebuild` 脚本      |

## 构建脚本

### scripts/extract-latest-release.ts

- 用 `tsx` 执行（项目已有 TypeScript 工具链）
- 触发时机：`package.json` 的 `prebuild` 脚本，在 `vite build` 前运行
- 依赖：`marked`（devDependency）

逻辑：

1. 读取 `docs/changelog.md`
2. 正则提取第一个 `## <date>` 到下一个 `##`（或文件末尾）之间的内容
3. 用 `marked` 将提取的 markdown 转为 HTML
4. 执行 `git rev-parse --short HEAD` 获取 commit hash
5. 写入 `public/latest-release.json`

## 前端行为

### useChangelogToast hook

触发条件：

- 仅在 HomePage 挂载时调用
- `useEffect` 中 fetch `/latest-release.json`
- 比较 `localStorage.getItem('lastSeenReleaseId')` 与响应中的 `id`
- 不同则弹 toast，相同则跳过

### Toast 配置

- 使用 Sonner `toast()` 自定义渲染
- 位置：右下角（App.tsx 的 `<Toaster>` 已全局配置）
- 标题：`Healerbook 已更新`
- 内容：`dangerouslySetInnerHTML` 渲染 `latest.html`（来源可信，为自有构建产物）
- 操作按钮：「查看详情」→ `window.open(CHANGELOG_URL)`
- 关闭行为：`onDismiss` / `onAutoClose` 回调中写入 `localStorage.lastSeenReleaseId = latest.id`
- `duration`：设为较长值（如 30000ms），给用户充足阅读时间

### CHANGELOG_URL

`/docs/changelog` — vite.config.ts 已配置 `/docs` 代理到 VitePress 服务。

## localStorage

| Key                 | 值                                | 说明                          |
| ------------------- | --------------------------------- | ----------------------------- |
| `lastSeenReleaseId` | commit short hash（如 `abf8829`） | 用户已看过的最新 release 标识 |

## 依赖变更

| 包       | 类型          | 用途                       |
| -------- | ------------- | -------------------------- |
| `marked` | devDependency | 构建脚本中 markdown → HTML |

## 不包含在本次范围

- VitePress changelog 站点搭建
- 工具栏 changelog 入口 / 小红点
- changelog 历史浏览 UI
