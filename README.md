# Healerbook 项目实施计划

## 项目概述

Healerbook 是一个基于 FFLogs 的 FF14 治疗职业减伤规划工具，帮助玩家可视化地规划副本中的减伤技能使用时间轴。

### 核心价值
- 可视化减伤技能时间轴规划
- 实时计算减伤效果后的伤害
- 支持多阶段副本的时间基准管理
- 集成 FFLogs TOP100 数据作为参考

---

## 技术栈

### 前端
- **框架**: React 18 + TypeScript + Vite
- **UI 组件**: shadcn/ui + Tailwind CSS
- **状态管理**: Zustand
- **时间轴可视化**: React-Konva (Canvas)
- **数据获取**: TanStack Query (React Query)
- **路由**: React Router v6

### 后端 (Cloudflare)
- **Serverless**: Cloudflare Workers
- **静态托管**: Cloudflare Pages
- **对象存储**: Cloudflare R2
- **键值缓存**: Cloudflare KV
- **数据库**: Cloudflare D1 (可选)
- **定时任务**: Cron Triggers

### 开发工具
- **包管理**: pnpm
- **代码规范**: ESLint + Prettier
- **测试**: Vitest + Testing Library
- **部署**: Wrangler CLI

---

## 核心概念

### 减伤机制
- **目标百分比减伤**: 降低 boss 造成的伤害百分比
- **非目标百分比减伤**: 降低玩家受到的伤害百分比
- **盾值减伤**: 临时生命值抵消伤害

### 减伤计算公式
```
最终伤害 = 原始伤害 × (1-减伤1%) × (1-减伤2%) × ... - 盾值
```

### 阶段 (Phase)
- 超长副本分为多个连续阶段
- 每个阶段基于标志性技能定义时间基准
- 技能时间基于阶段基准进行偏移计算

---

## 项目结构

```
healerbook/
├── src/                          # 前端代码
│   ├── api/                      # API 客户端
│   │   ├── fflogsClient.ts      # FFLogs GraphQL 客户端
│   │   ├── mitigationData.ts    # 减伤技能数据加载
│   │   └── top100.ts            # TOP100 数据获取
│   ├── components/               # 可复用组件
│   │   ├── ui/                  # shadcn/ui 组件
│   │   └── timeline/            # 时间轴相关组件
│   │       ├── TimelineCanvas.tsx
│   │       ├── DamageEventTrack.tsx
│   │       └── SkillBlock.tsx
│   ├── features/                 # 功能模块
│   │   ├── home/                # 首页
│   │   │   ├── HomePage.tsx
│   │   │   └── RecentTimelines.tsx
│   │   └── editor/              # 时间轴编辑器
│   │       ├── TimelineEditor.tsx
│   │       └── SkillPalette.tsx
│   ├── stores/                   # Zustand 状态管理
│   │   ├── timelineStore.ts     # 时间轴状态
│   │   ├── editorUIStore.ts     # 编辑器 UI 状态
│   │   └── settingsStore.ts     # 用户设置
│   ├── types/                    # TypeScript 类型定义
│   │   ├── mitigation.ts        # 减伤技能类型
│   │   ├── timeline.ts          # 时间轴类型
│   │   └── fflogs.ts            # FFLogs 数据类型
│   ├── utils/                    # 工具函数
│   │   ├── mitigationCalculator.ts  # 减伤计算引擎
│   │   ├── fflogsParser.ts      # FFLogs 数据解析
│   │   └── timeUtils.ts         # 时间处理工具
│   ├── data/                     # 静态数据
│   │   ├── mitigationSkills.json    # 减伤技能元数据
│   │   └── encounters.json      # 副本配置
│   └── App.tsx
├── workers/                      # Cloudflare Workers
│   ├── api/
│   │   ├── top100.ts            # TOP100 API 路由
│   │   └── config.ts            # 配置管理 API
│   ├── scheduled/
│   │   └── updateTop100.ts      # 定时任务
│   ├── config/
│   │   └── loader.ts            # 配置加载器
│   └── index.ts                 # Workers 入口
├── config/                       # 配置文件
│   ├── default.ts               # 默认配置
│   └── types.ts                 # 配置类型定义
├── wrangler.toml                # Cloudflare 配置
├── package.json
├── vite.config.ts
├── tailwind.config.js
└── tsconfig.json
```


