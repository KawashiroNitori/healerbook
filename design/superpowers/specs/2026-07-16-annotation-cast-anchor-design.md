# 备注锚定到技能使用（cast anchor）设计

> 分支 `feat/annotation-v2`。为备注新增一种「锚定到某一次具体技能使用（CastEvent）」的类型，备注随该 cast 移动而移动、随其删除而删除，并在时间轴视图与表格视图有专属渲染。

## 背景与动机

当前备注（`Annotation`）支持两种锚定（`src/types/timeline.ts:262`）：

```ts
export type AnnotationAnchor =
  | { type: 'damageTrack' }
  | { type: 'skillTrack'; playerId: number; actionId: number }
```

两者本质都是**坐标锚定**：X 由 `Annotation.time`（秒）线性换算，Y 由轨道归属决定。`skillTrack` 锚定的是「哪个玩家的哪条技能轨道」，**不是某一次具体使用**。因此把某次 cast 拖到别处或删除时，备注不会跟随、也不会消失，只停在原时间点。

用户需要：**备注能挂在某一次具体的技能使用上，并跟随它移动、随它删除而删除。**

### 稳定 id 的现状（关键事实）

要稳定引用「某一次 cast」，必须有稳定标识。核查后结论分层：

| 路径                                                                                                            | cast id 是否稳定                                             |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 协作编辑会话（Yjs doc，Durable Object SQLite 原生存储，`src/collab/docSchema.ts` cast 以 `ev.id` 为 Y.Map key） | ✅ 稳定，doc 存活期内恒定                                    |
| 公开读 / viewer 快照（KV `healerbook_snapshots`，内容是 `projectTimeline(doc)` 投影）                           | ✅ 稳定，带 live Yjs id                                      |
| 发布 seed（客户端 `Y.encodeStateAsUpdate` → DO）                                                                | ✅ 传 Yjs 二进制更新，非 V2                                  |
| **V2 序列化**（本地未发布时间轴存 localStorage、导出、剪贴板复制；`src/utils/timelineFormat.ts`）               | ❌ 不落盘，`fromV2CastEvents` 用 `generateObjectId()` 重生成 |

即：协作/发布链路上 cast id 已经稳定，特性地基现成。**唯一缺口是 V2 序列化边界**——服务于 `local` 模式与导出/复制，往返后 cast id 重生成、cast 锚定会断链。本设计需补上这个洞。

## 数据模型

### 运行时类型（`src/types/timeline.ts`）

`AnnotationAnchor` 新增第三种：

```ts
export type AnnotationAnchor =
  | { type: 'damageTrack' }
  | { type: 'skillTrack'; playerId: number; actionId: number }
  | { type: 'cast'; castId: string } // 🆕 锚到某一次具体 cast
```

`Annotation.time` 语义分化：

- 对 `damageTrack` / `skillTrack`：仍是**权威坐标**，行为不变。
- 对 `cast`：**不再权威**。渲染与交互一律实时从被引用的 `CastEvent.timestamp` 读取位置；`time` 仅作创建时的冗余快照，不参与定位。这样「跟随移动」无需任何额外同步逻辑——cast 的 timestamp 变了，备注位置自然跟着变。

### 渲染定位推导

- X = 被引用 `cast.timestamp * zoomLevel`。
- Y = 该 cast 所在技能轨道行（`playerId + actionId`，经现有 `trackIndexMap.get(trackKey(...))`）。
- 再叠加一个固定像素偏移，使气泡落在技能图标**右上角**（见「渲染」）。

若 `castId` 指向的 cast 不存在（理论上被 sanitizer/级联删除清掉，不应长期出现），该备注不渲染。

## 渲染

### 时间轴（Canvas）视图

- cast 锚定备注的气泡图标（`AnnotationIcon`）悬挂在**技能图标右上角**——相对 cast 图标做固定像素偏移，而非像坐标备注那样落在轨道基线中心。
- 位置完全由被引用 cast 推导，cast 移动 → 备注跟随。
- **锁定不可拖**：`AnnotationIcon` 对 cast 锚定禁用 `draggable`（无 `dragBoundFunc`、不接 drag 回调）。
- hover / pin 只读气泡、点击编辑、右键删除等复用现有备注交互。

### 表格视图

- cast 锚定备注**不占独立行**（不走 `AnnotationRow`），而是作为**角标**渲染在 cast marker 单元格（`src/components/TimelineTable/TableDataRow.tsx:240` 一带的技能图标 `SkillIcon`）的**右上角**。
- 坐标锚定（damageTrack / skillTrack）备注**仍走 `AnnotationRow` 独立行**，行为完全不变。

## 交互

### 创建

