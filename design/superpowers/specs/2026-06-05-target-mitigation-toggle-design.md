# 目标减开关设计

> 为单个伤害事件新增「目标减是否生效」开关（默认生效）。关闭后，该事件的减伤计算
> 跳过所有「目标减」（降低 boss 输出的 debuff，如雪仇/牵制/武装解除/昏乱），其 buff
> icon 也随之从「预估减伤效果」列表中消失；PropertyPanel 上处于"关"位的 Switch 本身
> 即充当"此伤害无视目标减"的提示。

## 背景与目标

FF14 里「目标减伤」指挂在 boss（伤害来源）身上、降低其造成伤害的 debuff：雪仇、牵制、
武装解除、昏乱等。它们对 boss 打出的绝大多数伤害生效，但**某些机制伤害无视目标减**
（如百分比扣血、特定无视减伤的机制）。规划时需要能对单个伤害事件声明"这一刀吃不到目标减"，
使预估最终伤害不把目标减算进去。

现状问题：代码中 `MitigationType = 'target_percentage' | ...`（`src/types/mitigation.ts:17`）
**定义了但全代码零使用**；`category` 数组里的 `'target'`/`'self'` 表达的是"对哪个坦克生效"
（self=施放者坦、target=另一坦），与"boss debuff"正交。因此当前数据模型**无法识别**
哪些状态属于"目标减"。本功能第一步即补上这个识别能力。

目标：

- `MitigationCategory` 增加枚举 `'boss'`，标注"降低 boss 输出的 debuff"=目标减。
- 给雪仇/牵制/武装解除/昏乱的 `category` 追加 `'boss'`。
- `DamageEvent` 增加可选字段 `targetMitigationDisabled?: boolean`（省略=生效）。
- PropertyPanel 事件属性区新增「目标减生效」Switch，默认开；关闭即写入 `targetMitigationDisabled: true`。
- 关闭时：计算引擎跳过该事件所有 `category` 含 `'boss'` 的状态（不乘减伤、不进 `appliedStatuses`），
  其 icon 因不在 `appliedStatuses` 而自然从「百分比」桶消失，`-X%` 总和同步下降。
- **FFLogs 导入期自动判定**：借鉴外部项目（XIVtimelineMaker）逻辑——伤害来源不属于 boss
  的事件，导入时即置 `targetMitigationDisabled = true`；boss 来源默认生效。
- 持久化：随本地保存、分享/导出（V2）、协作（Yjs）同步。

非目标：

- **不**对被跳过的 boss icon 做划线/透明等特殊渲染——"关"位的 Switch 已是提示，icon 直接不显示。
- **不**改动 `category` 既有的 `'target'`/`'self'`/`'partywide'` 坦克定向语义；`'boss'` 与之正交叠加。
- **不**支持按单个目标减状态粒度关闭（开关是事件级布尔，关则全部 boss 减伤失效）。
- 自动判定**仅作为导入初值**，用户仍可在 PropertyPanel 手动覆盖；后续修改不被导入逻辑回写。

## 数据模型

### `src/types/mitigation.ts`

`MitigationCategory` 增加 `'boss'`：

```ts
/**
 * 减伤类别（UI 过滤用）
 * - boss: 降低 boss 输出的 debuff（目标减，如雪仇/牵制/武装解除/昏乱）；
 *         与 'target'（坦克定向）正交——'target' 指对哪个坦克生效，'boss' 指作用于伤害来源
 * ...
 */
export type MitigationCategory =
  | 'shield'
  | 'percentage'
  | 'heal'
  | 'partywide'
  | 'self'
  | 'target'
  | 'boss'
```

### `src/data/mitigationActions.ts`

给以下 action 的 `category` 追加 `'boss'`（保留既有项）：

| id   | 名称     | 改前                         | 改后                                |
| ---- | -------- | ---------------------------- | ----------------------------------- |
| 7535 | 雪仇     | `['partywide','percentage']` | `['partywide','percentage','boss']` |
| 7549 | 牵制     | `['partywide','percentage']` | `['partywide','percentage','boss']` |
| 2887 | 武装解除 | `['partywide','percentage']` | `['partywide','percentage','boss']` |
| 7560 | 昏乱     | `['partywide','percentage']` | `['partywide','percentage','boss']` |

> 上表 id 已核对 `src/data/mitigationActions.ts`。识别在状态层通过
> `getStatusById(status.statusId).category?.includes('boss')` 判定，故 status meta
> 的 category 须继承自对应 action（既有机制已如此）。

