# HP 曲线轨道 · Spec

> 日期：2026-04-28
> 分支：`feat/hp-simulate`
> 关联：[hp-simulate spec](./2026-04-28-hp-simulate-design.md) · [hp-simulate status](../2026-04-28-hp-simulate-status.md)

## 1. 目标

在编辑器时间轴的「伤害事件轨道」与「技能轨道」之间，新增一条 **HP 曲线轨道**，把 HP 模拟的累积扣血 / 治疗补回过程可视化为一条折线。

**Non-goals**（本期不做）：

- hover tooltip / 点击定位事件
- 多坦 per-tank HP 池
- 治疗 cast / HoT 详情面板
- 时间游标 / 播放回放
- 多曲线对比（同一时间轴多次运行结果叠加）

## 2. 用户故事

- 在编辑模式下挂减伤后，治疗师能直观看到血量在副本时间轴上的演化曲线，包括伤害陡降与 HoT 阶梯爬升。
- 关闭顶部「HP 模拟」开关时，整条曲线轨道连同空间一起收回，layout shift 与折叠伤害轨道行为一致。

## 3. 现有上下文

- `MitigationCalculator.simulate` 已经维护 `hp.current` 演化，并在每个伤害事件 / 治疗事件后通过 `hpSimulation` snapshot / `recordHeal` push HealSnapshot。本期只是把整条 hp 演化序列也作为输出。
- Timeline 主组件结构：`fixedStage`（时间标尺 + 伤害事件轨道，水平可滚不垂直滚）+ 主 Stage（技能轨道，水平+垂直滚）。HP 曲线归属 fixedStage（与开关、轨道折叠语义一致）。
- `useUIStore.enableHpSimulation` 已存在并控制三视图（PropertyPanel / 卡片 / 表格）警示。HP 曲线复用同一开关。

## 4. 数据流

```
MitigationCalculator.simulate
  ├─ 维护 currentState.hp.current（已有）
  ├─ 每次 hp.current 改变后 push 一个 HpTimelinePoint
  └─ 出口前按 time 升序 sort（与 healSnapshots 一致）
        ↓
SimulateOutput.hpTimeline: HpTimelinePoint[]
        ↓
useDamageCalculation 透传到 DamageCalculationContext
        ↓
HpCurveTrack 组件消费 + Konva 渲染
```

### 4.1 新类型

`src/types/hpTimeline.ts`：

```ts
export type HpTimelineKind = 'init' | 'damage' | 'heal' | 'tick' | 'maxhp-change'

export interface HpTimelinePoint {
  /** 该点对应的时刻（秒） */
  time: number
  /** 该时刻 hp.current（已 clamp 到 [0, hp.max]） */
  hp: number
  /** 该时刻 hp.max（含 maxHP buff 累乘） */
  hpMax: number
  /** 触发该点的事件类型 */
  kind: HpTimelineKind
  /** 关联的源事件 id（damage = damage event id；heal/tick = cast event id；init/maxhp-change = undefined） */
  refEventId?: string
}
```

### 4.2 HealSnapshot 与 HpTimelinePoint 的分工

- `healSnapshots`：治疗事件的元数据（base / final / overheal / 是否 tick）。供未来治疗效率统计、治疗详情面板消费。
- `hpTimeline`：纯 hp 演化序列。HP 曲线轨道唯一数据源。
- 二者各自独立 sort、独立写入；可能在同一 cast 事件下都产出条目（healSnapshots 一条 + hpTimeline 一条）。

### 4.3 push 点

simulate 主循环里在以下位置 push HpTimelinePoint，每次 push 之前 read 当前 `currentState.hp.current` / `currentState.hp.max`：

| 触发位置                                    | kind            | refEventId      |
| ------------------------------------------- | --------------- | --------------- |
| simulate 入口初始化 hp 池后                 | `init`          | —               |
| `applyDamageToHp` 之后（aoe / partial 段）  | `damage`        | damage event id |
| `recordHeal` callback 内（cast / HoT tick） | `heal` / `tick` | cast event id   |
| `recomputeHpMax` 之后且 hp.max 变化时       | `maxhp-change`  | —               |

`recordHeal` 区分 cast vs tick 用 `HealSnapshot.isHotTick` 字段。

