---
name: sync-souma-sync-rules
description: Use when adding entries to src/data/soumaSyncRules.ts from upstream Souma-Sumire/ff14-overlay-vue's timelineSpecialRules.ts, when checking whether our copy lags upstream main, or when a new boss mechanic / actionId is needed for FFLogs import. Triggers include "上游 sync 规则", "soumaSyncRules 同步", "把 windowAction.set(...) 加到 soumaSyncRules".
---

# Sync soumaSyncRules.ts from upstream

## Overview

`src/data/soumaSyncRules.ts` 是 Healerbook 自有的 FFLogs sync 规则表，种子数据来自上游 `Souma-Sumire/ff14-overlay-vue` 的 `src/resources/timelineSpecialRules.ts`，但已**独立演进**。本 skill 把"以上游 main 为对比基准，发现并补齐缺失条目"压成机械步骤。

**关键：语义 diff，不是文件文本 diff。** 两边语法完全不同（上游 `windowAction.set(ID, {...})`、本仓库 `[ID, {...}]` Map 字面量），文本 diff 没有意义；要按 `(actionId, type)` 主键比较条目集合。**也不要与 `3rdparty/ff14-overlay-vue` submodule 做 diff** —— submodule pin 是另一套版本管理，与上游 main 不同步。

## When to use

- 用户报来新 `actionId` / boss 机制要补 sync 规则
- 怀疑导入 FFLogs 时间轴丢锚点，先检查上游有无新条目
- 周期性 housekeeping：拉一遍上游 `main`，看语义 diff

**不适用**：调整既有规则的 `window` 大小、新增 Healerbook 专属（上游没有）规则。这些是 Healerbook 自有演进，不走"对齐"路径，按普通改动处理即可。

## Procedure

### 1. 抓上游最新文件 + 该文件的近期 commit 历史

```bash
gh api repos/Souma-Sumire/ff14-overlay-vue/contents/src/resources/timelineSpecialRules.ts \
  -H "Accept: application/vnd.github.raw" > .cache-upstream-rules.ts

gh api 'repos/Souma-Sumire/ff14-overlay-vue/commits?path=src/resources/timelineSpecialRules.ts&per_page=10' \
  --jq '.[] | {sha:.sha[0:7], date:.commit.author.date, msg:.commit.message}'
```

> 在 repo 根目录用相对路径写到 `.cache-upstream-rules.ts`（已 `.gitignore`-friendly 的隐藏路径；事后删除）。**不要**写到 `/tmp/`——Windows 下 node 会把它解释成 `<drive>:/tmp/`，路径不对。

### 2. 用语义 diff 脚本比较条目集

在 repo 根写一个一次性脚本 `.diff-sync-rules.mjs`（事后删除）：

```js
import { readFileSync } from 'node:fs'

const upstream = readFileSync('./.cache-upstream-rules.ts', 'utf8')
const ours = readFileSync('./src/data/soumaSyncRules.ts', 'utf8')

function parseEntry(idRaw, body) {
  const id = idRaw.toLowerCase().startsWith('0x') ? parseInt(idRaw, 16) : parseInt(idRaw, 10)
  const t = body.match(/type:\s*['"](begincast|cast)['"]/)
  const w = body.match(/window:\s*\[([^\]]+)\]/)
  if (!t || !w) return null
  return {
    id,
    idHex: '0x' + id.toString(16),
    type: t[1],
    window: w[1].split(',').map(s => Number(s.trim())),
    syncOnce: /syncOnce:\s*true/.test(body),
    battleOnce: /battleOnce:\s*true/.test(body),
  }
}
function extract(text, re) {
  const map = new Map()
  for (const m of text.matchAll(re)) {
    const e = parseEntry(m[1], m[2])
    if (e) map.set(`${e.id}|${e.type}`, e) // 主键 = id+type
  }
  return map
}
const up = extract(
  upstream,
  /windowAction\.set\(\s*(0x[0-9a-fA-F]+|\d+)\s*,\s*\{([\s\S]*?)\}\s*\)/g
)
const our = extract(ours, /\[\s*(0x[0-9a-fA-F]+|\d+)\s*,\s*\{([\s\S]*?)\}\s*\]/g)

const missing = [],
  differing = [],
  extras = []
for (const [k, e] of up) {
  const o = our.get(k)
  if (!o) {
    missing.push(e)
    continue
  }
  const sameWin = o.window.length === e.window.length && o.window.every((v, i) => v === e.window[i])
  if (!sameWin || o.syncOnce !== e.syncOnce || o.battleOnce !== e.battleOnce)
    differing.push({ upstream: e, ours: o })
}
for (const [k, e] of our) if (!up.has(k)) extras.push(e)

console.log(`upstream: ${up.size}  ours: ${our.size}`)
console.log('missing (upstream \\ ours):', missing.length)
missing.forEach(e => console.log(' +', JSON.stringify(e)))
console.log('differing:', differing.length)
differing.forEach(d => console.log(' Δ', JSON.stringify(d)))
console.log('ours-only:', extras.length)
extras.forEach(e => console.log(' *', JSON.stringify(e)))
```

