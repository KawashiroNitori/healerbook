# 时间轴画布「按键组 + 放置约束」架构设计

- **日期**: 2026-04-22
- **作者**: nitori
- **状态**: Draft

## 背景

当前时间轴画布存在两处硬编码的特殊处理，源于两组变身/合并技能的渲染需求：

1. **意气轩昂之策 (37013) ↔ 降临之章 (37016)**：炽天附体 (37014) buff 生效期间，玩家在游戏内施放的是降临之章 (独立 ability id)。FFLogs 数据记录的也是 37016。现状通过两处 trick 维持"castEvent.actionId 永远是 37013"的单一身份：
   - `src/utils/fflogsImporter.ts:534` 导入时把 37016 硬归并到 37013
   - `src/components/Timeline/index.tsx:298-322` 渲染时反向判断"炽天附体窗口内的 37013"显示为 37016 图标
2. **节制 (16536) ↔ 神爱抚 (37011)**：节制施放后附加"神爱抚预备"buff，20s 窗口期内按键变身为神爱抚；使用一次神爱抚后 buff 消耗、变回节制。目前**未实现**。

这两个场景在游戏机制层面是相同结构——**同按键 / 同轨道 / 不同 ability id / 触发条件基于 buff**。区别在是否消耗触发 buff。期望通过一次架构设计统一表达，同时消除现有硬编码。

---

## Section 1：目标与非目标

### 目标

1. 消除两处硬编码 trick：
   - `fflogsImporter.ts:534` 的 `37016 → 37013` 归并
   - `Timeline/index.tsx:298-322` 的炽天附体窗口内显示覆盖
2. 以通用、声明式的方式建模两类场景：
   - **外观-变身型**：共用按键，不同 buff 状态下游戏呈现不同 ability id（意气轩昂 ↔ 降临之章）
   - **Follow-up 型**：父技能施放后在有限窗口内解锁一个子技能，使用后消耗触发（节制 ↔ 神爱抚）
3. 架构可扩展：未来出现其他按键变体或 combo 链，只改 data 不改引擎

### 非目标

- 不建模 FF14 全局 GCD 互斥（现状不做，本次也不做）
- 不支持多积蓄技能（属于问题二的范畴，独立设计）
- 不对 UI 主流程（拖拽、缩放、滚动、技能池）做非必要改动
- 不清理 37013 executor 内判 Buff 3885 / 秘策 1896 的硬编码（执行语义，与本 spec 正交）

---

## Section 2：架构总览

### 两个新字段

```ts
interface MitigationAction {
  id: number
  // ... 已有字段

  trackGroup?: number // 渲染轨道归属，默认 = id（独立成轨）
  placement?: Placement // 额外放置约束，默认 undefined
}
```

不引入 `cooldownGroup`（YAGNI，Healerbook 不建模 GCD 互斥；CD 冲突按 `effectiveTrackGroup` 分组即可覆盖当前需求）。

### Placement 即一个回调

```ts
interface Placement {
  validIntervals: (ctx: PlacementContext) => Interval[]
}

interface Interval {
  from: number // 秒，含
  to: number // 秒，不含
}
```

Placement 的唯一责任是返回"该 action 在当前 ctx 下的原始合法区间"（仅考虑 placement 自身条件，不包含 CD）。UI / 引擎需要的"放置校验、拖拽边界、阴影渲染"三件事都从这个函数的返回值派生。

### Combinator 最小集

```ts
whileStatus(statusId: number)                // 基础：玩家身上有自己施放的某 status
anyOf(...rules): ValidIntervals              // n 元 union
allOf(...rules): ValidIntervals              // n 元 intersection
not(rule): ValidIntervals                    // 一元 complement
difference(a, b): ValidIntervals             // 二元 A - B
```

`whileStatus` 当前固定过滤 `target = ctx.playerId` 且 `source = ctx.playerId`（自己身上、自己放的）。未来需要"别人给的 buff"时再扩 opts，不改核心 API。

### 核心约定

**共用轨道成员必须互补**：
同一 `trackGroup` 内所有成员必须都声明 `placement`，且成员间的 `validIntervals` 在引擎侧两两互斥、并集覆盖全时间轴。否则双击添加无法选出唯一合法成员。

