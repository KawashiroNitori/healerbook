# 基于可选中性的目标减无效判定设计

> 在现有「来源非 boss → 目标减无效」的导入期自动判定之上，再补一条**通用规则**：**只要伤害
> 来源在该伤害时刻不可选中（无敌 / 转场），目标减即无效——不限于 boss**。结果落进既有的
> `targetMitigationDisabled` 字段，用户仍可手动覆盖。

## 背景与目标

FF14 的「目标减」是挂在伤害来源身上、降低其输出的 debuff（雪仇 / 牵制 / 武装解除 / 昏乱）。
它们必须真正"挂到来源身上"才生效——而来源 **不可选中**（转场无敌、机制无敌）期间无法被挂上
这些 debuff。此时若该来源仍结算伤害（不可选中前贴的 DoT 残伤、快照的 AOE），这些伤害实际
吃不到目标减。

现状（见 [2026-06-05-target-mitigation-toggle-design.md](./2026-06-05-target-mitigation-toggle-design.md)）：
导入期 `parseDamageEvents` 已经把"来源非 boss"的事件置 `targetMitigationDisabled = true`。但
**任意来源处于不可选中时段**的伤害，现有规则不会判无效——这正是本功能要补的洞。

> 规则不限于 boss：对非-boss 来源，现有非-boss 规则已无条件判无效，可选中性检查对它们不增不减；
> 真正的增量发生在 **boss 本体不可选中**、以及 **boss 检测失败（`bossIds` 为空）时仍能凭
> 「不可选中」抓到的残伤**——通用版比 boss-gated 版更稳健。

目标：

- Worker 抓取 `targetabilityupdate` 类型事件，并入 `events` 回前端。
- 前端导入期由这些事件重建"每个敌方 actor 的可选中时间区间"，并按名归并以覆盖 FFLogs 的
  同名合成 actor（见「实证结论」）。
- `parseDamageEvents` 判定升级为 OR 叠加：来源非 boss **或** 来源在该伤害时刻不可选中 → 置
  `targetMitigationDisabled = true`。
- 覆盖场景：**任意来源不可选中时段仍结算的残伤**（含 boss 本体、boss 检测失败的兜底）。

非目标：

- **不**改 `targetMitigationDisabled` 字段语义、计算引擎、UI、V2 持久化——判定结果复用既有字段，
  对下游完全透明。
- **不**持久化可选中区间——它只在单次导入期存在，用完即弃。
- **不**回写 / 覆盖用户手动设置——导入只设初值（手动优先，沿用现状）。
- **不**改 `damageSource`（伤害来源名）逻辑。

## 实证结论（已用真实报告确认）

用 FRU 报告 `7YmcBTgfyX2dPA4z` fight 6（七天王）、`filterExpression:'type="targetabilityupdate"'`
抓到 24 条原始事件，确认 raw `targetabilityupdate` 形态：

```json
{"timestamp":4934125,"type":"targetabilityupdate","sourceID":11,"targetID":11,"abilityGameID":0,"fight":6,"targetable":0}
{"timestamp":5308737,"type":"targetabilityupdate","sourceID":31,"sourceInstance":4,"targetID":31,"targetInstance":4,"abilityGameID":0,"fight":6,"targetable":0}
```

- **`targetable`**：数值 `0`=变不可选中、`1`=恢复可选中（非布尔）。
- **事件的 actor 标识**：`targetabilityupdate` 事件自身 `sourceID === targetID` 恒等（自身状态
  变化），按 `targetID` 标识该 actor。
- **`sourceInstance`/`targetInstance`**：仅多实例小怪带（如 id=31 同刻 3 个实例）；boss 本体
  （subType=Boss，如 id 11/21/34）单实例、无 instance 字段。多实例的是小怪，本就被非-boss
  规则无条件判无效，故区间按 `targetID` 分组、**忽略 instance**。
- **默认值验证**：boss id=11 首个事件即 `targetable:0`，印证"首切换点前默认可选中"。