## 实施阶段

### 阶段 0: 项目初始化 (1-2 天)

**目标**: 搭建开发环境和项目骨架

#### 步骤
1. 初始化项目
   ```bash
   pnpm create vite healerbook --template react-ts
   cd healerbook
   pnpm install
   ```

2. 配置 Tailwind CSS + shadcn/ui
   ```bash
   pnpm add -D tailwindcss postcss autoprefixer
   pnpm dlx tailwindcss init -p
   pnpm dlx shadcn-ui@latest init
   ```

3. 安装核心依赖
   ```bash
   # 状态管理
   pnpm add zustand

   # 路由
   pnpm add react-router-dom

   # 数据获取
   pnpm add @tanstack/react-query

   # Canvas 渲染
   pnpm add react-konva konva

   # GraphQL 客户端
   pnpm add graphql-request graphql

   # 工具库
   pnpm add date-fns clsx
   ```

4. 配置 Cloudflare Workers
   ```bash
   pnpm add -D wrangler
   pnpm wrangler init
   ```

5. 配置 ESLint + Prettier
   ```bash
   pnpm add -D eslint prettier eslint-config-prettier
   ```

6. 创建基础目录结构
   ```bash
   mkdir -p src/{api,components/ui,features/{home,editor},stores,types,utils,data}
   mkdir -p workers/{api,scheduled,config}
   mkdir -p config
   ```

#### 交付物
- ✅ 可运行的 Vite 开发环境
- ✅ Tailwind CSS + shadcn/ui 配置完成
- ✅ Wrangler 配置完成
- ✅ 基础目录结构创建

---

### 阶段 1: 类型定义与配置系统 (2-3 天)

**目标**: 定义核心数据结构和配置系统

#### 1.1 类型定义

**src/types/mitigation.ts**
```typescript
export type MitigationType = 'target_percentage' | 'non_target_percentage' | 'shield'

export interface MitigationSkill {
  id: string
  name: string
  nameEn: string
  icon: string
  job: Job
  type: MitigationType
  value: number  // 百分比或盾值
  duration: number  // 持续时间（秒）
  cooldown: number  // 冷却时间（秒）
  charges?: number  // 充能次数
  description: string
}

export type Job = 
  | 'WHM' | 'SCH' | 'AST' | 'SGE'  // 治疗
  | 'PLD' | 'WAR' | 'DRK' | 'GNB'  // 坦克
  | 'DRG' | 'MNK' | 'NIN' | 'SAM' | 'RPR' | 'VPR'  // 近战
  | 'BRD' | 'MCH' | 'DNC'  // 远程物理
  | 'BLM' | 'SMN' | 'RDM' | 'PCT'  // 远程魔法
```

**src/types/timeline.ts**
```typescript
export interface Timeline {
  id: string
  name: string
  encounter: Encounter
  composition: Composition
  phases: Phase[]
  mitigationPlan: MitigationPlan
  createdAt: string
  updatedAt: string
}

export interface Encounter {
  id: number
  name: string
  displayName: string
  zone: string
  difficulty: 'savage' | 'ultimate' | 'extreme'
  damageEvents: DamageEvent[]
}

export interface DamageEvent {
  id: string
  name: string
  time: number  // 相对于阶段开始的时间（秒）
  damage: number  // 原始伤害
  type: 'aoe' | 'tankbuster' | 'raidwide'
  phaseId: string
}

export interface Phase {
  id: string
  name: string
  startTime: number  // 绝对时间或相对时间
  baselineSkill?: string  // 标志性技能作为时间基准
}

export interface Composition {
  tanks: Job[]
  healers: Job[]
  dps: Job[]
}

export interface MitigationPlan {
  assignments: MitigationAssignment[]
}

export interface MitigationAssignment {
  id: string
  skillId: string
  damageEventId: string
  time: number  // 使用时间
  job: Job
}
```

#### 1.2 配置系统

**config/types.ts** - 参考前面的配置系统设计

**config/default.ts** - 参考前面的配置系统设计

**workers/config/loader.ts** - 参考前面的配置系统设计

#### 1.3 wrangler.toml

参考前面的 wrangler.toml 配置

#### 交付物
- ✅ 完整的 TypeScript 类型定义
- ✅ 配置系统实现
- ✅ wrangler.toml 配置完成