此约束支持：任意时刻 t，轨道上合法成员数 ≤ 1。若 >1 是 data bug。

### 派生链路

```
castEvents + damageEvents
        ↓
MitigationCalculator.simulate()
        ↓                    ↘
   partyState        statusTimelineByPlayer (副产品)
                              ↓
                     createPlacementEngine()
                              ↓
     ┌────────────┬───────────┼──────────────┐
     ↓            ↓           ↓              ↓
  放置校验      拖拽边界     阴影渲染      合法性回溯
```

---

## Section 3：数据模型

### 3.1 `MitigationAction` 新字段

```ts
interface MitigationAction {
  id: number
  // ... 已有字段

  /**
   * 渲染归属的 action id。未设置时 = id（独立成轨）。
   * 设置后，本 action 的 castEvent 渲染到 trackGroup 指向的 action 轨道上。
   * 约束：trackGroup 指向的 action 本身不能再有 trackGroup（禁止链式挂载）。
   */
  trackGroup?: number

  /**
   * 额外放置约束。未声明时仅受基础 CD 冲突检测。
   * 共用轨道（同 trackGroup）的所有成员必须都声明 placement，
   * 且成员间的 validIntervals 必须两两互斥、并集覆盖全时间轴。
   */
  placement?: Placement
}
```

### 3.2 Placement 相关类型

```ts
interface Placement {
  validIntervals: (ctx: PlacementContext) => Interval[]
}

/**
 * 合法放置区间。半开区间 [from, to)，单位秒。
 * 返回的列表必须：按 from 升序、互不重叠。
 * 空数组 = 永不可放。
 */
interface Interval {
  from: number
  to: number
}

interface PlacementContext {
  action: MitigationAction
  playerId: number
  castEvent?: CastEvent // 拖拽/回溯时提供；新建时 undefined
  castEvents: CastEvent[] // 整条时间轴（若 engine 传入 excludeId 则已过滤）
  actions: Map<number, MitigationAction>
  statusTimelineByPlayer: Map<number, Map<number, StatusInterval[]>>
  //                          playerId    statusId
}

interface StatusInterval {
  from: number
  to: number
  stacks: number
  sourcePlayerId: number // 施放者，供 combinator 过滤
  sourceCastEventId: string // Healerbook UUID，用于拖拽 excludeId 过滤
}
```

### 3.3 Effective Getters

```ts
const effectiveTrackGroup = (a: MitigationAction): number => a.trackGroup ?? a.id

const sameTrack = (a: MitigationAction, b: MitigationAction): boolean =>
  effectiveTrackGroup(a) === effectiveTrackGroup(b)
```

CD 冲突检测使用 `effectiveTrackGroup` 分组（替换现有按 `actionId` 分组的逻辑）——这让同轨成员之间也互相扣除 CD，覆盖"共用按键同 CD 时钟"的语义。

### 3.4 PlacementEngine 接口

```ts
interface PlacementEngine {
  /**
   * 某成员的最终合法区间（placement ∩ CD 可用）。
   * 若未声明 placement，仅返回 CD 可用区间。
   */
  getValidIntervals(
    action: MitigationAction,
    playerId: number,
    excludeCastEventId?: string
  ): Interval[]

  /**
   * 整条轨道的不可放阴影（所有成员合法区间 union 的补集）。
   */
  computeTrackShadow(trackGroup: number, playerId: number, excludeCastEventId?: string): Interval[]

  /**
   * 共用轨道在 t 时刻唯一合法的成员。
   * 返回 null：0 合法（toast 拒绝）或 >1 合法（data bug）。
   */
  pickUniqueMember(
    trackGroup: number,
    playerId: number,
    t: number,
    excludeCastEventId?: string
  ): MitigationAction | null

  /**
   * 在 t 时刻放置 action 是否合法。
   */
  canPlaceCastEvent(
    action: MitigationAction,
    playerId: number,
    t: number,
    excludeCastEventId?: string
  ): { ok: true } | { ok: false; reason: string }

  /**
   * 当前时间轴上所有不满足约束的 castEvent。
   * excludeId 支持"假设某 cast 不存在"——用于拖拽父 cast 时预览子 cast 失效。
   */
  findInvalidCastEvents(
    excludeCastEventId?: string
  ): Array<{ castEvent: CastEvent; reason: string }>
}

function createPlacementEngine(params: {
  castEvents: CastEvent[]
  actions: Map<number, MitigationAction>
  statusTimelineByPlayer: Map<number, Map<number, StatusInterval[]>>
}): PlacementEngine
```

