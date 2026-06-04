# 绿条末端按 status 类别优先取值

> 2026-06-05

## 背景

表格视图与画布视图的「绿条」末端由 `MitigationCalculator.simulate` 产出的
`castEffectiveEndByCastEventId` 决定（见 `2026-04-26-variable-green-bar-design.md`）。

当前口径：一个 cast 的 executor 可能给 `PartyState` 附加多个 status（各自独立
`instanceId`，共享同一 `sourceCastEventId = castEvent.id`）。`pushInterval` 维护
`castEffectiveEnd` 时对同一 cast 下**所有 instance 的实际收束时刻 `to` 取 max**：

```js
// mitigationCalculator.ts pushInterval
if (rec.sourceCastEventId !== '') {
  const prev = castEffectiveEndByCastEventId.get(rec.sourceCastEventId) ?? -Infinity
  castEffectiveEndByCastEventId.set(rec.sourceCastEventId, Math.max(prev, to))
}
```

问题：当一个技能既产生「主减伤」status（百分比减伤 / 盾），又附带一个时长更长的
辅助 buff（如 HoT / regen / 标记类）时，`max` 会取到长尾辅助 buff 的末端，使绿条
**长于实际减伤窗口**，误导用户。

## 目标

绿条末端优先反映**主减伤**（percentage / shield）status 的实际收束时刻；仅当一个
cast 完全不产生主减伤 status 时，才回退到「所有 instance 取 max」的现状。

## 规则

把一个 cast 附着的每个 status instance 归入两层：

- **primary（主减伤层）**：category 含 `percentage` 或 `shield`
- **other**：其余（heal / regen / maxHP / 标记等）

绿条末端 `castEffectiveEnd[castId]` 计算：

1. 该 cast **存在 primary instance** → `max(primary 各 instance 的实际收束 to)`
2. 该 cast **无 primary instance** → `max(全部 instance 的实际收束 to)`（保持现状）

`percentage` 与 `shield` 同属 primary 层，**并集取 max**（两者不等长时取较晚者）。

「实际收束 to」沿用现有语义：自然过期取 `endTime`、被提前消费取消费时刻、被延长则
顺延（详见 `pushInterval` / `captureTransition`，本设计不改这部分）。

## 分类判定（category 为主，type / barrier 兜底）

在 `captureTransition` open 一条区间时（此刻同时拿得到完整 status 对象与
`getStatusById(statusId)` 元数据），算出该 instance 的 tier：

- **isPercentage**：`meta.category?.includes('percentage')`；
  category 未标注（`meta.category` 为 undefined）时回退 `meta.type === 'multiplier'`
- **isShield**：`meta.category?.includes('shield')`；
  category 未标注时回退「该 instance 有 `remainingBarrier` 或 `initialBarrier`」
- `tier = (isPercentage || isShield) ? 'primary' : 'other'`

> 说明：category **非空标注**时**只看 category**，不再叠加 type/barrier；type/barrier 仅在
> category 缺省（`undefined` **或空数组**）时作为兜底，避免把已明确归类为 other 的 status
> 误判为 primary。空数组与 `statusFilter.ts` 的 `meta.category ?? []` 口径一致，视作「未标注」。

## 实现

改动集中在 `src/utils/mitigationCalculator.ts` 的 `simulate` 内部，消费端不动。

### 1. `OpenRecord` 增加 tier 字段

```ts
interface OpenRecord {
  // …现有字段…
  tier: 'primary' | 'other'
}
```

`captureTransition` 在为新 instance `open.set(...)` 时按上节判定填入 `tier`。

### 2. `pushInterval` 分层维护 running max

新增两个 cast 级 map（与 `castEffectiveEndByCastEventId` 平级）：

```ts
const primaryEndByCast = new Map<string, number>()
const anyEndByCast = new Map<string, number>()
```

`pushInterval` 内（`sourceCastEventId !== ''` 分支）：

```js
const updateMax = (map, id, to) => map.set(id, Math.max(map.get(id) ?? -Infinity, to))
updateMax(anyEndByCast, rec.sourceCastEventId, to)
if (rec.tier === 'primary') updateMax(primaryEndByCast, rec.sourceCastEventId, to)
```

### 3. simulate 收尾合成 `castEffectiveEndByCastEventId`

`open` 残留区间 flush（现有 `for (const [, rec] of open) pushInterval(...)`）之后，
合成最终结果：

```js
const castIds = new Set([...anyEndByCast.keys()])
for (const id of castIds) {
  const end = primaryEndByCast.get(id) ?? anyEndByCast.get(id)!
  castEffectiveEndByCastEventId.set(id, end)
}
```

> 即：`castEffectiveEndByCastEventId` 不再在 `pushInterval` 里直接写入，改为收尾统一
> 从 `primaryEndByCast` / `anyEndByCast` 合成，保证「优先级判定需看齐全部 interval」
> 的语义正确。

## 消费端（无需改动）

- `castWindow.ts` 的 `greenEndOf` → 绿格 `computeLitCellsByEvent`、蓝色 CD 条
  `computeCdCellsByEvent`
- 画布视图 `CastEventIcon` / `SkillTracksCanvas`

均透过 `castEffectiveEnd` 单一来源读取，自动一致。

## 已知边界（可接受）

- **蓝色 CD 条连带变长**：蓝条起点 = greenEnd；主减伤短于长尾 aux buff 时，绿条变短、
  蓝条相应变长、长尾 buff 不再点亮绿格——符合本需求意图。
- **变身（statusId 改、instanceId 不变）**：tier 在 open 时一次算定，persist 分支不重算。
  极少数「标记 buff 变身成减伤」场景 tier 不更新；当前无此类技能，暂不处理。
- **statusTimelineByPlayer 不受影响**：每个 instance 仍各自完整记录，减伤命中判定仍按
  各自 `[startTime, endTime]` 走，本改动只影响 UI 绿条末端。

## 测试

`src/utils/mitigationCalculator.test.ts` 新增 simulate 用例：

1. cast 同产 percentage(短) + regen(长) → `castEffectiveEnd` 取 percentage 末端
2. cast 同产 percentage + shield 不等长 → 取两者较晚者
3. 纯 regen / 纯标记 cast（无 primary） → 回退全部 max（现状不变）
4. category 缺省但 `type === 'multiplier'` 的 status → 兜底判为 primary

必要时同步 `src/utils/castWindow.test.ts`（greenEnd 透传链路）。