### 4.4 视图回退路径

- `enableHpSimulation === false` → `HpCurveTrack` 不挂载（hpTrackHeight = 0）
- `hpTimeline.length < 2` → `HpCurveTrack` 不挂载（hp 池未初始化、回放模式、坦专专属时间轴）
- 上述两种情况与"折叠伤害轨道"行为一致：layout 收回，技能轨道上移

## 5. 渲染

### 5.1 新组件 `src/components/Timeline/HpCurveTrack.tsx`

接口：

```ts
interface HpCurveTrackProps {
  hpTimeline: HpTimelinePoint[]
  zoomLevel: number
  yOffset: number
  width: number // timelineWidth
  height: number // HP_CURVE_HEIGHT
  viewportWidth: number
  scrollLeft: number
}
```

实现：

- 视口裁剪：仅取 `time * zoomLevel` 落在 `[scrollLeft - buffer, scrollLeft + viewportWidth + buffer]` 的点（与 `DamageEventTrack` 一致，buffer = viewportWidth）
- 折线：Konva `<Line points={[x1,y1, x2,y2, ...]} stroke="#16a34a" strokeWidth={2} listening={false} perfectDrawEnabled={false} />`
- 面积填充：用 closed `<Line>` 或 `<Path>`，同色 12% 透明度
- maxHP 基线：水平虚线，stroke `#cbd5e1`，dash `[4, 3]`，listening false
- Y 轴映射：`y = yOffset + height - (hp / hpMax) * (height - 4)`（顶留 2px 边距）
- 坐标空间：曲线绘制在 Layer 内，layer 已经处理 `x={-scrollLeft}`，所以传 `time * zoomLevel` 即可

### 5.2 左侧标签栏

`Timeline/index.tsx` 在伤害轨道标签下方新增 "HP" 标签行，高度同 `HP_CURVE_HEIGHT`。文本 "HP"，subtle 灰色（`text-muted-foreground text-xs`）。

### 5.3 layout 集成

`Timeline/index.tsx` 改动：

- 新增常量 `HP_CURVE_HEIGHT = 60`（CSS `px`）
- `useUIStore(s => s.enableHpSimulation)` 加入 hook 列表
- `useDamageCalculation` 当前已返回 `results / statusTimelineByPlayer / castEffectiveEndByCastEventId / healSnapshots / simulate`，本期再加 `hpTimeline: HpTimelinePoint[]`，与其他字段平级解构（不通过 context 传播——HpCurveTrack 由 Timeline 直接当 prop 传入，避免再搞一个 context provider）
- `layoutData` useMemo 计算 hpTrackHeight：
  ```ts
  const hasHpData = hpTimeline.length >= 2
  const hpTrackHeight = enableHpSimulation && hasHpData ? HP_CURVE_HEIGHT : 0
  const fixedAreaHeight = timeRulerHeight + eventTrackHeight + hpTrackHeight
  ```
- `useMemo` 依赖列表追加 `enableHpSimulation, hpTimeline.length`（不放整条 hpTimeline 数组，length 变化已经够触发 layout 重算；曲线绘制本身不走 layoutData 路径）
- `<DamageEventTrack>` 后插入 `<HpCurveTrack>`：
  ```tsx
  {
    hpTrackHeight > 0 && (
      <HpCurveTrack
        hpTimeline={hpTimeline}
        zoomLevel={zoomLevel}
        yOffset={timeRulerHeight + eventTrackHeight}
        width={timelineWidth}
        height={HP_CURVE_HEIGHT}
        viewportWidth={viewportWidth}
        scrollLeft={clampedScrollLeft}
      />
    )
  }
  ```
- 左侧固定列同步在 `eventTrackHeight` 块下新增 "HP" 标签行（条件 `hpTrackHeight > 0`）

### 5.4 样式

| 元素           | 视觉                                                        |
| -------------- | ----------------------------------------------------------- |
| 折线           | 绿色 `#16a34a`，宽 2px                                      |
| 面积填充       | `rgba(34, 197, 94, 0.12)`                                   |
| maxHP 基线     | 灰色 `#cbd5e1`，1px 虚线 `[4, 3]`                           |
| 致死区（HP=0） | 不特殊渲染（曲线自然贴底，本期不画红线）                    |
| 标签栏文本     | `text-muted-foreground text-xs`，"HP"                       |
| 暗色主题       | 折线 `#22c55e`，基线 `#475569`，与 `useCanvasColors` 同色板 |