**Engine 是纯派生对象**：给定输入产出查询接口，不持有可变状态。每次 `partyState` 变化 UI 层通过 `useMemo` 重建一次 engine。

**`excludeCastEventId` 的统一语义**：所有查询方法支持这个可选参数，内部通过过滤 `statusTimelineByPlayer`（按 `sourceCastEventId`）和 `castEvents` 两份输入实现"假设该 cast 不存在"。不重新模拟 partyState，不 fork engine。

### 3.5 缓存

| 缓存                                                                  | 失效时机                   |
| --------------------------------------------------------------------- | -------------------------- |
| engine 内部 `intervalCache: Map<actionId, Map<playerId, Interval[]>>` | engine 构造时重置          |
| engine 内部 `trackGroupMembers: Map<groupId, Action[]>`               | actions 变化（通常仅 HMR） |
| 带 `excludeCastEventId` 的查询                                        | 不缓存                     |
| UI 层 `findInvalidCastEvents` 结果                                    | 由 useMemo 托管            |

### 3.6 CastEvent 结构不变

```ts
interface CastEvent {
  id: string // UUID（保持不变）
  actionId: number // 现在可以是 group 内任意成员
  playerId: number
  timestamp: number
  // ... 其他字段
}
```

### 3.7 Data 书写形态

```ts
const SERAPHISM_BUFF_ID = 3885            // 炽天附体，由 37014 附加
const DIVINE_CARESS_READY_ID = /* TBD */  // 神爱抚预备，由 16536 附加；实施阶段查证

// 37013 意气轩昂（主成员）
{
  id: 37013,
  // trackGroup 省略 → 自己就是 primary
  placement: {
    validIntervals: not(whileStatus(SERAPHISM_BUFF_ID)),
  },
  // ... 其他字段
}

// 37016 降临之章（变体成员）
{
  id: 37016,
  trackGroup: 37013,
  placement: {
    validIntervals: whileStatus(SERAPHISM_BUFF_ID),
  },
  // hidden: true 删除
}

// 16536 节制（主成员）
{
  id: 16536,
  placement: {
    validIntervals: not(whileStatus(DIVINE_CARESS_READY_ID)),
  },
  // executor 需在施放时附加 DIVINE_CARESS_READY_ID 状态（20s 持续）
}

// 37011 神爱抚（变体成员）
{
  id: 37011,
  trackGroup: 16536,
  placement: {
    validIntervals: whileStatus(DIVINE_CARESS_READY_ID),
  },
  // executor 在施放时消耗 DIVINE_CARESS_READY_ID 状态
}
```

神爱抚的消耗行为由 **executor** 负责（执行时消耗 `DivineCaressReady` 的 stack/整体），不在 placement 中体现。MitigationCalculator 重算后 status timeline 自然收缩，下次查询得到新区间。

---

## Section 4：引擎行为

### 4.1 statusTimelineByPlayer 的产出

由 `MitigationCalculator.simulate()` 在模拟过程中顺便输出：

- Status attach 时：开一个新 `StatusInterval`，`from = t`，记 `sourcePlayerId` / `sourceCastEventId`
- Status 到期 / consume / 被清除时：收束 `to = t`，推入数组
- 结束后按 `playerId → statusId` 双层分组，每个数组按 `from` 排序

增量改造，不重写模拟算法。详见 Section 6.2 对 `mitigationCalculator.ts` 的修改。

### 4.2 核心查询算法