```bash
node .diff-sync-rules.mjs
```

输出三个集合：

- **missing**：上游有、本仓库无 → 需要补
- **differing**：同 `(id, type)`，但 `window` / `syncOnce` / `battleOnce` 不一致 → 报告给用户决策（本仓库可能故意改过，不要默认覆盖）
- **ours-only**：本仓库有、上游无 → 报告即可，**保留**（Healerbook 自有规则）

### 3. 补齐 missing 条目

对每条 missing entry，按本仓库格式追加到 `src/data/soumaSyncRules.ts` 的 Map 末尾：

- 上游：
  ```ts
  windowAction.set(0xc36d, { type: 'cast', window: [60, 60], syncOnce: true, battleOnce: true }) // 无光的世界
  ```
- 本仓库：注释独立成行 + 元组写法（保留 hex/decimal 原样、引号改单引号）：
  ```ts
  // 极恩欧 无光的世界
  [0xc36d, { type: 'cast', window: [60, 60], syncOnce: true, battleOnce: true }],
  ```

副本名补充来源：上游用 section header（如 `// 极恩欧`、`// M5S`）+ 行末机制名两段表达；本仓库每条独立写为 `// <副本> <机制名>`。

### 4. 校验 & 清理

```bash
pnpm exec tsc --noEmit
pnpm lint
rm .cache-upstream-rules.ts .diff-sync-rules.mjs
```

重跑一次脚本（在 rm 前）确认 missing/differing 都为 0：

```bash
node .diff-sync-rules.mjs
```

### 5. 提交（仅在用户当前对话明确授权 commit 时）

```bash
git add src/data/soumaSyncRules.ts
git commit -m "data(souma): add <副本> <机制> sync rule"            # 单条
# or
git commit -m "data(souma): sync N rule(s) from upstream <短sha>"   # 多条
```

> `.husky/commit-msg` 会拒绝包含 "claude" 字样的 commit message / 作者，**不要带 Claude co-author**。

## 格式转换速查

| 上游 (`timelineSpecialRules.ts`)        | 本仓库 (`soumaSyncRules.ts`)                |
| --------------------------------------- | ------------------------------------------- |
| `windowAction.set(ID, OPTS); // 机制名` | `// 副本 机制名` 一行<br>`[ID, OPTS],` 一行 |
| 双引号 `"cast"` / `"begincast"`         | 单引号 `'cast'` / `'begincast'`             |
| section header `// 极恩欧` 分散在上下文 | 合并到每条注释：`// 极恩欧 无光的世界`      |
| 数字字面量 `0xc36d` / `26155`           | 保持原样（hex 不要转 decimal）              |

## 注意事项

- **submodule pin 不参与 diff**：本 skill 只用 `gh api` 抓上游 `main`，不读 `3rdparty/ff14-overlay-vue/`，也不动 submodule pin。
- **去重主键 = (id, type)**：上游历史曾出现同 ID 写两次（如 `31573` 在第 40、41 行各 `set` 一次），`Map` 天然去重；本仓库照抄一份即可。
- **flag 严格对齐**：`syncOnce: false` / `battleOnce: false` **不要补出来**，缺省即视为 false；上游有就有，没有就没有。
- **differing 不要静默覆盖**：脚本报告 `differing` 时停下来给用户决策。本仓库可能故意调过 `window` 容差，机械同步会回退这个修改。
- **ours-only 保留**：脚本报告的 `extras` 是 Healerbook 自有规则，**不删**。本 skill 做的是"上游 → 本仓库"单向补差。
- **CLAUDE.md git 规则**：本 skill 内的 `git commit` 仅在用户当前对话**明确**请求执行同步时生效；非 subagent-driven 自动任务下，每次会话仍需用户授权才能 commit。
- **临时文件**：`.cache-upstream-rules.ts` 和 `.diff-sync-rules.mjs` 用完即删，**不要提交**。

## 真实案例

2026-05-28 用户给出 `windowAction.set(0xc36d, { type: "cast", window: [60, 60], syncOnce: true, battleOnce: true }); // 无光的世界`，标注副本 "极恩欧"。

按步骤 3 转换后追加到 Map 末尾，commit `data(souma): add 极恩欧 无光的世界 sync rule`。

事后跑 skill 自检（步骤 1+2）：上游 main 当时 SHA `8da3fb4`，63 entries；本仓库同 63 entries；`missing: 0  differing: 0  ours-only: 0` —— 完全对齐。