具体颜色读取：用现有 `useCanvasColors()` 拿 `gridLine` / `textSecondary` 等，新增 `hpCurveStroke` / `hpCurveFill` 字段；在 `Timeline/constants.ts` 内 dark/light 各定义一份。

## 6. 测试

### 6.1 calculator 单测

`mitigationCalculator.test.ts` 新增 describe block "HP 池 · hpTimeline"：

- **基础**：空时间轴 → hpTimeline 仅一条 init point
- **伤害**：单 aoe 事件 → init + damage 两条，time 升序、kind 正确
- **治疗**：cast heal 事件 → init + heal point；hp 变高
- **HoT tick**：挂 HoT regen status → 多条 tick point，间隔 3s
- **maxHP buff**：挂 maxHP +20% buff 后 → 至少一条 maxhp-change point，hp.max 反映新上限
- **混合**：伤害 + HoT 混合 → 序列按 time 升序、所有 kind 都有
- **回放模式**：isReplayMode 时 hpTimeline 为空
- **未配 hp 池**：baseReferenceMaxHPForAoe = 0 时 hpTimeline 为空

### 6.2 React 组件

`HpCurveTrack` 不加单测（与 `DamageEventCard` 一致 — Konva 视觉组件难单测）。

### 6.3 手动浏览器验证

| 场景                                          | 期望                                   |
| --------------------------------------------- | -------------------------------------- |
| 编辑模式 + 配 statData + 加 aoe 事件 + 挂减伤 | HP 曲线显示伤害陡降                    |
| 加 cast heal / HoT regen action               | 曲线在治疗时刻爬升                     |
| 切换 HP 模拟开关 off                          | 整条 HP 曲线轨道收回，技能轨道上移     |
| 切回 on                                       | 轨道复现、layout 恢复                  |
| 切换主题                                      | 折线颜色跟随                           |
| 水平拖动时间轴                                | 曲线视口裁剪正确（仅可见区域绘制）     |
| 垂直滚动技能轨道                              | HP 曲线轨道纹丝不动（fixedStage 行为） |
| 切折叠伤害轨道                                | HP 曲线相对位置正确（在伤害轨道下方）  |
| 回放模式                                      | 整条 HP 曲线轨道不显示                 |

## 7. 性能

- `hpTimeline` 大小：典型 5 分钟时间轴 ~30 个伤害事件 + 50 个治疗事件 + 100 个 HoT tick ≈ 200 点。视口裁剪后实际绘制 < 50 点。Konva `<Line>` 单条 polyline 性能无虞。
- useDamageCalculation 已经 memo 化，新增 hpTimeline 字段不影响重算频率。
- 不引入 batchDraw / 命令式操作；走 react-konva 标准渲染路径。

## 8. 兼容性 / 迁移

- 无破坏性接口变更：`SimulateOutput` 增字段、`DamageCalculationResult` 增字段、`useDamageCalculation` 返回增字段——都是新增。
- 无 store schema 变更（不动 `useUIStore` / `useTimelineStore` 持久层）。
- 无数据迁移（hpTimeline 在每次 simulate 时从零构造）。

## 9. 实现顺序（writing-plans 起点）

1. 类型层：`src/types/hpTimeline.ts`
2. calculator：simulate 内 push 点 + 出口 sort + 类型导出
3. 输出管道：`SimulateOutput.hpTimeline` + `DamageCalculationResult.hpTimeline` + `useDamageCalculation` 透传
4. 主题色：`Timeline/constants.ts` 加 `hpCurveStroke` / `hpCurveFill`
5. 组件：`HpCurveTrack.tsx`
6. layout 集成：`Timeline/index.tsx` 三块（hook + layoutData + JSX + 标签栏）
7. 单测：`mitigationCalculator.test.ts` 新增 describe
8. 手动浏览器验证：表格中所有场景

每步骤独立可验证（`pnpm exec tsc --noEmit` + `pnpm test:run` 关联模块），最后跑全量。
