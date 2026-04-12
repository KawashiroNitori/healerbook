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

### `MitigationAction` 新增 `statDataEntries`

```typescript
interface StatDataEntry {
  type: 'shield' | 'heal' | 'critHeal' // 对应 shieldByAbility / healByAbility / critHealByAbility
  key: number // 对应 Record 中的 key
  label?: string // 可选显示标签（如展开战术的"鼓舞"）
}

interface MitigationAction {
  // ... 现有字段
  statDataEntries?: StatDataEntry[] // 有此字段 → 出现在数值设置模态框；无 → 不出现
}
```

有 `statDataEntries` 的技能出现在设置模态框中，没有的（如活化、秘策、炽天附体以及百分比减伤技能）自然不出现，无需额外标记。

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

## 各技能的 `statDataEntries` 配置

以下是所有需要配置 `statDataEntries` 的技能：

| 技能         | actionId | 职业 | statDataEntries                                                    |
| ------------ | -------- | ---- | ------------------------------------------------------------------ |
| 圣光幕帘     | 3540     | PLD  | `[{ type: 'shield', key: 1362 }]`                                  |
| 摆脱         | 7388     | WAR  | `[{ type: 'shield', key: 1457 }]`                                  |
| 神爱抚       | 37011    | WHM  | `[{ type: 'shield', key: 3903 }]`                                  |
| 展开战术     | 3585     | SCH  | `[{ type: 'heal', key: 185, label: '鼓舞' }]`                      |
| 意气轩昂之策 | 37013    | SCH  | `[{ type: 'heal', key: 37013 }, { type: 'critHeal', key: 37013 }]` |
| 降临之章     | 37016    | SCH  | `[{ type: 'heal', key: 37016 }]`                                   |
| 慰藉         | 16546    | SCH  | `[{ type: 'shield', key: 1917 }]`                                  |
| 阳星合相     | 37030    | AST  | `[{ type: 'shield', key: 1921 }]`                                  |
| 泛输血       | 24311    | SGE  | `[{ type: 'shield', key: 2613 }]`                                  |
| 整体论       | 24310    | SGE  | `[{ type: 'shield', key: 3365 }]`                                  |
| 均衡预后II   | 37034    | SGE  | `[{ type: 'shield', key: 2609 }]`                                  |

模态框根据 `statDataEntries` 动态生成，按 `type` 显示对应标签：

- `shield` → "盾量"
- `heal` → "治疗量" + 可选 `label`（如"治疗量 (鼓舞)"）
- `critHeal` → "暴击治疗量"

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