### `src/types/timeline.ts`

`DamageEvent` 增加可选字段：

```ts
export interface DamageEvent {
  // ...既有字段
  /**
   * 目标减是否对本事件无效。省略/false = 目标减正常生效（默认）；
   * true = 本事件无视目标减，计算时跳过所有 category 含 'boss' 的状态。
   * 仅在用户手动关闭时存 true，存量事件无此字段。
   */
  targetMitigationDisabled?: boolean
}
```

## 计算集成（`src/utils/mitigationCalculator.ts`）

唯一改动点在 `runSingleBranch` 的 Phase 1（百分比减伤应用，约 `:1034-1048`）。
单坦路径与多坦（tankbuster）路径都经由 `runSingleBranch`，一处改动覆盖两条路径。

在应用 multiplier 前增加一道跳过判断：

```ts
for (const status of phase1Statuses) {
  const meta = getStatusById(status.statusId)
  if (!meta) continue
  if (!multiplierFilter(meta, status)) continue

  // 目标减开关：本事件关闭目标减时，跳过所有 boss debuff（不乘、不计入 appliedStatuses）
  if (event.targetMitigationDisabled && meta.category?.includes('boss')) continue

  if (meta.type === 'multiplier') {
    if (mitigationTime >= status.startTime && mitigationTime <= status.endTime) {
      const performance = status.performance ?? meta.performance
      const damageMultiplier = this.getDamageMultiplier(performance, damageType)
      multiplier *= damageMultiplier
      appliedStatuses.push(status)
    }
  }
}
```

说明：

- 目标减都是纯 multiplier 类型（无 `onBeforeShield` 钩子），只需在 Phase 1 抑制乘算即可，
  不影响 Phase 2（盾前钩子）/Phase 3（盾）/后续阶段。
- 被跳过的状态不进 `appliedStatuses`，因此 `final damage` 升高、`-X%` 总和下降、boss icon
  从 UI 消失，三者自动一致，**无需新增任何回传字段**。

## UI（`src/components/PropertyPanel.tsx`）

- 在伤害事件属性区（「预估减伤效果」相关区域附近）新增一个 shadcn `Switch`「目标减生效」：
  - `checked = !event.targetMitigationDisabled`（默认开）。
  - `onCheckedChange(checked)` → `updateDamageEvent(event.id, { targetMitigationDisabled: checked ? undefined : true })`
    （开时写 `undefined` 清除该键，保持数据精简；关时写 `true`）。
  - 仅编辑模式（local/author）可操作；view 模式只读展示状态。
- `renderAppliedStatuses` **不改动**：boss 状态在关闭时已不在 `appliedStatuses`，icon 与
  `-X%` 总和随之同步。
- "关"位的 Switch 即"此伤害无视目标减"的视觉提示，不再额外渲染划线/提示行。

## 持久化（V2 格式 / 剪贴板）

`DamageEvent` 走显式字段白名单序列化，新字段须接入三处，新增 V2 短键 `tmd`：

- `src/types/timelineV2.ts`：`V2DamageEvent` 增加 `tmd?: boolean`（或沿用项目数值编码约定）。
- `src/utils/timelineFormat.ts`
  - `toV2DamageEvent`（约 `:109`）：`if (e.targetMitigationDisabled) out.tmd = true`
  - `fromV2DamageEvent`（约 `:259`）：`if (e.tmd) out.targetMitigationDisabled = true`
- `src/utils/timelineClipboard.ts`（约 `:99`）：
  `...(e.targetMitigationDisabled !== undefined && { targetMitigationDisabled: e.targetMitigationDisabled })`

协作（Yjs）随 timelineStore 状态自然同步，无需额外处理。

## FFLogs 导入期自动判定（`src/utils/fflogsImporter.ts`）

借鉴外部项目 XIVtimelineMaker（app.js）的"目标减＝Boss 来源标记有效"思路：**伤害来源不属于
boss 的事件，导入时即标记无视目标减**。本工具里玩家/宠物来源的伤害已被丢弃，剩余皆为敌方来源；
此处进一步区分"主 boss 来源"与"小怪/场地/分身来源"。

### 1. 构建 bossIds

新增 helper（`fflogsImporter.ts`），输入 `report.enemies`（`FFLogsV1Actor[]`，其 `type`
可为 `'Boss'`/`'NPC'`）与 `fight.name`，逐级 fallback：

