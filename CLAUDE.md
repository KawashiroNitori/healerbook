# Healerbook 项目指南

> FF14 减伤规划工具 - 基于 FFLogs 的可视化时间轴编辑器

## 项目概述

Healerbook 是一个专为 FF14 治疗职业设计的减伤技能规划工具，提供：

- 可视化时间轴编辑器，规划副本减伤技能使用时机
- 实时计算减伤后的最终伤害值
- 从 FFLogs 导入副本数据快速建立时间轴
- 参考 TOP100 小队的减伤方案
- 时间轴云端分享与协作

## 技术栈

### 核心

- **React 19** + **TypeScript 5.9** — 前端框架
- **Vite 7** — 构建工具
- **pnpm** — 包管理器（必须使用 pnpm，不要使用 npm/yarn）

### UI

- **Tailwind CSS v3** — 样式框架
- **shadcn/ui**（New York style）— 基础组件库
- **React-Konva / Konva** — Canvas 时间轴渲染
- **Lucide React** — 图标库
- **Sonner** — Toast 通知
- **next-themes** — 主题管理

### 状态管理

- **Zustand 5** — 状态管理（4 个 store）
- **TanStack Query** — 服务端数据获取与缓存

### 网络

- **ky** — HTTP 客户端（带自动 token 续期）
- **graphql-request** — FFLogs GraphQL API 客户端

### 后端 / 部署

- **Cloudflare Workers** — Serverless 边缘计算
- **Cloudflare Pages** — 静态托管
- **Cloudflare KV** — TOP100 数据缓存
- **Cloudflare D1** — 共享时间轴存储
- **Cloudflare Queues** — 异步同步任务

### 测试

- **Vitest 4** — 单元测试

## 项目结构