```
getValidIntervals(action, playerId, excludeId):
  ctx = buildContext(playerId, excludeId)
  placementIntervals =
    action.placement
      ? action.placement.validIntervals(ctx)
      : [{from: 0, to: +∞}]
  cooldownIntervals = cooldownAvailable(action, ctx)
  return intersect(placementIntervals, cooldownIntervals)

cooldownAvailable(action, ctx):
  groupId = effectiveTrackGroup(action)
  sameGroupCasts = ctx.castEvents
    .filter(e => e.playerId === ctx.playerId &&
                 effectiveTrackGroup(ctx.actions.get(e.actionId)) === groupId)
  forbidden = sameGroupCasts.map(e => {
    const a = ctx.actions.get(e.actionId)
    return { from: e.timestamp, to: e.timestamp + a.cooldown }
  })
  return complement(mergeOverlapping(sort(forbidden)))

computeTrackShadow(groupId, playerId, excludeId):
  members = trackGroupMembers.get(groupId)
  legalUnion = mergeOverlapping(
    sort(members.flatMap(m => getValidIntervals(m, playerId, excludeId)))
  )
  return complement(legalUnion)

pickUniqueMember(groupId, playerId, t, excludeId):
  members = trackGroupMembers.get(groupId)
  legal = members.filter(m => canPlaceCastEvent(m, playerId, t, excludeId).ok)
  return legal.length === 1 ? legal[0] : null

canPlaceCastEvent(action, playerId, t, excludeId):
  intervals = getValidIntervals(action, playerId, excludeId)
  if intervals.some(i => i.from <= t && t < i.to): return { ok: true }
  return { ok: false, reason: 'not_available' }

findInvalidCastEvents(excludeId):
  result = []
  for each castEvent in castEvents.filter(e => e.id !== excludeId):
    action = actions.get(castEvent.actionId)
    if !action.placement: continue
    intervals = getValidIntervals(action, castEvent.playerId, excludeId)
    if !intervals.some(i => i.from <= castEvent.timestamp && castEvent.timestamp < i.to):
      result.push({ castEvent, reason: 'placement_lost' })
  return result
```

### 4.3 combinator 实现要点

`whileStatus(statusId)`：

```
(ctx) => {
  raw = ctx.statusTimelineByPlayer
    .get(ctx.playerId)?.get(statusId) ?? []
  filtered = raw.filter(si => si.sourcePlayerId === ctx.playerId)
  return mergeOverlapping(
    sort(filtered.map(si => ({ from: si.from, to: si.to })))
  )
}
```

注意：传入 ctx 时，`statusTimelineByPlayer` 已经在 engine 层过滤掉 `sourceCastEventId === excludeId` 的 interval。

内部工具：

- `mergeOverlapping(intervals: Interval[]): Interval[]`：O(n)，合并相邻重叠
- `complement(intervals: Interval[]): Interval[]`：O(n)，`[0, ∞) - ∪ intervals`
- `intersect(a: Interval[], b: Interval[]): Interval[]`：O(n+m)，两条排序列表求交
- `subtractIntervals(a: Interval[], b: Interval[]): Interval[]`：等价 `intersect(a, complement(b))`

所有内部工具保证 Interval[] 的排序 + 不重叠不变量。

### 4.4 启动期 Data 校验（dev-only）

`validateActions(actions): ValidationIssue[]`：

| 规则                                                                    | 级别  |
| ----------------------------------------------------------------------- | ----- |
| `trackGroup` 指向的 id 存在                                             | error |
| `trackGroup` 指向的 action 自身 `trackGroup` 是 undefined               | error |
| 同 trackGroup 所有成员都有 `placement`                                  | error |
| 同 trackGroup 成员的 `cooldown` 一致                                    | warn  |
| 成员 placement 采样互斥检查（在 status 切换点取样，>1 合法成员则 warn） | warn  |

`import.meta.env.DEV` 开关，production 跳过。同时由 Vitest 测试守住。

---

## Section 5：UI 行为

### 5.1 双击空白添加

```
onDblClickTrack(trackGroup, playerId, t):
  member = engine.pickUniqueMember(trackGroup, playerId, t)
  if member is null:
    if 0 合法 → toast "当前无可用技能"
    if >1 合法 → console.error("data bug")，不操作
    return
  result = engine.canPlaceCastEvent(member, playerId, t)
  if !result.ok: toast(result.reason); return
  addCastEvent(member, playerId, t)
```

