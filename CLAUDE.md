# Healerbook 项目指南

> FF14 减伤规划工具 - 基于 FFLogs 的可视化时间轴编辑器

## Git 操作规则

未经过用户明确要求，不得自行进行 Git 操作（包括 commit、push、reset 等）。

**重要**：用户的明确要求必须是以最新一条消息为准。不可以把历史上下文中的用户 Git 要求视为允许。每次执行 Git 操作前，必须确认用户在当前对话的最新消息中明确授权该操作。

## 提交约定

- **禁止** 在提交信息、作者或 Co-Authored-By 字段中包含 "Claude" 字样。`.husky/commit-msg` hook 会拒绝提交信息或作者中包含 "claude"（大小写不敏感）的提交。
- `.husky/pre-commit` 通过 lint-staged 运行 Prettier/ESLint/TypeScript 检查；commit 前确保改动能通过这些检查。

## 项目概述

Healerbook 是一个专为 FF14 治疗职业设计的减伤技能规划工具，提供：

- 可视化时间轴编辑器，规划副本减伤技能使用时机
- 实时计算减伤后的最终伤害值
- 从 FFLogs 导入副本数据快速建立时间轴
- 参考 TOP100 小队的减伤方案
- 时间轴云端分享与协作

## 技术栈

- **前端**：React 19 + TypeScript 5.9，Vite 7 构建，**必须用 pnpm**
- **UI**：Tailwind CSS v3、shadcn/ui（New York）、React-Konva（Canvas 时间轴）、Lucide、Sonner、next-themes
- **状态**：Zustand 5、TanStack Query
- **网络**：ky（HTTP，带 token 自动续期）、graphql-request（FFLogs GraphQL）
- **后端 / 部署**：Cloudflare Workers + Pages + D1 + KV + Queues
- **测试**：Vitest 4（测试文件与源文件同目录 `*.test.ts`）

## 常用命令

```bash
# 安装依赖
pnpm install          # 首次 clone、拉代码后 package.json/pnpm-lock 有变化、或新增依赖后

# 开发
pnpm dev              # 启动前端开发服务器（含 Worker 代理）；通常用户已启动，agent 不要主动启动

# 构建
pnpm build            # 构建前端；改动涉及打包/依赖，或声称"完成"前兜底

# 测试
pnpm test             # watch 模式；本地持续开发时用
pnpm test:run         # 单次全量运行；声称任务"完成"前必跑
pnpm test:run <pat>   # 单模块测试；改动小范围时用于快速反馈
pnpm test:run --coverage  # 生成覆盖率报告；需要看覆盖率时

# 代码质量
pnpm exec tsc --noEmit  # 类型检查；每次改动后建议跑
pnpm lint             # ESLint 检查；声称任务"完成"前必跑
pnpm lint:fix         # 自动修复 lint；手动出错时用
pnpm format           # Prettier 格式化；通常不需要（lint-staged 会处理 staged 文件）
```

**提交前**：`.husky/pre-commit` 通过 lint-staged 自动跑 Prettier / ESLint / tsc 针对 staged 文件，但 **不跑全量测试**。要避免带坏其他模块，需要自己跑 `pnpm test:run`。

## 项目结构

```
src/
├── api/          # 前端 API 客户端（ky / FFLogs / 共享时间轴 / XIVAPI）
├── components/   # React 组件（含 ui/、Timeline/、TimelineTable/ 子目录）
├── contexts/     # React Context（DamageCalculation / Auth）
├── data/         # 静态数据（减伤技能、职业、副本、FFLogs spec 映射）
├── executors/    # 技能执行器工厂（Buff、Shield 等）
├── hooks/        # React Hooks（伤害计算、副本统计、OAuth 等）
├── pages/        # 页面组件（HomePage / EditorPage / CallbackPage）
├── store/        # Zustand 状态管理
├── types/        # TypeScript 类型定义
├── utils/        # 工具函数（减伤计算、FFLogs 解析、导出等）
└── workers/      # Cloudflare Workers（HTTP 路由、OAuth、D1、TOP100 同步）
```

具体文件以代码为准，需要时使用 Glob/Grep 工具查看。

## 关键文件说明

| 文件                                | 说明                                      |
| ----------------------------------- | ----------------------------------------- |
| `src/api/apiClient.ts`              | ky 客户端，含 401 自动续期逻辑            |
| `src/utils/mitigationCalculator.ts` | 减伤计算引擎（`MitigationCalculator` 类） |
| `src/utils/statusRegistry.ts`       | 状态 ID → 元数据映射（引用 keigenn.ts）   |
| `src/utils/fflogsImporter.ts`       | FFLogs 数据解析入口                       |
| `src/data/mitigationActions.ts`     | 技能定义                                  |
| `src/data/jobs.ts`                  | 职业定义及角色分类                        |
| `src/workers/timelines.ts`          | 共享时间轴 D1 CRUD（含版本冲突检测）      |
| `src/workers/jwt.ts`                | JWT 签发与验证（jose）                    |
| `src/components/Timeline/index.tsx` | 时间轴主组件（Canvas 交互核心）           |

