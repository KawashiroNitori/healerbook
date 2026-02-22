# Healerbook 项目指南

> FF14 减伤规划工具 - 基于 FFLogs 的可视化时间轴编辑器

## 项目概述

Healerbook 是一个专为 FF14 治疗职业设计的减伤技能规划工具。通过可视化的时间轴编辑器，玩家可以：
- 规划副本中的减伤技能使用时机
- 实时计算减伤效果后的伤害值
- 导入 FFLogs 数据快速创建时间轴
- 参考 TOP100 小队的减伤方案

## 技术栈

### 核心技术
- **React 19** + **TypeScript** - 前端框架
- **Vite** - 构建工具
- **pnpm** - 包管理器（必须使用 pnpm，不要使用 npm）

### UI 层
- **Tailwind CSS v3** - 样式框架
- **shadcn/ui** (New York style) - UI 组件库
- **React-Konva** - Canvas 时间轴可视化
- **Lucide React** - 图标库

### 状态管理
- **Zustand** - 轻量级状态管理
  - `timelineStore` - 时间轴数据和编辑状态
  - `mitigationStore` - 减伤技能数据和过滤器
  - `uiStore` - UI 显示状态（网格、标尺等）

### 数据层
- **TanStack Query** - 数据获取和缓存
- **GraphQL Request** - FFLogs API 客户端
- **LocalStorage** - 时间轴本地持久化

### 测试
- **Vitest** - 单元测试框架
- 测试覆盖率要求：80%+

### 部署（计划中）
- **Cloudflare Workers** - Serverless 后端
- **Cloudflare Pages** - 静态托管
- **Cloudflare R2** - 对象存储
- **Cloudflare KV** - 键值缓存

## 项目结构

```
src/
├── api/                    # API 客户端
│   ├── fflogsClient.ts    # FFLogs v1 REST API 客户端
│   └── mitigationData.ts  # 减伤技能数据加载 (已废弃)
├── components/            # React 组件
│   ├── ui/               # shadcn/ui 基础组件
│   ├── Timeline/         # 时间轴组件
│   │   ├── index.tsx           # 时间轴主组件
│   │   ├── DamageEventCard.tsx # 伤害事件卡片
│   │   └── DamageEventTrack.tsx # 伤害事件轨道
│   ├── SkillPanel.tsx        # 技能面板
│   ├── PropertyPanel.tsx     # 属性面板
│   ├── StatusIndicator.tsx   # 状态指示器 (新)
│   ├── EditorToolbar.tsx     # 编辑器工具栏
│   └── AddEventDialog.tsx    # 添加事件对话框
├── pages/                 # 页面组件
│   ├── HomePage.tsx      # 首页（时间轴列表）
│   └── EditorPage.tsx    # 编辑器页面
├── store/                 # Zustand 状态管理
│   ├── timelineStore.ts  # 时间轴状态 + 小队状态管理
│   ├── mitigationStore.ts # 减伤技能状态
│   └── uiStore.ts        # UI 状态
├── types/                 # TypeScript 类型定义
│   ├── timeline.ts       # 时间轴相关类型
│   ├── mitigation.ts     # 减伤技能类型 (新架构)
│   ├── status.ts         # 状态类型 (新)
│   ├── partyState.ts     # 小队状态类型 (新)
│   └── fflogs.ts         # FFLogs API 类型
├── utils/                 # 工具函数
│   ├── mitigationCalculator.ts      # 旧计算引擎 (已废弃)
│   ├── mitigationCalculator.v2.ts   # 新计算引擎 (基于状态)
│   ├── statusRegistry.ts            # 状态注册表 (新)
│   ├── timelineStorage.ts           # 本地存储
│   ├── fflogsParser.ts              # FFLogs URL 解析
│   └── fflogsImporter.ts            # FFLogs 数据导入
├── executors/             # 技能执行器 (新)
│   ├── createFriendlyBuffExecutor.ts  # 友方 Buff 工厂
│   ├── createEnemyDebuffExecutor.ts   # 敌方 Debuff 工厂
│   ├── createShieldExecutor.ts        # 盾值工厂
│   └── utils.ts                       # ID 生成工具
├── data/                  # 静态数据
│   ├── mitigationActions.ts     # 旧技能数据 (已废弃)
│   └── mitigationActions.new.ts # 新技能数据 (31 个技能)
├── hooks/                 # React Hooks
│   ├── useDamageCalculation.ts    # 旧计算 Hook (已废弃)
│   └── useDamageCalculationV2.ts  # 新计算 Hook (基于状态)
├── lib/                   # 第三方库配置
│   └── utils.ts          # shadcn/ui 工具函数
├── App.tsx               # 应用根组件
└── main.tsx              # 应用入口
```