---

### 阶段 2: 减伤技能数据库 (2-3 天)

**目标**: 创建减伤技能元数据库

#### 2.1 数据收集

通过以下渠道收集 FF14 减伤技能数据：
1. FF14 官方技能数据库
2. FFLogs 技能 ID 映射
3. 社区资源（NGA、灰机 Wiki）

#### 2.2 数据结构

**src/data/mitigationSkills.json**
```json
{
  "version": "7.1",
  "skills": [
    {
      "id": "7535",
      "name": "神圣领域",
      "nameEn": "Divine Veil",
      "icon": "/icons/007000/007535.png",
      "job": "PLD",
      "type": "shield",
      "value": 400,
      "duration": 30,
      "cooldown": 90,
      "description": "为自身和周围队员施加盾"
    }
  ]
}
```

#### 2.3 数据加载

**src/api/mitigationData.ts**
```typescript
import skillsData from '@/data/mitigationSkills.json'
import type { MitigationSkill } from '@/types/mitigation'

export function getAllMitigationSkills(): MitigationSkill[] {
  return skillsData.skills
}

export function getSkillsByJob(job: Job): MitigationSkill[] {
  return skillsData.skills.filter(skill => skill.job === job)
}

export function getSkillById(id: string): MitigationSkill | undefined {
  return skillsData.skills.find(skill => skill.id === id)
}
```

#### 交付物
- ✅ 减伤技能 JSON 数据文件（至少包含主流职业）
- ✅ 数据加载和查询 API
- ✅ 单元测试

---

### 阶段 3: FFLogs API 客户端 (2-3 天)

**目标**: 实现 FFLogs GraphQL API 集成

#### 3.1 API 客户端

**src/api/fflogsClient.ts**
```typescript
import { GraphQLClient } from 'graphql-request'

const FFLOGS_API_URL = 'https://www.fflogs.com/api/v2/client'

export class FFLogsClient {
  private client: GraphQLClient

  constructor(apiToken: string) {
    this.client = new GraphQLClient(FFLOGS_API_URL, {
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
    })
  }

  async getReport(reportCode: string) {
    const query = `
      query {
        reportData {
          report(code: "${reportCode}") {
            code
            title
            startTime
            endTime
            fights {
              id
              name
              difficulty
              kill
              startTime
              endTime
            }
          }
        }
      }
    `
    return this.client.request(query)
  }

  async getDamageEvents(reportCode: string, fightId: number) {
    const query = `
      query {
        reportData {
          report(code: "${reportCode}") {
            events(
              fightIDs: [${fightId}]
              dataType: DamageTaken
            ) {
              data
            }
          }
        }
      }
    `
    return this.client.request(query)
  }
}
```

#### 3.2 数据转换

**src/utils/fflogsParser.ts**
```typescript
export function parseDamageEvents(rawEvents: any[]): DamageEvent[] {
  // 解析 FFLogs 原始事件数据
  // 识别 AOE 技能
  // 计算伤害统计
}

export function parseComposition(report: any): Composition {
  // 解析小队阵容
}
```

#### 交付物
- ✅ FFLogs GraphQL 客户端
- ✅ 数据解析工具
- ✅ 错误处理和重试逻辑


---

### 阶段 4: 减伤计算引擎 (2-3 天)

**目标**: 实现核心减伤计算逻辑

#### 核心功能
- 减伤效果计算（百分比乘算 + 盾值减算）
- CD 冲突检测
- 实时伤害计算

#### 交付物
- ✅ 减伤计算引擎实现
- ✅ CD 验证逻辑
- ✅ 单元测试覆盖率 > 80%

---

### 阶段 5: 状态管理 (1-2 天)

**目标**: 使用 Zustand 实现状态管理

#### Store 划分
- **timelineStore**: 时间轴数据、减伤分配
- **editorUIStore**: 缩放、选中状态、拖拽状态
- **settingsStore**: 用户设置（持久化到 LocalStorage）

#### 交付物
- ✅ 三个 Zustand store 实现
- ✅ LocalStorage 持久化配置

---

### 阶段 6: 首页功能 (2-3 天)

**目标**: 实现首页的所有入口功能