## 核心概念

### 1. 技能与状态解耦架构

技能使用时不直接产生减伤效果，而是通过 **Executor** 向 `PartyState` 附加状态，减伤效果由状态和计算器在计算阶段决定。

```
技能使用 → Executor → PartyState.statuses 更新
                              ↓
                    MitigationCalculator → 最终伤害
```

核心类型定义见 `src/types/mitigation.ts`、`src/types/status.ts`、`src/types/partyState.ts`。

### 2. 执行器工厂

执行器工厂实现见 `src/executors/`。

### 3. 减伤计算公式

```
最终伤害 = 原始伤害 × (1-减伤1%) × (1-减伤2%) × ... - 盾值
```

- **百分比减伤**：乘算（multiplicative）
- **盾值**：减算（subtractive），在百分比减伤之后应用

### 4. 编辑器三种模式

`EditorPage` 统一挂载在 `/timeline/:id`，模式根据上下文自动推导：

| 模式     | 触发条件               | 权限            |
| -------- | ---------------------- | --------------- |
| `local`  | 本地时间轴，未发布     | 完整编辑        |
| `author` | 已发布，当前用户是作者 | 完整编辑 + 同步 |
| `view`   | 已发布，他人时间轴     | 只读            |

### 4.5. 资源模型（CD / 充能 / 共享池）

技能使用可用性由**资源池**统一表达，替代原"单层 cooldown + 假 buff stack"方案。设计见 `design/superpowers/specs/2026-04-24-resource-model-design.md`。

- **`ResourceDefinition`** 在 `src/data/resources.ts` 的 `RESOURCE_REGISTRY` 中声明（如 `sch:consolation`、`drk:oblation`）。池按 `(playerId, resourceId)` 懒实例化。
- **`MitigationAction.resourceEffects`** 声明一次 cast 对资源的影响（`+N` 产出、`-N` 消耗）。含消费者（`delta<0`）时，跳过 `__cd__` 合成；否则合成 `__cd__:${id}` 单充能池强制 `cooldown`。
- **`regen`** 采用充能计时语义：每次消耗调度 `interval` 秒后的独立 refill，**不**是从 t=0 固定节拍。
- **校验**：`findResourceExhaustedCasts` 判 cast 是否因资源不足非法；shadow 由 `resourceLegalIntervals`（自耗尽段 + 下游透支段）推导。
- **trackGroup** 与资源模型**完全解耦**，仅用于 UI 渲染轨道归属。
- **蓝色 CD 条** 的语义是"此 cast 打空池子到恢复的时段"；还有库存时不画。

### 5. 认证系统

- FFLogs OAuth 2.0 Authorization Code Flow
- Worker 签发自有 JWT（accessToken 15 分钟，refreshToken 30 天）
- 前端 `apiClient` 在收到 401 时自动用 refreshToken 续期并重试，续期失败则清除 token

## 开发规范

### 命名约定

所有减伤技能相关命名使用 `action`，不使用 `skill`：

- ✅ `MitigationAction`、`actionId`、`loadActions()`
- ❌ `MitigationSkill`、`skillId`、`loadSkills()`

### 状态更新模式

```typescript
// ✅ 正确：不可变更新
set(state => ({
  timeline: { ...state.timeline, damageEvents: [...state.timeline.damageEvents, newEvent] },
}))

// ❌ 错误：直接修改
state.timeline.damageEvents.push(newEvent)
```

### Workers 路由结构

`fflogs-proxy.ts` 是顶层路由器，按功能域分发：

```
POST /api/auth/callback         → auth.ts（FFLogs OAuth 回调）
POST /api/auth/refresh          → auth.ts（Token 续期）
/api/timelines/*                → timelines.ts（共享时间轴 CRUD）
GET  /api/my/timelines          → timelines.ts（我的时间轴列表）
/api/fflogs/*                   → fflogs-proxy.ts 内联（FFLogs 代理）
/api/top100/*                   → fflogs-proxy.ts 内联（TOP100 数据）
/api/statistics/*               → fflogs-proxy.ts 内联（副本统计）
```

### Konva 性能

```typescript
// 禁用不必要的渲染特性
<Rect shadowEnabled={false} perfectDrawEnabled={false} />

// 目标 Layer 数量 ≤ 3
```

---

**最后更新**: 2026-04-24
**线上地址**: https://xivhealer.com