```
src/
├── api/                    # 前端 API 客户端
│   ├── apiClient.ts        # ky 统一客户端（自动注入 token，401 自动续期）
│   ├── fflogsClient.ts     # FFLogs 数据获取（调用 Worker 接口）
│   ├── timelineShareApi.ts # 共享时间轴 CRUD（含乐观锁冲突检测）
│   ├── statistics.ts       # 副本统计数据
│   ├── xivapi.ts           # XIVAPI 集成
│   └── IFFLogsClient.ts    # 客户端接口定义
├── components/             # React 组件
│   ├── ui/                 # shadcn/ui 基础组件
│   ├── Timeline/           # 时间轴 Canvas 组件
│   │   ├── index.tsx           # 主时间轴组件（拖拽、平移、键盘快捷键）
│   │   ├── SkillTracksCanvas.tsx # 技能轨道渲染层
│   │   ├── DamageEventTrack.tsx  # 伤害事件轨道
│   │   ├── TimeRuler.tsx         # 时间标尺
│   │   ├── TimelineMinimap.tsx   # 小地图
│   │   ├── SkillTrackLabels.tsx  # 职业标签
│   │   ├── SkillIcon.tsx         # 技能图标
│   │   ├── CastEventIcon.tsx     # 技能使用事件图标
│   │   ├── DamageEventCard.tsx   # 伤害事件卡片
│   │   └── constants.ts          # 共享常量（十字准线等）
│   ├── AddEventDialog.tsx        # 添加伤害事件对话框
│   ├── ImportFFLogsDialog.tsx    # 导入 FFLogs 报告对话框
│   ├── CompositionDialog.tsx     # 编辑小队阵容对话框
│   ├── ConflictDialog.tsx        # 版本冲突解决对话框
│   ├── CreateTimelineDialog.tsx  # 新建时间轴对话框
│   ├── SharePopover.tsx          # 分享弹出菜单
│   ├── SkillPanel.tsx            # 技能选择面板
│   ├── PropertyPanel.tsx         # 属性面板
│   ├── StatusIndicator.tsx       # 同步状态指示器
│   ├── EditorToolbar.tsx         # 编辑器工具栏
│   ├── AuthButton.tsx            # 登录/登出按钮
│   ├── AuthProvider.tsx          # 认证 Provider
│   ├── ActionTooltip.tsx         # 技能悬浮提示
│   ├── TooltipOverlay.tsx        # 提示叠加层
│   ├── TimelineCard.tsx          # 时间轴列表卡片
│   ├── PlayerDamageDetails.tsx   # 玩家伤害详情
│   ├── Top100Section.tsx         # TOP100 数据区
│   ├── EditableTitle.tsx         # 可编辑标题
│   └── ErrorBoundary.tsx         # 错误边界
├── contexts/               # React Context
│   ├── DamageCalculationContext.ts
│   └── AuthContext.ts
├── data/                   # 静态数据
│   ├── mitigationActions.ts     # 31 个减伤技能定义（executor 工厂模式）
│   ├── jobs.ts                  # 21 个职业定义及工具函数
│   ├── jobMap.ts                # FFLogs spec 名 → 职业代码映射
│   └── raidEncounters.ts        # 副本配置（6.x-7.x Savage/Ultimate）
├── executors/              # 技能执行器工厂
│   ├── createBuffExecutor.ts        # 友方 Buff（群体/单体）
│   ├── createShieldExecutor.ts      # 盾值（含暴击盾、多层盾）
│   ├── utils.ts                     # ID 生成工具
│   └── index.ts
├── hooks/                  # React Hooks
│   ├── useDamageCalculation.ts      # 伤害计算（编辑/回放双模式）
│   ├── useEncounterStatistics.ts    # 副本统计数据加载
│   ├── useAuth.ts                   # FFLogs OAuth 认证流程
│   ├── useTimelinePanZoom.ts        # 时间轴缩放/平移事件
│   └── useEditorReadOnly.ts         # 只读模式管理
├── pages/                  # 页面组件
│   ├── HomePage.tsx         # 首页（我的时间轴 + 已发布时间轴）
│   ├── EditorPage.tsx       # 编辑器页面（/timeline/:id，三模式自动推导）
│   └── CallbackPage.tsx     # FFLogs OAuth 回调页
├── store/                  # Zustand 状态管理
│   ├── timelineStore.ts    # 时间轴数据、小队状态、缩放、自动保存、服务器同步
│   ├── mitigationStore.ts  # 技能列表、选择、职业过滤
│   ├── uiStore.ts          # UI 状态（面板、显示选项、主题、只读模式）
│   ├── authStore.ts        # Token 持久化（localStorage）
│   └── tooltipStore.ts     # 悬浮提示状态
├── types/                  # TypeScript 类型定义
│   ├── timeline.ts         # Timeline, DamageEvent, CastEvent, Phase, Composition
│   ├── mitigation.ts       # MitigationAction, ActionExecutor, EncounterStatistics
│   ├── status.ts           # MitigationStatus, MitigationStatusMetadata
│   ├── partyState.ts       # PartyState, PlayerState
│   ├── fflogs.ts           # FFLogs v1/v2 API 类型
│   └── index.ts
├── utils/                  # 工具函数
│   ├── mitigationCalculator.ts     # 减伤计算引擎（MitigationCalculator 类）
│   ├── statusRegistry.ts           # 状态 ID → 元数据注册表
│   ├── fflogsImporter.ts           # FFLogs 数据解析（阵容、伤害事件、技能）
│   ├── fflogsParser.ts             # 从 URL 提取报告代码/战斗 ID
│   ├── timelineStorage.ts          # LocalStorage 封装
│   ├── stats.ts                    # 百分位计算、HP 工具函数
│   ├── iconUtils.ts                # 技能图标 URL 处理
│   ├── statusIconUtils.ts          # 状态图标处理
│   └── rosterUtils.ts              # 小队数据处理
└── workers/                # Cloudflare Workers
    ├── index.ts            # Worker 入口（fetch, scheduled, queue）
    ├── fflogs-proxy.ts     # HTTP 路由分发（顶层路由器）
    ├── auth.ts             # FFLogs OAuth 回调 + Token 续期
    ├── timelines.ts        # 共享时间轴 CRUD（D1 存储，乐观锁）
    ├── jwt.ts              # JWT 签发与验证
    ├── fflogsClientV2.ts   # FFLogs GraphQL v2 客户端
    ├── top100Sync.ts       # TOP100 数据同步 + 统计提取
    └── *.test.ts           # Worker 单元测试
```

## 核心概念

### 1. 技能与状态解耦架构

技能使用时不直接产生减伤效果，而是通过 **Executor** 向 `PartyState` 附加状态，减伤效果由状态和计算器在计算阶段决定。

```
技能使用 → Executor → PartyState.statuses 更新
                              ↓
                    MitigationCalculator → 最终伤害
```

**核心类型**：

```typescript
// 技能定义
interface MitigationAction {
  id: number
  name: string
  icon: string
  jobs: Job[]
  duration: number
  cooldown: number
  uniqueGroup: number[] // 互斥组（同组内旧状态被替换）
  executor: ActionExecutor // 执行器函数
}

// 执行器
type ActionExecutor = (context: ActionExecutionContext) => PartyState

// 状态实例
interface MitigationStatus {
  instanceId: string
  statusId: number // 引用 keigenn.ts 状态元数据
  startTime: number
  endTime: number
  remainingBarrier?: number // 盾值（仅盾类状态）
  sourceActionId?: number
  sourcePlayerId?: number
}

// 小队状态
interface PartyState {
  players: PlayerState[]
  statuses: MitigationStatus[] // 全局状态（含敌方 debuff）
  timestamp: number
}
```