### 5.2 拖拽已有 castEvent

```
onDragStart(castEvent):
  setDraggingId(castEvent.id)
  // 快照边界（excludeId = 自身），避免每帧查
  dragBoundsRef.current = computeDragBounds(castEvent, engine)

dragBoundFunc(pos):
  t = pixelToTime(pos.x)
  clampedT = clampToBounds(t, dragBoundsRef.current)
  return { x: timeToPixel(clampedT), y: lockedY }

onDragEnd(finalT):
  setDraggingId(null)
  result = engine.canPlaceCastEvent(action, playerId, finalT)
  if result.ok → updateCastEvent(castEvent.id, { timestamp: finalT })
  else → toast; 回弹到原位置

onDragCancel(): setDraggingId(null)

computeDragBounds(castEvent, engine):
  intervals = engine.getValidIntervals(action, castEvent.playerId, castEvent.id)
  currInterval = intervals.find(i => i.from <= castEvent.timestamp && castEvent.timestamp < i.to)
  return currInterval ?? { from: castEvent.timestamp, to: castEvent.timestamp }
```

Y 锁定不跨轨（保持现有行为）。

### 5.3 阴影渲染

统一成一种灰色斜纹，数据源是 `engine.computeTrackShadow(trackGroup, playerId, draggingId ?? undefined)`。拖拽期间引擎自动排除被拖 castEvent，不再自己挡自己。

现有 `SkillTracksCanvas.tsx:183-243` 的 CD 阴影独立计算废弃；现有 `castEventBoundaries`（110-132）预计算废弃。Konva 渲染形式不变。

### 5.4 红边框（合法性回溯）

```ts
const invalidIds = useMemo(
  () => new Set(engine.findInvalidCastEvents(draggingId ?? undefined).map(r => r.castEvent.id)),
  [engine, draggingId]
)
```

`CastEventIcon` 读取 `invalidIds.has(castEvent.id)`，不合法时红色描边 + tooltip "此位置已不满足条件"。不自动删除，用户自行调整。

拖拽父 cast 时，子 cast 的红边框实时预览（依赖 excludeId 过滤）。

### 5.5 技能池显示规则

过滤 `!a.trackGroup || a.id === a.trackGroup`——只有主成员进池。变体成员（37016、37011）不出现在池里，只能通过双击对应父轨道在合法区间内添加。

### 5.6 FFLogs 导入

`fflogsImporter.ts:534` 的 `abilityGameID === 37016 ? 37013 : ...` 删除。保留原 `abilityGameID` 作为 `castEvent.actionId`。渲染时自动经 `trackGroup` 挂到父轨道。

导入完成后运行 `engine.findInvalidCastEvents()`，如有非法 castEvent 在导入结果页给出警告（FFLogs 数据应为合法；若非空说明 data 配置和实际语义有出入）。

### 5.7 视觉元素一览

| 元素                              | 状态             | 样式                  |
| --------------------------------- | ---------------- | --------------------- |
| 轨道背景                          | 已有             | 不变                  |
| 不可放阴影（合并 CD + placement） | 已有 CD 阴影升级 | 灰色斜纹（不变）      |
| 技能图标 / CD 进度条              | 已有             | 不变                  |
| 红边框（合法性回溯）              | 新增             | 红色 stroke + tooltip |
| 伤害事件红虚线 / 10s 网格         | 已有             | 不变                  |
| 亮条 / availability band          | 不做             | ——                    |

---

## Section 6：改动面

### 6.1 新增文件

| 文件                                 | 职责                                                                    |
| ------------------------------------ | ----------------------------------------------------------------------- |
| `src/utils/placement/types.ts`       | `Placement` / `Interval` / `PlacementContext` / `StatusInterval` 类型   |
| `src/utils/placement/combinators.ts` | `whileStatus` / `anyOf` / `allOf` / `not` / `difference` + 区间运算工具 |
| `src/utils/placement/engine.ts`      | `createPlacementEngine` + `PlacementEngine` 接口实现                    |
| `src/utils/placement/validate.ts`    | `validateActions` 启动期 lint                                           |
| `src/utils/placement/*.test.ts`      | 对应单测                                                                |