## 核心概念

### 1. 新架构：技能使用与状态附加解耦

**核心思想**: 技能使用时不直接产生减伤效果,而是附加状态,减伤效果由状态决定。

#### 架构组件

1. **技能 (MitigationAction)**
   - 定义技能的基本信息 (ID, 名称, 图标, 职业等)
   - 包含 `executor` 函数,负责附加状态

2. **状态 (MitigationStatus)**
   - 运行时状态实例,包含开始/结束时间
   - 可选的 `remainingBarrier` 字段用于盾值

3. **状态元数据 (MitigationStatusMetadata)**
   - 引用自 `ff14-overlay-vue/keigenn.ts`
   - 定义状态的减伤效果 (物理/魔法/特殊)

4. **小队状态 (PartyState)**
   - 包含所有玩家的状态列表
   - 包含虚拟敌方的状态列表

5. **执行器 (ActionExecutor)**
   - 接收 `ActionExecutionContext`,返回新的 `PartyState`
   - 不可变更新,不修改原状态

#### 数据流

```
技能使用 → Executor → 附加状态 → PartyState 更新
                                      ↓
                            计算器读取状态 → 计算减伤
```

### 2. 减伤机制

FF14 中的减伤通过状态实现：

```typescript
// 状态类型
type StatusType =
  | 'multiplier'  // 百分比减伤 (乘算)
  | 'absorbed'    // 盾值减伤 (减算)

// 状态性能
interface StatusPerformance {
  physics: number   // 物理减伤倍率 (0-1)
  magic: number     // 魔法减伤倍率 (0-1)
  darkness: number  // 特殊减伤倍率 (0-1)
}
```

### 3. 减伤计算公式

### 3. 减伤计算公式

```
最终伤害 = 原始伤害 × (1-减伤1%) × (1-减伤2%) × ... - 盾值
```

- 百分比减伤采用**乘算** (multiplicative)
- 盾值减伤采用**减算** (subtractive)
- 盾值在百分比减伤之后应用

示例：
```
原始伤害: 10000
状态1: 节制 (10% 减伤)
状态2: 雪仇 (10% 减伤)
状态3: 鼓舞盾 (1000 盾值)

计算过程:
10000 × (1-0.1) × (1-0.1) - 1000 = 8100 - 1000 = 7100
```

### 4. 数据模型

#### PartyState（小队状态）
```typescript
interface PartyState {
  players: PlayerState[]  // 玩家列表
  enemy: EnemyState       // 虚拟敌方
  timestamp: number       // 当前时间戳
}

interface PlayerState {
  id: number              // 玩家 ID (对应 FFLogsActor.id)
  job: Job                // 职业
  currentHP: number       // 当前 HP
  maxHP: number           // 最大 HP
  statuses: MitigationStatus[]  // 状态列表
}

interface EnemyState {
  statuses: MitigationStatus[]  // 敌方状态列表 (无 id 字段)
}
```