### 2. 执行器工厂

```typescript
// 友方 Buff（群体或单体）
createBuffExecutor(statusIds, duration, isPartyWide)

// 盾值
createShieldExecutor(statusIds, duration, isPartyWide, shieldMultiplier)
```

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

### 5. 时间轴布局

```
┌─────────────────────────────────────────┐
│ 时间标尺轨道                             │ ← 固定（不随内容滚动）
├─────────────────────────────────────────┤
│ 伤害事件轨道                             │ ← 固定
├─────────────────────────────────────────┤
│ 技能轨道（按职业分行）                   │ ← 可垂直滚动
│   [职业标签] [技能图标] [技能图标] ...   │
└─────────────────────────────────────────┘
```

- **缩放级别**：50 px/秒（可调 10–200）
- **网格间隔**：10 秒
- **交互**：拖拽技能到时间轴、拖拽调整时间、点击空白区域平移

### 6. 自动保存 + 服务器同步

- 本地：用户操作后 2 秒自动保存到 LocalStorage（debounce）
- 服务器：手动触发发布/更新，使用乐观锁（`expectedVersion`），冲突返回 409

### 7. 认证系统

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

## 常用命令

```bash
# 开发
pnpm dev              # 启动前端开发服务器（含 Worker 代理）
pnpm workers:dev      # 单独启动 Worker 开发服务器

# 构建 & 部署
pnpm build            # 构建前端
pnpm workers:deploy   # 部署 Worker 到生产

# 测试
pnpm test             # watch 模式
pnpm test:run         # 单次运行
pnpm test:run --coverage  # 生成覆盖率报告

# 代码质量
pnpm lint             # ESLint 检查
pnpm lint:fix         # 自动修复
pnpm format           # Prettier 格式化
```

## 测试覆盖

**129 个测试，全部通过**

| 文件                                 | 测试数 | 说明                    |
| ------------------------------------ | ------ | ----------------------- |
| `workers/timelines.test.ts`          | 18     | 共享时间轴 CRUD、乐观锁 |
| `utils/fflogsImporter.test.ts`       | 33     | FFLogs 数据解析         |
| `utils/mitigationCalculator.test.ts` | 17     | 减伤计算引擎            |
| `workers/top100Sync.test.ts`         | 12     | TOP100 同步             |
| `workers/fflogs-proxy.test.ts`       | 9      | Worker 路由             |
| `data/mitigationActions.test.ts`     | 9      | 技能数据完整性          |
| `utils/statusRegistry.test.ts`       | 6      | 状态注册表              |
| `utils/timelineStorage.test.ts`      | 7      | LocalStorage 封装       |
| `utils/statusIconUtils.test.ts`      | 5      | 图标工具函数            |
| `executors/executors.test.ts`        | 5      | 执行器工厂              |
| `store/timelineStore.test.ts`        | 5      | 状态管理                |
| `store/authStore.test.ts`            | 3      | Token 持久化            |

## 关键文件说明

| 文件                                | 说明                                      |
| ----------------------------------- | ----------------------------------------- |
| `src/api/apiClient.ts`              | ky 客户端，含 401 自动续期逻辑            |
| `src/utils/mitigationCalculator.ts` | 减伤计算引擎（`MitigationCalculator` 类） |
| `src/utils/statusRegistry.ts`       | 状态 ID → 元数据映射（引用 keigenn.ts）   |
| `src/utils/fflogsImporter.ts`       | FFLogs 数据解析入口                       |
| `src/data/mitigationActions.ts`     | 31 个技能定义                             |
| `src/data/jobs.ts`                  | 21 个职业定义及角色分类                   |
| `src/workers/timelines.ts`          | 共享时间轴 D1 CRUD（含版本冲突检测）      |
| `src/workers/jwt.ts`                | JWT 签发与验证（jose）                    |
| `src/components/Timeline/index.tsx` | 时间轴主组件（Canvas 交互核心）           |

## 待实现功能

- [ ] 导出功能（JSON、图片）
- [ ] TOP100 数据源前端集成
- [ ] 性能优化（大型时间轴）
- [ ] 部署到 xivhealer.com（Workers + Pages）

---

**最后更新**: 2026-03-26
**项目状态**: 开发中
**线上地址**: https://xivhealer.com（计划中）