#### 功能列表
1. **新建时间轴**: 选择副本 → 选择阵容 → 进入编辑器
2. **最近打开**: 从 LocalStorage 读取最近编辑的时间轴列表
3. **从文件打开**: 上传 JSON 文件
4. **从 FFLogs 导入**: 粘贴日志链接，解析数据
5. **TOP100**: 选择副本，加载预置数据

#### UI 组件
- 使用 shadcn/ui: Card, Button, Dialog, Select, Input

#### 交付物
- ✅ 首页 UI 实现
- ✅ 所有入口功能可用
- ✅ 文件导入/导出逻辑

---

### 阶段 7: 时间轴编辑器 - 基础渲染 (4-5 天)

**目标**: 实现时间轴的可视化渲染

#### 7.1 Canvas 架构

使用 React-Konva 实现：
- **时间轴层**: 时间刻度、网格线
- **伤害事件层**: AOE 技能标记
- **减伤技能层**: 技能块、持续时间、CD 指示
- **交互层**: 鼠标悬停、选中高亮

#### 7.2 核心组件

```
TimelineCanvas
├── TimelineGrid (时间刻度)
├── DamageEventTrack (伤害事件轨道)
├── MitigationSkillTrack (减伤技能轨道)
│   ├── SkillBlock (技能块)
│   └── CooldownIndicator (CD 指示器)
└── Tooltip (悬停提示)
```

#### 7.3 视图控制
- 缩放：滚轮缩放时间轴
- 平移：拖拽画布移动视图
- 时间范围：显示 0-600 秒（可配置）

#### 交付物
- ✅ 时间轴 Canvas 渲染
- ✅ 缩放和平移功能
- ✅ 性能优化（虚拟化渲染）

---

### 阶段 8: 时间轴编辑器 - 交互功能 (4-5 天)

**目标**: 实现拖拽、添加、删除技能

#### 8.1 拖拽功能
- 从技能列表拖拽到时间轴
- 在时间轴上拖动调整时间
- 拖拽时显示吸附线（对齐到伤害事件）

#### 8.2 右键菜单
- 删除技能
- 复制技能
- 查看详情

#### 8.3 实时计算
- 每次修改后重新计算伤害
- 显示最终伤害和减伤百分比
- 高亮 CD 冲突

#### 交付物
- ✅ 拖拽交互实现
- ✅ 右键菜单
- ✅ 实时伤害计算和显示

---

### 阶段 9: 导出功能 (1-2 天)

**目标**: 导出时间轴为 JSON 和 TXT

#### 9.1 JSON 导出
```json
{
  "version": "1.0",
  "timeline": { /* 完整时间轴数据 */ }
}
```

#### 9.2 TXT 导出
```
P12S 减伤时间轴

00:15 - 技能名1
  - 减伤1 (职业)
  - 减伤2 (职业)

00:45 - 技能名2
  - 减伤3 (职业)
```

#### 交付物
- ✅ JSON 导出功能
- ✅ TXT 导出功能
- ✅ 下载文件实现

---

### 阶段 10: TOP100 数据源 (3-4 天)

**目标**: 实现 Cloudflare Workers 定时任务

#### 10.1 后端实现
- Scheduled Worker: 定时抓取 FFLogs TOP100
- API 路由: 提供 TOP100 数据查询
- 存储: R2 + KV 双层缓存

#### 10.2 配置系统
- 可配置的 FFLogs API Key
- 可配置的抓取数量
- 可配置的 Cron 表达式

#### 10.3 前端集成
- TOP100 选择器 UI
- 数据加载和缓存
- 与时间轴编辑器集成

#### 交付物
- ✅ Cloudflare Workers 定时任务
- ✅ 配置系统实现
- ✅ 前端 TOP100 功能

---

### 阶段 11: 优化与完善 (2-3 天)

**目标**: 性能优化、错误处理、用户体验

#### 11.1 性能优化
- Canvas 虚拟化渲染
- 防抖和节流
- 懒加载和代码分割

#### 11.2 错误处理
- FFLogs API 错误处理
- 文件解析错误提示
- 网络错误重试

#### 11.3 用户体验
- 加载状态
- 空状态提示
- 快捷键支持

#### 交付物
- ✅ 性能优化完成
- ✅ 错误处理完善
- ✅ UX 改进

---

### 阶段 12: 测试与部署 (2-3 天)