#### MitigationStatus（状态实例）
```typescript
interface MitigationStatus {
  instanceId: string      // 唯一实例 ID
  statusId: number        // 状态 ID (引用 keigenn.ts)
  startTime: number       // 开始时间 (秒)
  endTime: number         // 结束时间 (秒)
  remainingBarrier?: number  // 剩余盾值 (可选)
  sourceActionId?: number    // 来源技能 ID
  sourcePlayerId?: number    // 来源玩家 ID
}
```

#### MitigationAction（技能）
```typescript
interface MitigationAction {
  id: number              // 技能 ID
  name: string            // 技能名称
  icon: string            // 图标路径
  uniqueGroup: number[]   // 互斥组
  jobs: Job[]             // 可用职业
  duration: number        // 持续时间 (秒)
  cooldown: number        // 冷却时间 (秒)
  executor: ActionExecutor  // 执行器函数
}

type ActionExecutor = (context: ActionExecutionContext) => PartyState

interface ActionExecutionContext {
  actionId: number        // 技能 ID
  useTime: number         // 使用时间 (秒)
  partyState: PartyState  // 当前小队状态
  targetPlayerId?: number // 目标玩家 ID (可选)
}
```

### 5. 执行器工厂

项目提供三种工厂函数用于创建常见的执行器：

#### createFriendlyBuffExecutor
为友方附加 Buff 状态 (群体或单体)

```typescript
createFriendlyBuffExecutor(
  statusIds: number[],      // 状态 ID 列表
  duration: number,         // 持续时间
  isPartyWide: boolean      // 是否群体技能
): ActionExecutor
```

#### createEnemyDebuffExecutor
为敌方附加 Debuff 状态

```typescript
createEnemyDebuffExecutor(
  statusIds: number[],      // 状态 ID 列表
  duration: number          // 持续时间
): ActionExecutor
```

#### createShieldExecutor
为友方附加盾值状态

```typescript
createShieldExecutor(
  statusIds: number[],      // 状态 ID 列表
  duration: number,         // 持续时间
  isPartyWide: boolean,     // 是否群体技能
  shieldMultiplier: number  // 盾值倍率 (相对于最大 HP)
): ActionExecutor
```

### 6. 时间轴布局

时间轴采用水平轨道布局：

```
┌─────────────────────────────────────────┐
│ 时间标尺轨道 (30px)                      │ ← 可选显示
├─────────────────────────────────────────┤
│ 伤害事件轨道 (80px)                      │ ← 显示伤害事件矩形框
├─────────────────────────────────────────┤
│ 内容区域 (自适应)                        │ ← 显示减伤分配
│   - 减伤技能图标                         │
│   - 连接线                               │
│   - 当前时间指示器                       │
└─────────────────────────────────────────┘
```

- **缩放级别**: 50 像素/秒（可调整 10-200）
- **网格间隔**: 每 10 秒一条垂直线
- **拖拽**: 支持拖拽技能到时间轴、拖拽事件和技能调整时间
- **平移**: 点击空白区域拖动可水平滚动时间轴

## 开发规范

### 命名约定

**重要变更**: 项目中所有 `skill` 相关命名已统一重命名为 `action`

- ✅ `MitigationAction` (不是 MitigationSkill)
- ✅ `actionId` (不是 skillId)
- ✅ `actions` (不是 skills)
- ✅ `loadActions()` (不是 loadSkills())
- ✅ `getActionById()` (不是 getSkillById())

### 状态管理模式

使用 Zustand 的不可变更新模式：

```typescript
// ✅ 正确：创建新对象
set((state) => ({
  timeline: {
    ...state.timeline,
    damageEvents: [...state.timeline.damageEvents, newEvent]
  }
}))

// ❌ 错误：直接修改
state.timeline.damageEvents.push(newEvent)
```

### 自动保存机制

时间轴编辑器实现了 VS Code 风格的延迟自动保存：

```typescript
const AUTO_SAVE_DELAY = 2000 // 2 秒延迟

// 所有修改操作后调用
get().triggerAutoSave()
```

