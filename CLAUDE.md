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
│   └── mitigationData.ts  # 减伤技能数据加载
├── components/            # React 组件
│   ├── ui/               # shadcn/ui 基础组件
│   ├── TimelineCanvas.tsx    # 时间轴 Canvas 主组件
│   ├── SkillPanel.tsx        # 技能面板（导出 ActionPanel）
│   ├── PropertyPanel.tsx     # 属性面板
│   ├── EditorToolbar.tsx     # 编辑器工具栏
│   └── AddEventDialog.tsx    # 添加事件对话框
├── pages/                 # 页面组件
│   ├── HomePage.tsx      # 首页（时间轴列表）
│   └── EditorPage.tsx    # 编辑器页面
├── store/                 # Zustand 状态管理
│   ├── timelineStore.ts  # 时间轴状态
│   ├── mitigationStore.ts # 减伤技能状态
│   └── uiStore.ts        # UI 状态
├── types/                 # TypeScript 类型定义
│   ├── timeline.ts       # 时间轴相关类型
│   ├── mitigation.ts     # 减伤技能类型
│   └── fflogs.ts         # FFLogs API 类型
├── utils/                 # 工具函数
│   ├── mitigationCalculator.ts      # 减伤计算引擎
│   ├── mitigationCalculator.test.ts # 计算器测试
│   ├── timelineStorage.ts           # 本地存储
│   ├── fflogsParser.ts              # FFLogs URL 解析
│   ├── fflogsImporter.ts            # FFLogs 数据导入
│   └── fflogsImporter.test.ts       # 导入工具测试
├── data/                  # 静态数据
│   └── mitigationActions.json # 减伤技能数据
├── lib/                   # 第三方库配置
│   └── utils.ts          # shadcn/ui 工具函数
├── App.tsx               # 应用根组件
└── main.tsx              # 应用入口
```

## 核心概念

### 1. 减伤机制

FF14 中有三种减伤类型：

```typescript
type MitigationType =
  | 'target_percentage'      // 目标百分比减伤（降低 boss 造成的伤害）
  | 'non_target_percentage'  // 非目标百分比减伤（降低玩家受到的伤害）
  | 'shield'                 // 盾值减伤（临时生命值）
```

### 2. 减伤计算公式

```
最终伤害 = 原始伤害 × (1-减伤1%) × (1-减伤2%) × ... - 盾值
```

- 百分比减伤采用**乘算**
- 盾值减伤采用**减算**
- 盾值在百分比减伤之后应用

示例：
```
原始伤害: 10000
减伤1: 10% (非目标)
减伤2: 5% (非目标)
盾值: 1000

计算过程:
10000 × (1-0.1) × (1-0.05) - 1000 = 8550 - 1000 = 7550
```

### 3. 数据模型

#### Timeline（时间轴）
```typescript
interface Timeline {
  id: string
  name: string
  encounter: Encounter           // 副本信息
  composition: Composition       // 小队阵容
  phases: Phase[]                // 阶段列表
  mitigationPlan: MitigationPlan // 减伤规划
  createdAt: string
  updatedAt: string
}
```

#### DamageEvent（伤害事件）
```typescript
interface DamageEvent {
  id: string
  name: string        // 技能名称
  time: number        // 时间（秒）
  damage: number      // 原始伤害
  type: 'aoe' | 'tankbuster' | 'raidwide'
  phaseId: string
}
```

#### MitigationAction（减伤技能）
```typescript
interface MitigationAction {
  id: string
  name: string        // 中文名
  nameEn: string      // 英文名
  icon: string        // 图标 URL
  job: Job            // 职业
  type: MitigationType
  value: number       // 减伤值（百分比或盾值）
  duration: number    // 持续时间（秒）
  cooldown: number    // 冷却时间（秒）
  description: string
  isPartyWide: boolean // 是否为团队减伤
}
```

#### MitigationAssignment（减伤分配）
```typescript
interface MitigationAssignment {
  id: string
  actionId: string         // 技能 ID
  damageEventId: string    // 对应的伤害事件 ID
  time: number             // 使用时间（秒）
  job: Job                 // 使用者职业
}
```

### 4. 时间轴布局

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
```

当前测试覆盖：
- ✅ `mitigationCalculator.ts` - 17 个测试用例
- 🔄 其他模块待补充

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