**目标**: 测试和生产部署

#### 12.1 测试
- 单元测试
- 集成测试
- E2E 测试（关键流程）

#### 12.2 部署
```bash
# 部署 Workers
wrangler deploy --env production

# 部署 Pages (连接 GitHub)
# 在 Cloudflare Dashboard 配置自动部署
```

#### 12.3 监控
- Cloudflare Analytics
- 错误日志收集
- 性能监控

#### 交付物
- ✅ 测试覆盖率 > 70%
- ✅ 生产环境部署
- ✅ 监控配置完成


---

## 风险评估

### 高风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| FFLogs API 限流 | 无法获取数据 | 1. 添加请求间隔<br>2. 实现指数退避重试<br>3. 缓存数据减少请求 |
| 减伤技能数据准确性 | 计算结果错误 | 1. 多渠道验证数据<br>2. 提供用户反馈机制<br>3. 版本化数据，支持更新 |

### 中风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 时间轴性能问题 | 大量技能时卡顿 | 1. Canvas 虚拟化渲染<br>2. 防抖和节流<br>3. Web Worker 计算 |
| Cloudflare Workers 超时 | 定时任务失败 | 1. 分批执行<br>2. 增加超时时间<br>3. 失败重试机制 |
| 阶段时间基准计算复杂 | 实现困难 | 1. 简化 MVP 版本<br>2. 参考现有工具<br>3. 用户手动调整 |

### 低风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 浏览器兼容性 | 部分用户无法使用 | 1. 目标现代浏览器<br>2. 提供兼容性提示 |
| 数据存储空间不足 | TOP100 数据无法存储 | 1. 监控使用量<br>2. 定期清理旧数据 |

---

## 复杂度评估

### 整体复杂度: 中高

| 模块 | 复杂度 | 工作量（天） |
|------|--------|--------------|
| 项目初始化 | 低 | 1-2 |
| 类型定义与配置 | 中 | 2-3 |
| 减伤技能数据库 | 中 | 2-3 |
| FFLogs API 客户端 | 中 | 2-3 |
| 减伤计算引擎 | 中 | 2-3 |
| 状态管理 | 低 | 1-2 |
| 首页功能 | 中 | 2-3 |
| 时间轴编辑器 - 渲染 | 高 | 4-5 |
| 时间轴编辑器 - 交互 | 高 | 4-5 |
| 导出功能 | 低 | 1-2 |
| TOP100 数据源 | 中 | 3-4 |
| 优化与完善 | 中 | 2-3 |
| 测试与部署 | 中 | 2-3 |
| **总计** | - | **26-33 天** |

---

## 关键技术决策

### 1. 为什么选择 Cloudflare 而非 Vercel？

**优势：**
- 成本更低（免费额度更大）
- 性能更好（冷启动 < 5ms）
- 全球 CDN 更快
- R2 存储适合大文件

**劣势：**
- 生态相对较小
- 学习曲线稍陡

### 2. 为什么选择 Canvas 而非 SVG？

**优势：**
- 大量元素时性能更好
- 适合频繁重绘（拖拽）
- React-Konva 提供 React 友好 API

**劣势：**
- 无障碍性需要额外处理
- 不支持 CSS 样式

### 3. 为什么选择 Zustand 而非 Redux？

**优势：**
- API 更简洁
- 无需 Provider
- 性能更好
- 学习成本低

**劣势：**
- 生态相对较小
- DevTools 功能较少

---

## 成本估算

### 开发成本
- 开发时间: 26-33 天
- 开发人员: 1 人
- 总成本: 约 1 个月

### 运营成本（月）

| 项目 | Cloudflare 免费版 | Cloudflare 付费版 |
|------|-------------------|-------------------|
| Workers 请求 | 100,000 次/天 | 无限 |
| KV 读取 | 100,000 次/天 | 无限 |
| R2 存储 | 10 GB | 无限 |
| 带宽 | 无限 | 无限 |
| **月费用** | **$0** | **$5-20** |

**预计流量：**
- 日活用户: 100-500
- 每用户请求: 10-20 次
- 总请求: 1,000-10,000 次/天
- **结论**: 免费版足够

---

## 里程碑