- 用户操作后 2 秒自动保存到 LocalStorage
- 使用 debounce 避免频繁保存
- 无需手动保存按钮

### 性能优化

#### Konva 性能优化
```typescript
// 减少 Layer 数量（目标：≤3 层）
<Layer>
  <GridComponent />
  <TimeRulerComponent />
  <DamageEventsComponent />
</Layer>

// 禁用不必要的渲染特性
<Rect
  shadowEnabled={false}
  perfectDrawEnabled={false}
/>
```

#### 事件处理优化
```typescript
// 使用 Konva Stage 事件而非 DOM 事件
stage.on('mousedown', handleStageMouseDown)
stage.on('mousemove', handleStageMouseMove)

// 背景检测避免事件冲突
const clickedOnBackground =
  e.target === stage ||
  (e.target.getClassName() === 'Rect' &&
   e.target.attrs.fill === '#fafafa')
```

### 测试要求

所有核心逻辑必须有单元测试：

```bash
pnpm test          # 运行测试
pnpm test:ui       # 测试 UI
pnpm test:run      # CI 模式
pnpm test:run --coverage  # 运行测试并生成覆盖率报告
```

### 测试覆盖率

**总体覆盖率**: 67.3% (语句), 61.49% (分支), 65.48% (函数), 69.78% (行)

**核心模块覆盖率**:
- ✅ `executors/` - 100% (友方 Buff, 敌方 Debuff, 盾值工厂)
- ✅ `statusRegistry.ts` - 100% (6 个测试)
- ✅ `mitigationCalculator.v2.ts` - 87.5% (13 个测试)
- ✅ `mitigationActions.new.ts` - 93.1% (11 个测试)
- ✅ `fflogsImporter.ts` - 100% (15 个测试)
- ⚠️ `timelineStore.ts` - 41% (9 个测试,主要测试状态管理功能)

**测试文件**:
- `src/utils/statusRegistry.test.ts` - 状态注册表测试
- `src/executors/executors.test.ts` - 执行器工厂测试
- `src/data/mitigationActions.new.test.ts` - 技能数据测试
- `src/utils/mitigationCalculator.v2.test.ts` - 计算器测试
- `src/store/timelineStore.test.ts` - 状态管理测试
- `src/utils/fflogsImporter.test.ts` - FFLogs 导入测试
- `src/utils/mitigationCalculator.test.ts` - 旧计算器测试 (25 个测试)

**总计**: 84 个测试,全部通过

### 代码风格

```bash
pnpm lint          # 检查代码规范
pnpm lint:fix      # 自动修复
pnpm format        # 格式化代码
```

- 使用 ESLint + Prettier
- 遵循 React 19 最佳实践
- TypeScript strict 模式

## 常用命令

```bash
# 开发
pnpm dev           # 启动开发服务器

# 构建
pnpm build         # 构建生产版本
pnpm preview       # 预览构建结果

# 测试
pnpm test          # 运行测试（watch 模式）
pnpm test:run      # 运行测试（单次）
pnpm test:ui       # 测试 UI

# 代码质量
pnpm lint          # 检查代码
pnpm lint:fix      # 修复问题
pnpm format        # 格式化

# Cloudflare Workers（计划中）
pnpm workers:dev   # 本地开发
pnpm workers:deploy # 部署到生产
```

## 关键文件说明

### 减伤计算引擎
`src/utils/mitigationCalculator.ts`

核心类 `MitigationCalculator` 提供：
- `calculate()` - 计算减伤后的最终伤害
- `getActiveEffects()` - 获取指定时间点生效的减伤效果
- `validateCooldown()` - 验证技能 CD 是否冲突
- `canUseActionAt()` - 检查技能是否可在指定时间使用
- `getNextAvailableTime()` - 获取技能下次可用时间

### 时间轴 Canvas
`src/components/TimelineCanvas.tsx`