### 关键：伤害 `sourceID` ≠ 可选中性 actorId（同名合成 actor）

`FFLogsEvent` 类型需新增 `targetable?: number`（既有类型已有 `sourceID`/`targetID`/`targetInstance`）。

但**伤害事件的 `sourceID` 不一定等于任何 `targetabilityupdate` 的 actorId**：FFLogs 会把同一个
boss 拆成多个**同名** actor——真实实体（有真实 `gameID`，携带 `targetabilityupdate`）+ 一个
`gameID` 落在 `2000000+` 系列的**合成"影子" actor**（**无任何 `targetabilityupdate`**）。boss
不可选中阶段的团伤常被记在这个合成 actor 名下。

实测（同一报告 fight 6，P2 光神「侵蚀光」窗口约 4:53–5:22 不可选中）：

| actor | gameID    | targetabilityupdate            | 该阶段团伤  |
| ----- | --------- | ------------------------------ | ----------- |
| 21    | `17823`   | 有（`4:53 off` / `5:22 on` …） | 1741 条     |
| 22    | `2000022` | **0 条**                       | **1773 条** |

`id=22` 团伤全部落在 `0:38–5:40`。若只按 actorId 单键查，`isTargetableAt(22)` 找不到区间 →
回落默认可选中 → 该窗口约 98% 团伤误判目标减有效。**故可选中性必须按名归并**：自身无任何
`targetabilityupdate` 的 actor，借用**同名**真实实体的区间。

## 数据流（沿用 `limitbreakupdate` 现成管线）

### 1. Worker 抓取（`src/workers/fflogsClientV2.ts`）

模块级 `EVENT_FETCH_SPECS`（`:159`）含一条 `targetabilityupdate` 抓取条目，用服务端
`filterExpression` 只取目标类型（避免把全量 `All` 事件拉回来过滤）：

```ts
{ dataType: 'All', filterExpression: 'type="targetabilityupdate"', filterType: 'targetabilityupdate' }
```

- 共享 GraphQL query（`getEvents` 内，`:492`）含可选变量 `$filterExpression: String`，传入
  `events(... filterExpression: $filterExpression ...)`；其余 spec 不传（null = 无过滤，FFLogs
  默认行为，对既有抓取无影响）。
- `FetchSpec` 类型（`:134`）含 `filterExpression?: string`；`fetchAllEventsForSpec`（`:514`）把它
  带进 query 变量（`filterExpression: spec.filterExpression ?? null`，`:528`）。
- **不**用 `singlePage`：可选中性切换贯穿整场战斗，需全程分页；但因服务端已过滤，整场仅 24 条、
  一页拿完，开销极小。
- `filterType: 'targetabilityupdate'` 作为客户端兜底过滤（与现有 limitbreakupdate 一致），抓到的
  事件并入 `allEvents` 随 `events` 回前端。**HTTP 接口、`FFLogsEventsResponse` 均不变。**

### 2. 前端导入（`src/utils/fflogsImporter.ts`）

#### 2a. 构建可选中区间（按 actor + 按名两套视图）

```ts
export interface TargetabilityToggle {
  timestamp: number // 报告相对毫秒（与伤害事件 timestamp 同域）
  targetable: boolean // 该时刻起是否可选中
}

export interface TargetabilityIntervals {
  byActor: Map<number, TargetabilityToggle[]> // 各 actor 自身切换点（仅含有事件者），升序
  byName: Map<string, TargetabilityToggle[]> // 同名 actor 切换点合并，升序
  idToName: Map<number, string> // 全量 enemy 的 id→name，供无自身事件时回退
}

export function buildTargetabilityIntervals(
  events: FFLogsEvent[],
  enemyNames?: Map<number, string>
): TargetabilityIntervals
```

- 扫描 `type === 'targetabilityupdate'` 事件，按 `targetID` 分组（忽略 instance），按 `timestamp`
  升序填 `byActor`；切换点 `targetable` 取 `e.targetable === 1`（1=可选中，0=不可选中）。