### 6.2 修改文件

| 文件                                            | 改动                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/types/mitigation.ts`                       | 扩 `MitigationAction` 加 `trackGroup?: number` + `placement?: Placement`；加 `effectiveTrackGroup` helper                                                                                                                                                                              |
| `src/types/status.ts`                           | 扩 `StatusInstance` 或新增 `StatusInterval`（取决于现有结构复用程度）                                                                                                                                                                                                                  |
| `src/utils/mitigationCalculator.ts`             | `simulate()` 输出 `statusTimelineByPlayer`；status attach/expire/consume 记录 `sourceCastEventId` / `sourcePlayerId`                                                                                                                                                                   |
| `src/data/mitigationActions.ts`                 | 四条现有条目按 Section 3.7 形态改写：37013 加 `placement`；37016 `hidden: true` 改为 `trackGroup: 37013` + `placement`；16536 加 `placement`；37011 加 `trackGroup: 16536` + `placement`（37011 当前作为独立 action，迁移后挂到节制轨道）。需从游戏数据补齐"神爱抚预备" status id 常量 |
| `src/utils/fflogsImporter.ts:534`               | 删除硬编码归并                                                                                                                                                                                                                                                                         |
| `src/utils/skillTracks.ts:34`                   | 过滤规则从 `!a.hidden` 改为 `!a.trackGroup \|\| a.trackGroup === a.id`                                                                                                                                                                                                                 |
| `src/store/mitigationStore.ts:62`               | `visible` 过滤从 `!action.hidden` 改为 `!action.trackGroup \|\| action.trackGroup === action.id`（影响技能池显示、选择器枚举等所有 visible 消费点）                                                                                                                                    |
| `src/components/Timeline/index.tsx`             | 删除 298-322 `displayActionOverrides`；新增 `engine = useMemo(createPlacementEngine, ...)` + `draggingId` state；`addCastAt` / `handleDoubleClickTrack` / `handleCastEventDragEnd` 走 engine API；新增 `invalidCastEventIds` useMemo                                                   |
| `src/components/Timeline/SkillTracksCanvas.tsx` | 废弃 110-132 `castEventBoundaries` 预计算；废弃 183-243 CD 阴影独立计算；改调 `engine.computeTrackShadow` / `engine.getValidIntervals`；`displayActionOverrides` prop 删除                                                                                                             |
| `src/components/Timeline/CastEventIcon.tsx`     | `dragBoundFunc` 读 `dragBoundsRef`（index.tsx 快照传入）；加红边框描边；删除 184 行 `displayAction ?? action` 逻辑                                                                                                                                                                     |

### 6.3 删除的硬编码

| 位置                                                    | 现状                                   | 删除后                         |
| ------------------------------------------------------- | -------------------------------------- | ------------------------------ |
| `src/utils/fflogsImporter.ts:534`                       | `abilityGameID === 37016 ? 37013` 归并 | 保留 abilityGameID             |
| `src/components/Timeline/index.tsx:298-322`             | 动态 displayOverride                   | trackGroup 挂载 + 原始 id 表达 |
| `src/data/mitigationActions.ts` 37016 的 `hidden: true` | 隐式不进轨                             | `trackGroup: 37013` 显式挂载   |

### 6.4 测试要求

单测：

- `whileStatus` 按 playerId + sourcePlayerId 过滤
- `anyOf / allOf / not / difference` 区间运算不变量（排序 + 不重叠）
- `getValidIntervals` 的 placement ∩ CD 正确
- `computeTrackShadow` 的 union-complement 正确
- `pickUniqueMember` 在互斥/完整约束下返回唯一解
- `findInvalidCastEvents` 正确识别失效 castEvent
- `excludeCastEventId` 参数的过滤路径

集成测试：

- 场景 1：炽天附体 buff 期双击产出 37016；非 buff 期产出 37013
- 场景 2：节制后 20s 内双击产出 37011；之外产出 16536
- FFLogs 导入保留 37016 原 id，渲染挂 37013 轨道
- 拖拽 37016 超出 buff 窗口 → dragBoundFunc 硬夹住
- 删除父节制后，其关联的神爱抚红边框显示

### 6.5 风险与不在范围

**风险**

- `MitigationCalculator` 改造成本取决于现有代码组织。若现有模拟按伤害事件 walk，可能需要额外在 cast 时间点插入钩子
- 用户本地存储 / 共享时间轴 D1 中可能有 `actionId === 37013` 的历史数据（由之前的归并 trick 产生）。评估后决定：
  - 接受不兼容（新版本可能把旧数据的 37013 都认为是"非 buff 期施放"）
  - 或写一次性迁移脚本
- **37011 神爱抚当前是独立 action**（无 hidden），用户可能已自由规划过。迁移为 `trackGroup: 16536` + placement 后，历史时间轴中非"神爱抚预备 buff"下的神爱抚 cast 将被标记为不合法（红边框），由用户自行调整
- **"神爱抚预备" status id 当前 data 未定义**，需实施阶段从 XIVAPI 或游戏数据查证确定常量；连带需确认 Healerbook 状态注册表是否已含该 status 的元数据

**不在范围（独立 spec）**

- 多积蓄技能建模（问题二）
- 37013 executor 内判 Buff 3885 / 秘策 1896 的执行语义硬编码
- 亮条 / hover 预览等 nice-to-have

### 6.6 估算工作量

| 模块                                                      | 工作量         |
| --------------------------------------------------------- | -------------- |
| 类型 + combinators + engine + validate                    | 1 天           |
| MitigationCalculator 改造输出 timeline                    | 0.5-1 天       |
| Timeline / SkillTracksCanvas / CastEventIcon 改造         | 1 天           |
| data 改造 + fflogsImporter / skillTracks / SkillPool 清理 | 0.5 天         |
| 单测 + 集成测试                                           | 0.5-1 天       |
| **合计**                                                  | **3.5-4.5 天** |

---

## 附录 A：术语表

| 术语                     | 定义                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------ |
| **TrackGroup**           | 渲染轨道归属。同 trackGroup 的 action 在画布上共用一条轨道。默认每个 action 自成一组 |
| **Primary**              | trackGroup 指向的那个 action，即"轨道主人"。trackGroup 等于自身 id 的是主成员        |
| **Variant / 成员**       | trackGroup 指向另一个 action 的那些；它们挂在主成员的轨道上                          |
| **Placement**            | action 的放置约束回调，返回合法区间                                                  |
| **validIntervals**       | placement 返回的时间区间列表，表示该 action 本身在什么时候"条件允许放置"             |
| **Status Timeline**      | 从 MitigationCalculator 派生的"某玩家身上某 status 的存在区间列表"                   |
| **Combinator**           | 构造 validIntervals 函数的工厂，如 `whileStatus(id)`                                 |
| **Effective TrackGroup** | `a.trackGroup ?? a.id`，用来做同轨判断                                               |
| **excludeCastEventId**   | 引擎查询方法的可选参数，用于"假设某 cast 不存在"——支持拖拽场景                       |
| **合法性回溯**           | partyState 变化后对所有 castEvent 重新校验，标记失效者的机制                         |

## 附录 B：与当前实现的对照

| 当前                                                | 新设计                                            |
| --------------------------------------------------- | ------------------------------------------------- |
| `a.hidden: true`（data 字段）                       | `a.trackGroup: <parentId>` 隐式隐藏               |
| `Timeline/index.tsx:298-322` 硬编码 displayOverride | `trackGroup` + 独立 castEvent + FFLogs 原 id      |
| `fflogsImporter.ts:534` 37016→37013 归并            | 删除，保留原 id                                   |
| `checkOverlap` 按 `actionId` 分组                   | `canPlaceCastEvent` 按 `effectiveTrackGroup` 分组 |
| `castEventBoundaries` 静态预计算                    | `engine.getValidIntervals` 动态查询（含缓存）     |
| `SkillTracksCanvas` CD 阴影 per-castEvent 计算      | `engine.computeTrackShadow` 整条轨道统一计算      |
| 无合法性回溯                                        | `engine.findInvalidCastEvents` + 红边框           |
