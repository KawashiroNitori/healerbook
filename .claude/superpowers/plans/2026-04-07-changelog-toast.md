# Changelog Toast 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户访问首页时，若有新版本发布，弹出 toast 展示更新内容并提供查看详情入口。

**Architecture:** 构建脚本从 `docs/changelog.md` 提取最新条目生成 `public/latest-release.json`；前端 hook 在 HomePage 挂载时 fetch 该 JSON，与 localStorage 比较后决定是否弹 toast。

**Tech Stack:** marked（markdown→HTML）、tsx（运行构建脚本）、Sonner（toast）

---

### Task 1: 安装依赖 + 创建 changelog.md

**Files:**

- Modify: `package.json:6-9`（scripts）
- Create: `docs/changelog.md`

- [ ] **Step 1: 安装 marked**

```bash
pnpm add -D marked
```

- [ ] **Step 2: 创建 docs/changelog.md**

```markdown
## 2026-04-07

- 新增伤害事件轨道**折叠/展开**切换
- 支持 `TOP100` 减伤方案参考
- 修复登录后用户名丢失的问题
```

- [ ] **Step 3: 在 package.json 的 build 脚本前添加 extract 步骤**

将 `build` 脚本从：

```json
"build": "tsc -b && vite build && vitepress build docs"
```

改为：

```json
"build": "tsc -b && tsx scripts/extract-latest-release.ts && vite build && vitepress build docs"
```

- [ ] **Step 4: Commit**

```bash
git add docs/changelog.md package.json pnpm-lock.yaml
git commit -m "chore: 添加 marked 依赖和 changelog.md"
```

---

### Task 2: 构建脚本 extract-latest-release.ts

**Files:**

- Create: `scripts/extract-latest-release.ts`

- [ ] **Step 1: 创建构建脚本**

```typescript
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { marked } from 'marked'

const changelog = readFileSync('docs/changelog.md', 'utf-8')

// 提取第一个 ## date 到下一个 ## 之间的内容
const match = changelog.match(/^## (\d{4}-\d{2}-\d{2})\s*\n([\s\S]*?)(?=\n## |\n*$)/)
if (!match) {
  console.error('No changelog entry found in docs/changelog.md')
  process.exit(1)
}

const [, date, content] = match
const html = await marked(content.trim())
const id = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim()

const output = JSON.stringify({ id, date, html }, null, 2)
writeFileSync('public/latest-release.json', output)
console.log(`Extracted latest release: ${date} (${id})`)
```

- [ ] **Step 2: 运行脚本验证输出**

```bash
npx tsx scripts/extract-latest-release.ts
cat public/latest-release.json
```

预期：输出包含 `id`、`date: "2026-04-07"` 和 `html` 字段的 JSON。

- [ ] **Step 3: 将 latest-release.json 加入 .gitignore**

在 `.gitignore` 末尾追加：

```
public/latest-release.json
```

- [ ] **Step 4: Commit**

```bash
git add scripts/extract-latest-release.ts .gitignore
git commit -m "feat: 构建脚本提取 changelog 最新条目"
```

---

### Task 3: useChangelogToast hook

**Files:**

- Create: `src/hooks/useChangelogToast.ts`

- [ ] **Step 1: 创建 hook**

```typescript
import { useEffect } from 'react'
import { toast } from 'sonner'

const CHANGELOG_URL = '/docs/changelog'
const LS_KEY = 'lastSeenReleaseId'

interface LatestRelease {
  id: string
  date: string
  html: string
}

export function useChangelogToast() {
  useEffect(() => {
    let dismissed = false

    fetch('/latest-release.json')
      .then(res => {
        if (!res.ok) return null
        return res.json() as Promise<LatestRelease>
      })
      .then(latest => {
        if (!latest) return
        const seen = localStorage.getItem(LS_KEY)
        if (seen === latest.id) return

        const markSeen = () => {
          if (!dismissed) {
            dismissed = true
            localStorage.setItem(LS_KEY, latest.id)
          }
        }

        toast('Healerbook 已更新', {
          description: (
            <div dangerouslySetInnerHTML={{ __html: latest.html }} />
          ),
          action: {
            label: '查看详情',
            onClick: () => {
              window.open(CHANGELOG_URL, '_blank')
              markSeen()
            },
          },
          position: 'bottom-right',
          duration: Infinity,
          onDismiss: markSeen,
        })
      })
      .catch(() => {
        // 静默失败，不影响用户体验
      })
  }, [])
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useChangelogToast.ts
git commit -m "feat: useChangelogToast hook"
```

---

### Task 4: 集成到 HomePage

**Files:**

- Modify: `src/pages/HomePage.tsx:1-30`（添加 import + 调用 hook）

Sonner 支持逐条 toast 设置 `position`，hook 中已设置 `position: 'bottom-right'`，无需改动全局 Toaster。

- [ ] **Step 1: 在 HomePage 中调用 hook**

在 `src/pages/HomePage.tsx` 中：

1. 添加 import：

```typescript
import { useChangelogToast } from '@/hooks/useChangelogToast'
```

2. 在 `HomePage` 组件函数体开头调用：

```typescript
useChangelogToast()
```

- [ ] **Step 2: 本地验证**

```bash
npx tsx scripts/extract-latest-release.ts
pnpm dev
```

打开首页，确认 toast 弹出且内容正确。点击关闭后刷新，确认不再弹出。清除 `localStorage.lastSeenReleaseId` 后刷新，确认再次弹出。

- [ ] **Step 3: Commit**

```bash
git add src/pages/HomePage.tsx
git commit -m "feat: 首页展示 changelog 更新 toast"
```