### MVP (最小可行产品) - 20 天
- ✅ 阶段 0-5: 基础设施和数据层
- ✅ 阶段 6: 首页功能
- ✅ 阶段 7-8: 时间轴编辑器
- ✅ 阶段 9: 导出功能

**功能范围：**
- 新建时间轴
- 手动添加减伤技能
- 实时计算伤害
- 导出 JSON/TXT

### V1.0 (完整版本) - 33 天
- ✅ MVP 所有功能
- ✅ 阶段 10: TOP100 数据源
- ✅ 阶段 11: 优化与完善
- ✅ 阶段 12: 测试与部署

**新增功能：**
- 从 FFLogs 导入
- TOP100 数据参考
- 性能优化
- 完整测试

### V1.1 (迭代优化) - +5 天
- 用户反馈收集
- Bug 修复
- 性能优化
- 新职业/副本支持

---

## 开发规范

### 文件命名规范

**组件文件（包含 JSX）**
- 使用 **PascalCase** + `.tsx` 扩展名
- 示例：`TimelineCanvas.tsx`, `SkillBlock.tsx`, `HomePage.tsx`

**工具函数/类文件（纯 TypeScript）**
- 使用 **camelCase** + `.ts` 扩展名
- 示例：`mitigationCalculator.ts`, `fflogsClient.ts`, `timeUtils.ts`

**Hooks 文件**
- 使用 **camelCase** + `use` 前缀 + `.ts` 扩展名
- 示例：`useTimeline.ts`, `useEditorUI.ts`

**Store 文件**
- 使用 **camelCase** + `Store` 后缀 + `.ts` 扩展名
- 示例：`timelineStore.ts`, `editorUIStore.ts`

**类型定义文件**
- 使用 **camelCase** + `.ts` 扩展名
- 示例：`mitigation.ts`, `timeline.ts`, `fflogs.ts`

**测试文件**
- 与源文件同名 + `.test.ts` 或 `.test.tsx`
- 示例：`mitigationCalculator.test.ts`, `TimelineCanvas.test.tsx`

**样式文件**
- 与组件同名 + `.module.css`
- 示例：`TimelineCanvas.module.css`

**JSON 数据文件**
- 使用 **camelCase** + `.json` 扩展名
- 示例：`mitigationSkills.json`, `encounters.json`

### 代码规范
- 使用 TypeScript 严格模式
- 遵循 ESLint 规则
- 使用 Prettier 格式化
- 提交前运行 lint 和 test

### Git 工作流
```bash
# 功能分支
git checkout -b feature/timeline-editor

# 提交
git commit -m "feat: 实现时间轴拖拽功能"

# 合并到主分支
git checkout main
git merge feature/timeline-editor
```

### 提交信息规范
- `feat`: 新功能
- `fix`: Bug 修复
- `refactor`: 重构
- `docs`: 文档更新
- `test`: 测试相关
- `chore`: 构建/工具相关

---

## 下一步行动

### 立即开始
1. ✅ 确认技术栈和架构
2. ✅ 创建实施计划文档
3. ⏳ 初始化项目（阶段 0）

### 待确认
- [ ] FFLogs API Token 获取
- [ ] Cloudflare 账号注册
- [ ] 域名准备（可选）

### 待决策
- [ ] 是否需要用户认证系统？
- [ ] 是否需要云端保存时间轴？
- [ ] 是否需要分享功能？

---

## 参考资源

### 官方文档
- [FFLogs API](https://www.fflogs.com/api/docs)
- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [React-Konva](https://konvajs.org/docs/react/)
- [Zustand](https://docs.pmnd.rs/zustand/)
- [shadcn/ui](https://ui.shadcn.com/)

### 社区资源
- [FF14 灰机 Wiki](https://ff14.huijiwiki.com/)
- [NGA FF14 板块](https://bbs.nga.cn/thread.php?fid=-362960)
- [FFLogs Discord](https://discord.gg/fflogs)

### 类似工具
- [Raidbuff](https://raidbuff.com/) - 团队增益时间轴
- [XIV Analysis](https://xivanalysis.com/) - 日志分析工具

---

## 联系方式

如有问题或建议，请通过以下方式联系：
- GitHub Issues: [项目地址]
- Discord: [服务器邀请]
- Email: [联系邮箱]

---

**最后更新**: 2026-02-18
**版本**: 1.0
**状态**: 计划阶段