```ts
export function buildBossIds(enemies: FFLogsV1Actor[] | undefined, fightName: string): Set<number> {
  const ids = new Set<number>()
  if (!enemies?.length) return ids
  // 1. 主信号：type === 'Boss'
  for (const e of enemies) if (e.type === 'Boss') ids.add(e.id)
  // 2. fallback：名称等于战斗名
  if (ids.size === 0) for (const e of enemies) if (e.name === fightName) ids.add(e.id)
  // 3. fallback：仅一个敌方 actor
  if (ids.size === 0 && enemies.length === 1) ids.add(enemies[0].id)
  // 4. 按名扩展同名实体（分身/转场）
  const bossNames = new Set([...ids].map(id => enemies.find(e => e.id === id)?.name))
  for (const e of enemies) if (bossNames.has(e.name)) ids.add(e.id)
  return ids
}
```

`bossIds` 为空（检测失败）时，自动判定整体降级为 no-op，**不**冒险标记任何事件，避免误判。

### 2. parseDamageEvents 接入

`parseDamageEvents` 新增可选参数 `bossIds?: Set<number>`（置于参数表末尾，保持 worker 调用方
`top100Sync.ts` / `routes/fflogs.ts` 向后兼容——它们不传则跳过自动判定）。

在 Step 4 聚合循环构建 `DamageEvent` 处（`firstDetail` 与 `detailSourceIds` 在作用域内），
按代表 detail 的来源判定：

```ts
const sourceId = detailSourceIds.get(firstDetail) ?? 0
// 仅在 bossIds 检测成功、且来源已知且非 boss 时标记；其余保持默认生效（省略字段）
const targetMitigationDisabled =
  bossIds && bossIds.size > 0 && sourceId !== 0 && !bossIds.has(sourceId) ? true : undefined

damageEvents.push({
  // ...既有字段
  ...(targetMitigationDisabled && { targetMitigationDisabled }),
})
```

> 代表来源取 `firstDetail`（与 `name`/`representativeDamage` 同源），与聚合口径一致。

### 3. 调用方接线（`src/components/ImportFFLogsDialog.tsx`）

在调用 `parseDamageEvents` 前构建并传入 `bossIds`（`report`、`fight` 均在作用域内）：

```ts
const bossIds = buildBossIds(report.enemies, fight.name)
const damageEvents = parseDamageEvents(
  eventsData.events || [],
  fightStartTime,
  playerMap,
  abilityMap,
  composition,
  bossIds
)
```

worker 侧（`top100Sync.ts` / `routes/fflogs.ts`）暂不传 `bossIds`（TOP100 参考数据不需要此初值）；
如需后续可同款接入。

## 测试

`src/utils/mitigationCalculator.test.ts`（或同目录新增）：

- 开关关闭：含 boss 状态（如雪仇）的场景下，该状态不计入 multiplier；`finalDamage` 高于开关开启时；
  `appliedStatuses` 不含该状态。
- 开关开启/省略：行为与现状 1:1（回归），boss 状态正常计入。
- 多坦（tankbuster）路径：雪仇在关闭时对每个坦克分支都被正确抑制。
- 非 boss 的 partywide 状态（如真言 `['partywide']`）不受开关影响，照常生效。

`src/utils/timelineFormat.test.ts`：

- `targetMitigationDisabled: true` 经 `toV2` → `fromV2` 往返保持；省略时往返仍为省略（不被写成 `false`）。

`src/utils/fflogsImporter.test.ts`：

- `buildBossIds`：`type==='Boss'` 主信号；空时 fallback 名称匹配 / 单一敌人 / 同名扩展；全空返回空 Set。
- `parseDamageEvents`：boss 来源事件不置位（字段省略）；非 boss 来源事件置 `targetMitigationDisabled=true`；
  `bossIds` 为空或未传时所有事件均不置位（默认生效，回归）；来源未知（sourceId=0）时不置位。

## 实现顺序

1. 数据模型：`MitigationCategory` 加 `'boss'`；标注 4 个 action；`DamageEvent` 加字段。
2. 计算引擎：`runSingleBranch` Phase 1 跳过判断 + 单测。
3. 导入自动判定：`buildBossIds` + `parseDamageEvents` 接入 `bossIds` + `ImportFFLogsDialog` 接线 + 单测。
4. 持久化：V2 + 剪贴板接入 `tmd` + 往返单测。
5. UI：PropertyPanel Switch 接 `updateDamageEvent`。
6. 全量 `pnpm test:run` + `pnpm lint` + `pnpm exec tsc --noEmit`。