- 右键技能图标触发的 `castEvent` 上下文菜单（`src/components/Timeline/index.tsx:1209` 的 `handleContextMenu` payload `type: 'castEvent'`）新增一项「在此技能上添加备注」。
- 选中后创建 `{ type: 'cast', castId }` 备注；`time` 取该 cast 当前 `timestamp` 作快照（不参与后续定位）。
- 复用现有 `editingAnnotation` 编辑弹窗（`AnnotationPopover`）录入文本。

### 编辑 / 删除

- 编辑：沿用现有 popover，只改 `text`。
- 删除：沿用现有右键删除 / 批量删除。

## 生命周期 / 协作 / 持久化

### 级联删除

- 删除某次 cast 时（`yRemoveCastEvent`，`src/collab/docSchema.ts:154`），在同一 mutator 内一并删除所有满足 `anchor.type === 'cast' && anchor.castId === 该 cast id` 的备注。

### 读路径 sanitizer

- 现有 sanitizer（`projectTimeline`，`docSchema.ts:258` 一带）会丢弃引用了不存在玩家的孤儿 cast / skillTrack 备注。新增对应规则：丢弃 `castId` 指向已不存在 cast 的孤儿 cast 备注，兜底 V2 旧存档与协作竞态。

### 换阵容

- `yReplaceComposition`（`docSchema.ts:195`）移除玩家时，其 cast 被级联清除；关联的 cast 备注随「级联删除」逻辑一并清除，无需额外分支（但需确保清 cast 的路径复用同一套备注级联，或在换阵容清理里显式带上）。

### V2 补洞（必须）

让 cast 锚定穿过 localStorage / 导出 / 剪贴板往返：

- `V2CastEvents`（`src/types/timelineV2.ts:81`）新增一列 `i: string[]`（cast 稳定 id，与 `a[]/t[]/p[]` 同序对齐）。
  - `toV2CastEvents` 落盘 `i`。
  - `fromV2CastEvents` 优先复用 `i[k]`；缺失（旧存档无该列）时才 `generateObjectId()`。
- `V2AnnotationAnchor`（`src/types/timelineV2.ts:91`，现为 `0 | [playerId, actionId]`）扩展表达 cast 锚定的一种形态（如元组 `[3, castId]` 或对象 `{ c: castId }`，实现时择一并在 `toV2Annotation` / `fromV2Annotation` 双向映射）。
- 向后兼容：旧存档无 `i` 列时，cast id 重生成，旧存档里本就没有 cast 锚定备注，故新特性对旧档不追溯、坐标备注不受影响。

## 影响文件（预估）

| 文件                                            | 改动                                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `src/types/timeline.ts`                         | `AnnotationAnchor` 加 `cast` 分支；补 `Annotation.time` 文档说明语义分化                         |
| `src/types/timelineV2.ts`                       | `V2CastEvents` 加 `i`；`V2AnnotationAnchor` 扩展                                                 |
| `src/utils/timelineFormat.ts`                   | `toV2CastEvents`/`fromV2CastEvents` 处理 `i`；`toV2Annotation`/`fromV2Annotation` 处理 cast 锚定 |
| `src/collab/docSchema.ts`                       | `yRemoveCastEvent` 级联删备注；sanitizer 丢孤儿 cast 备注；换阵容清理                            |
| `src/components/Timeline/index.tsx`             | cast 备注分组、右上角偏移定位、创建入口、禁拖                                                    |
| `src/components/Timeline/AnnotationIcon.tsx`    | 支持 cast 锚定（禁 draggable、右上角偏移）                                                       |
| `src/components/Timeline/SkillTracksCanvas.tsx` | 渲染 cast 锚定备注                                                                               |
| `src/components/TimelineTable/TableDataRow.tsx` | cast marker 单元格右上角角标                                                                     |
| `src/components/TimelineTable/index.tsx`        | cast 备注从 `AnnotationRow` 独立行剔除，改走角标                                                 |
| 右键菜单组件                                    | `castEvent` 菜单加「在此技能上添加备注」                                                         |

## 明确不做（YAGNI）

- 拖拽创建 / 拖拽重锚到另一 cast。
- cast 备注删除后降级为坐标锚定 / 保留为孤立备注。
- cast 备注独立的时间编辑。
- 对旧 V2 存档的 cast id 追溯还原。

## 测试要点

- V2 往返（`toV2`→`fromV2`）后 cast id 与 cast 锚定备注保持关联。
- 移动 cast → 备注位置跟随（两视图）。
- 删除 cast → 关联备注级联删除。
- 换阵容移除玩家 → 其 cast 备注被清。
- sanitizer 丢弃指向不存在 cast 的孤儿备注。
- 旧 V2 存档（无 `i` 列）正常加载，坐标备注不受影响。
- 表格视图：cast 备注为角标、不占独立行；坐标备注仍独立行。
