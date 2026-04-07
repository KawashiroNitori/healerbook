# 时间轴数值自定义设置

## 概述

让用户自定义时间轴中的盾技能数值和安全血量，而非完全依赖 `/api/statistics` 接口。时间轴内部持有一份完整的统计数据，所有运行时计算只读时间轴内部数据，API 仅在初始化和补缺时使用。

## 数据模型

### 新增 `TimelineStatData` 类型

```typescript
interface TimelineStatData {
  referenceMaxHP: number
  shieldByAbility: Record<number, number> // statusId -> 盾量
  healByAbility: Record<number, number> // actionId -> 治疗量
  critHealByAbility: Record<number, number> // actionId -> 暴击治疗量
}
```

### `Timeline` 新增字段

```typescript
interface Timeline {
  // ... 现有字段
  statData?: TimelineStatData
}
```

### `ActionExecutionContext.statistics` 类型变更

```typescript
interface ActionExecutionContext {
  // ... 现有字段
  statistics?: TimelineStatData // 原为 EncounterStatistics
}
```

### `MitigationAction` 新增标记

```typescript
interface MitigationAction {
  // ... 现有字段
  noStatData?: boolean // 标记不需要 statData 的技能（如活化、秘策、炽天附体）
}
```

需要标记 `noStatData: true` 的技能：

- 活化 (24300) — 仅添加标记状态，后续盾技能检测此状态做数值修正
- 秘策 (16542) — 同上
- 炽天附体 (37014) — 同上

## 数据流

### 初始化（新建/导入时间轴）

1. 从 API 获取 `EncounterStatistics`
2. 计算 `referenceMaxHP = getNonTankMinHP(apiStatistics)`
3. 遍历当前阵容中所有盾技能（排除 `noStatData: true` 的），从 `EncounterStatistics` 中提取对应字段的值
4. 组装 `TimelineStatData` 写入 `timeline.statData`

### 用户编辑

1. 用户在模态框中修改数值
2. 直接更新 `timeline.statData` 中对应字段
3. 触发自动保存

### 阵容变更

- **新增玩家**：检查新职业技能对应的 key 在 `timeline.statData` 中是否存在，不存在才从 API statistics 填入（已有的不覆盖）
- **移除玩家**：删除该职业独有技能的条目（共享技能如雪仇，只要还有其他拥有该技能的职业在阵容中就不删）

### 运行时

所有下游代码只读 `timeline.statData`：

- executor 通过 `ActionExecutionContext.statistics`（类型为 `TimelineStatData`）读取盾值/治疗量
- `getNonTankMinHP` 改为直接读 `statData.referenceMaxHP`
- minimap、DamageEventCard、PropertyPanel 等 UI 组件同理

API 的 `EncounterStatistics` 不参与运行时计算。

## 技能与 statData 字段的对应关系

以下是所有盾技能及其从 `TimelineStatData` 中读取的字段：

### `shieldByAbility[statusId]`（用户填"盾量"）

| 技能       | actionId | statusId | 职业 |
| ---------- | -------- | -------- | ---- |
| 圣光幕帘   | 3540     | 1362     | PLD  |
| 摆脱       | 7388     | 1457     | WAR  |
| 神爱抚     | 37011    | 3903     | WHM  |
| 慰藉       | 16546    | 1917     | SCH  |
| 泛输血     | 24311    | 2613     | SGE  |
| 整体论     | 24310    | 3365     | SGE  |
| 均衡预后II | 37034    | 2609     | SGE  |
| 阳星合相   | 37030    | 1921     | AST  |

### `healByAbility[actionId]`（用户填"治疗量"）

| 技能         | actionId | 职业 | 备注                                      |
| ------------ | -------- | ---- | ----------------------------------------- |
| 展开战术     | 3585     | SCH  | 读 `healByAbility[185]`（鼓舞基础恢复力） |
| 意气轩昂之策 | 37013    | SCH  | 读 `healByAbility[37013]`                 |
| 降临之章     | 37016    | SCH  | 读 `healByAbility[37016]`                 |

### `critHealByAbility[actionId]`（用户填"暴击治疗量"）

| 技能         | actionId | 职业 | 备注                          |
| ------------ | -------- | ---- | ----------------------------- |
| 意气轩昂之策 | 37013    | SCH  | 读 `critHealByAbility[37013]` |

注意：展开战术读的是 `healByAbility[185]`（鼓舞的 actionId），不是自己的 actionId。模态框中展开战术条目的标签应写"治疗量 (鼓舞)"以区分。

## UI 设计

### 入口

EditorToolbar 中新增一个设置按钮，点击弹出模态框。

### 模态框布局

```
┌─────────────────────────────────────┐
│ 数值设置                        [X] │
├─────────────────────────────────────┤
│ 安全血量                            │
│ [____98,432____]                    │
│ 非坦职业最低 HP                      │
├─────────────────────────────────────┤
│ 盾技能数值                          │
│                                     │
│ ▼ PLD 骑士                          │
│   🛡 圣光幕帘         [__24,500__]  │
│     盾量                            │
│                                     │
│ ▼ SCH 学者                          │
│   📖 展开战术         [__12,800__]  │
│     治疗量 (鼓舞)                    │
│   📖 意气轩昂之策     [__15,200__]  │
│     治疗量                          │
│   📖 意气轩昂之策     [__22,800__]  │
│     暴击治疗量                      │
│   🛡 慰藉             [__18,600__]  │
│     盾量                            │
│ ...                                 │
├─────────────────────────────────────┤
│                   [取消]  [保存]     │
└─────────────────────────────────────┘
```

### 交互细节

- 每个职业分组默认展开，点击职业标题可折叠
- 输入框初始值来自 `timeline.statData`（初始化时从 API statistics 填入）
- 每个技能条目的副标签标注数值类型（盾量 / 治疗量 / 暴击治疗量）
- 只显示当前阵容中存在的职业的技能
- 排除 `noStatData: true` 的技能（活化、秘策、炽天附体）

## Store 变更

### `timelineStore`

1. **`updateStatData(statData: TimelineStatData)`** — 更新 `timeline.statData`，触发自动保存
2. **`updateComposition`** — 增加 statData 清理逻辑：移除不在新阵容中的职业独有技能条目；为新增职业从 API statistics 补充缺失的 key
3. **`setStatistics`** — 当 API statistics 到达且 `timeline.statData` 存在时，仅补充 `statData` 中缺失的 key（不覆盖已有值）

### 消费端变更

- `useDamageCalculation` — 传给 executor 的 `statistics` 改为 `timeline.statData`
- `getNonTankMinHP` — 改为接受 `referenceMaxHP: number` 参数或直接读 `statData.referenceMaxHP`
- `TimelineMinimap` — 同理，从 `statData` 读 `referenceMaxHP`

## 服务器存储

`statData` 作为 `Timeline` 的一部分，随时间轴数据一起保存到 LocalStorage 和服务器（D1）。无需额外的 API 端点或数据库字段变更（`timeline` 列已存储完整 JSON）。