- 传入 `enemyNames` 时，把 `byActor` 各 actor 的切换点按名合并出 `byName`，并以 `enemyNames` 全量
  填 `idToName`（含无自身事件的合成 actor）。
- 完全无 `targetabilityupdate` 事件的 actor 不入 `byActor`（但可经 `idToName → byName` 借同名
  兄弟区间）。

#### 2b. 查询（自身优先、同名回退）

```ts
export function isTargetableAt(
  intervals: TargetabilityIntervals,
  actorId: number,
  timestamp: number
): boolean
```

- **自身有 `targetabilityupdate`**（`byActor` 命中）→ 取"最后一个 `切换点.timestamp <= timestamp`
  的 `targetable`"（信自身，真实 actor 不被同名兄弟污染）。
- **自身无任何切换点** → 回退到 `byName[idToName[actorId]]` 的同名归并区间（合成 actor 借真实
  实体的不可选中区间）。
- 仍无可用区间（未跟踪 / 早于首切换点 / 无名字映射）→ `true`（默认可选中，向后兼容）。

> `last toggle <= ts` 语义让无事件的合成 actor 按时间**就近**落到同期的真实兄弟；同名真实 actor
> 串行分阶段（如 P2 `id=21` 与 P5 回响 `id=38`）不会互串。仅当两个同名**真实** actor 同时同框、
> 各自独立开关、且都对玩家造成伤害时合并才有歧义——FF14 boss 机制几乎不出现，且非-boss 来源
> 早被非-boss 规则判无效，不走可选中性这条路。

#### 2c. parseDamageEvents 接入

`parseDamageEvents`（`:219`）新增可选参数 `targetability?: TargetabilityIntervals`（置于参数表末尾，
保持 worker 调用方向后兼容——不传则该项判定为 no-op）。

判定为 OR 叠加（`targetMitigationDisabled`，`:484` 附近）：

```ts
const sourceId = detailSourceIds.get(firstDetail) ?? 0
const sourceIsNonBoss = !!bossIds && bossIds.size > 0 && sourceId !== 0 && !bossIds.has(sourceId)
// 来源已知且在该伤害时刻不可选中（用 raw timestamp，与 targetabilityupdate 同为报告相对毫秒域）
const sourceUntargetable =
  !!targetability &&
  sourceId !== 0 &&
  !isTargetableAt(targetability, sourceId, firstDetail.timestamp)
const targetMitigationDisabled = sourceIsNonBoss || sourceUntargetable ? true : undefined
```

- 时间戳比较用 raw `firstDetail.timestamp`（毫秒、报告相对），与 `targetabilityupdate` 事件的
  `timestamp` 同域；**不**用已转换的 `relativeTime`。
- 该检查只会把**更多**事件翻成 disabled，从不重新启用，与非-boss 规则天然 OR 叠加。

#### 2d. parseFightImport 接线

`parseFightImport`（`:951`，已在此构建 `bossIds` / `enemyNames`）传入 `enemyNames` 以启用按名归并：

```ts
const targetability = buildTargetabilityIntervals(events, enemyNames)
const damageEvents = parseDamageEvents(
  events,
  fightStartTime,
  playerMap,
  abilityMap,
  composition,
  bossIds,
  enemyNames,
  targetability
)
```

`enemyNames`（由 `report.enemies` 构建）同时供 `damageSource` 与按名归并复用。worker 侧调用方
（`top100Sync.ts` / `routes/fflogs.ts`）不传 `targetability`，行为不变。

## 不改动的部分（复用既有机制）

- **计算引擎**：判定结果落进既有 `targetMitigationDisabled`，`mitigationCalculator` 无改动。
- **UI**：PropertyPanel 的「目标减有效」勾选照常读写该字段；手动设置持久化覆盖（手动优先）。
- **V2 持久化 / 协作**：复用既有 `tmd` 短键，`timelineFormat.ts` / `timelineV2.ts` 无改动。
- **可选中区间**：只在导入期存在，不进任何持久化格式。