主要功能：
- 渲染时间轴、伤害事件、减伤分配
- 处理拖放（技能拖拽到时间轴）
- 处理拖动（调整事件和技能时间）
- 处理平移（拖动空白区域滚动）
- 键盘快捷键（Delete/Backspace 删除）

### 数据存储
`src/utils/timelineStorage.ts`

提供 LocalStorage 封装：
- `saveTimeline()` - 保存时间轴
- `getTimeline()` - 获取时间轴
- `getAllTimelines()` - 获取所有时间轴
- `deleteTimeline()` - 删除时间轴
- `getTimelineSummaries()` - 获取时间轴摘要列表

## 已知问题

### 类型错误
构建时存在一些类型错误（与 skill→action 重命名无关）：
- `Timeline` 类型定义与实际使用不匹配
- 部分组件缺少类型注解
- FFLogs 类型定义不完整

这些问题不影响运行时功能，但需要在后续迭代中修复。

### 待实现功能
- [ ] Stage 9: 导出功能（JSON、图片）
- [ ] Stage 10: TOP100 数据源集成
- [ ] Stage 11: 性能优化
- [ ] Stage 12: 部署到 Cloudflare

## 开发工作流

### 添加新功能
1. 在 `src/types/` 定义类型
2. 在 `src/store/` 添加状态管理
3. 在 `src/utils/` 实现业务逻辑
4. 编写单元测试（`*.test.ts`）
5. 在 `src/components/` 实现 UI
6. 更新相关文档

### 修复 Bug
1. 添加失败的测试用例
2. 修复代码使测试通过
3. 验证不影响其他功能
4. 提交代码

### 性能优化
1. 使用 React DevTools Profiler 定位瓶颈
2. 优化 Konva 渲染（减少 Layer、禁用特效）
3. 使用 `useMemo`/`useCallback` 避免重复计算
4. 验证优化效果

## 调试技巧

### 查看状态
```typescript
// 在组件中
const timeline = useTimelineStore((state) => state.timeline)
console.log('Timeline:', timeline)

// 在浏览器控制台
window.__ZUSTAND_STORES__ // 查看所有 store
```

### 查看 LocalStorage
```javascript
// 浏览器控制台
localStorage.getItem('healerbook_timelines')
```

### Konva 调试
```typescript
// 显示 FPS
stage.on('frame', () => {
  console.log('FPS:', stage.getFrameRate())
})

// 高亮可拖拽对象
draggableNode.on('mouseenter', () => {
  document.body.style.cursor = 'move'
})
```

## 贡献指南

### 提交规范
使用 Conventional Commits 格式：

```
feat: 添加导出为 JSON 功能
fix: 修复技能拖拽时的位置偏移
refactor: 重命名 skill 为 action
docs: 更新 CLAUDE.md
test: 添加减伤计算器测试
chore: 升级依赖版本
```

### 分支策略
- `main` - 主分支，保持稳定
- `feature/*` - 功能分支
- `fix/*` - 修复分支

## 参考资源

### 官方文档
- [React 19](https://react.dev/)
- [TypeScript](https://www.typescriptlang.org/)
- [Vite](https://vitejs.dev/)
- [Zustand](https://docs.pmnd.rs/zustand/)
- [React-Konva](https://konvajs.org/docs/react/)
- [shadcn/ui](https://ui.shadcn.com/)
- [Tailwind CSS](https://tailwindcss.com/)

### FF14 相关
- [FFLogs API](https://www.fflogs.com/api/docs)
- [FF14 灰机 Wiki](https://ff14.huijiwiki.com/)
- [NGA FF14 板块](https://bbs.nga.cn/thread.php?fid=-362960)

### 类似工具
- [Raidbuff](https://raidbuff.com/) - 团队增益时间轴
- [XIV Analysis](https://xivanalysis.com/) - 日志分析工具

---

**最后更新**: 2026-02-18
**项目状态**: 开发中（Stage 1-8 已完成）
**维护者**: [项目维护者]