## 测试（TDD）

`src/utils/fflogsImporter.test.ts`：

- `buildTargetabilityIntervals`：单 actor 多次切换按时间升序；多 actor 互不干扰；无事件的 actor
  不入 `byActor`。
- `isTargetableAt`：
  - 早于首切换点 → true；切换点边界（`<=` 取该点状态）；未跟踪 actor → true。
  - **同名归并**：合成 actor（自身无事件）继承同名兄弟的不可选中区间；自身有事件的 actor 不被
    同名兄弟污染；两个同名真实 actor 串行开关时按时间就近落位；无 `enemyNames` 时无自身事件
    actor 不归并（向后兼容）。
- `parseDamageEvents`：
  - boss 来源 + 该时刻不可选中 → `targetMitigationDisabled = true`。
  - boss 来源 + 该时刻可选中 → 字段省略（除非命中其它规则）。
  - **`bossIds` 为空 + 来源不可选中 → 仍 true**（通用规则不依赖 boss 检测，兜底用例）。
  - 非 boss 来源 → 始终 true（回归现有规则）。
  - 不传 `targetability` 或来源 `sourceId=0` → 该项判定 no-op（回归）。

`src/workers/fflogsClientV2.test.ts`：

- `EVENT_FETCH_SPECS` 含 `targetabilityupdate` 条目，携带 `filterExpression`。
- 既有 spec 不带 `filterExpression`（不破坏既有抓取断言）。

## 附录：实测 boss 不可选中区间（FRU 七天王）

报告 `7YmcBTgfyX2dPA4z` fight 6（全清，18:32）。零时间取 `limitbreakupdate` 锚点（`4899421ms`，
距 `fight.startTime` +0.8s），下列时间均相对该零时间。

> 区分两类：**闭合区间** = boss 变不可选中后又恢复（在场但暂时不可选中，本功能要抓的核心场景）；
> **转场起点** = boss 在阶段结束时变不可选中后未再恢复（被移除，并非真的长时间在场不可选中）。
> 末尾未闭合按"持续到战斗结束"处理——对判定无害（该 boss 此后不再产出需吃目标减的伤害）。

### 闭合区间（present-but-untargetable）

| Boss                         | actor id | 区间                | 时长  |
| ---------------------------- | -------- | ------------------- | ----- |
| Fatebreaker (P1)             | 11       | `0:34.7 → 1:20.0`   | 45.3s |
| Usurper of Frost (P2)        | 21       | `3:16.6 → 3:53.6`   | 37.0s |
| Usurper of Frost (P2)        | 21       | `4:53.1 → 5:22.1`   | 29.0s |
| Usurper of Frost (P5 回响)   | 38       | `11:44.4 → 12:34.3` | 49.9s |
| Oracle of Darkness (P5 回响) | 41       | `11:45.5 → 12:34.3` | 48.9s |

### 转场起点（变不可选中后未恢复，仅起点有意义）

| Boss               | actor id | 转入不可选中时刻 | 说明         |
| ------------------ | -------- | ---------------- | ------------ |
| Usurper of Frost   | 21       | `5:46.5`         | P2 结束转 P3 |
| Oracle of Darkness | 34       | `10:00.6`        | P3 结束转场  |
| Usurper of Frost   | 38       | `12:51.7`        | P5 回响退场  |
| Oracle of Darkness | 41       | `12:51.7`        | P5 回响退场  |

**Pandora (id 45)**：全程可选中，无不可选中区间——最终被击杀的本体。

> 数据佐证：`id=21` 的 `4:53.1→5:22.1` 这类窗口里，团伤大多被 FFLogs 记在同名合成 actor `id=22`
> 名下；按 actorId 单键查会漏判，按名归并后 `id=22` 借 `id=21` 的不可选中区间命中，正是本设计
> 补判目标减无效的价值所在。
