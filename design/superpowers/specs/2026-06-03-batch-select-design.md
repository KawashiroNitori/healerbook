# 时间轴编辑器批量框选 — 设计文档

> 日期：2026-06-03 · 分支：`feat/batch-select`

## 目标

在 React-Konva 时间轴画布编辑器中支持「批量框选」：拉出矩形虚线选框选中其覆盖范围内的伤害事件、技能 cast、注释；多选后可整体拖动、批量删除。表格视图（TimelineTable）不改动。

## 需求拆解（来自用户）

1. 工具栏增加选择模式切换：① 现状的「按住拖动平移时间轴本身」；② 「按住拖出矩形虚线选框」，松手时选中被框住的对象。
2. 选中多个对象时**不弹**伤害事件详情面板；按住其中任一被选对象拖动时，所有被选对象一起移动。
3. 选中多个对象时，右键菜单**只有删除**；点击删除（或删除快捷键）删除所有被选对象。
4. **无论何种模式**，在最上方时间标尺处拖动 = 「无限高度的矩形选框」，即选中鼠标拖动时间范围内的所有对象。
5. 表格模式不支持批量选择，不改动。
6. （追加）支持批量选中对象的**复制粘贴**。

## 已确认的设计决策

- **框选判定**：相交即选中（对象与选框有任意重叠即选中），与「时间标尺=按时间范围相交」语义一致。
- **修饰键**：支持 `Shift` 框选叠加（与已有选择求并集）；支持 `Ctrl`/`Cmd` 点击逐个切换某对象的选中状态。
- **批量拖动约束**：整体等距平移（所有选中对象施加同一时间增量 `delta`），各自在其既有时间下界夹紧（伤害事件 `≥ 0`、cast / 注释 `≥ TIMELINE_START_TIME`，与各类型现有单体编辑一致）；技能即便落到资源/CD 非法位置也允许，非法性由既有阴影/校验机制事后提示。
- **注释纳入选择**：注释与伤害事件、技能 cast 同等参与框选/批量拖动/批量删除。
- **只读模式**：不启用批量选择（工具切换隐藏、批量改/删禁用），与既有 `draggable` 受 `isReadOnly` 约束一致。
- **协作 awareness**：广播**全部**选中对象，队友能看到对方的多选高亮。
- **复制粘贴入口**：键盘为主（`Ctrl/Cmd+C` / `Ctrl/Cmd+V`），同时多选右键菜单增加「复制」、空白处右键菜单增加「粘贴」。
- **粘贴定位**：以鼠标悬浮时间为锚，被复制组中**最早**对象对齐到该时间，组内各对象保留原有相对时间间距。
- **复制范围**：覆盖三类对象（伤害事件 / 技能 cast / 注释）；粘贴后自动选中新建对象。
- **系统剪贴板 + 跨页面（只写 web 自定义格式）**：复制用 `navigator.clipboard.write` 写一个 `ClipboardItem`，**仅含** web 自定义格式 `web application/x-healerbook-timeline+json`（结构化 JSON），**不写** `text/plain` 摘要。→ 外部应用（文本框 / 聊天 / Word）粘贴拿不到任何文本(自定义格式对原生应用不可见)，**零污染**；本应用用 `navigator.clipboard.read()` 读回该自定义格式，支持跨标签页 / 跨时间轴。**不做应用内本地缓存回退**——完全依赖系统剪贴板；浏览器不支持读自定义格式 / 无权限时，粘贴失败并 toast 提示。
- **跨时间轴职业映射**：粘贴到小队配置不同的目标时间轴时，技能 cast 与 `skillTrack` 注释按**职业**映射到目标轨道——复用 `src/utils/importAdapter.ts` 的 `buildPlayerIdMap(sourceComposition, currentComposition)`（按 job 分桶、组内按出现顺序一一映射）。映射不到（目标缺该职业 / 同职业人数不足）或 `actionId` 不在技能注册表的对象 → 跳过并 toast 跳过数量；伤害事件与 `damageTrack` 注释始终粘贴。职业阵容相同时按职业一一落回原玩家、全部保留（V2 把 playerId 归一为职业槽位，粘贴恒走此映射，详见第 6 节）。

## 涉及的对象与坐标

三类可批量选择对象（均有「时间」字段，x 由 `time * zoomLevel` 决定）：

| 对象      | 类型/字段        | 时间字段    | y 归属                                                              |
| --------- | ---------------- | ----------- | ------------------------------------------------------------------- |
| 伤害事件  | `DamageEvent.id` | `time`      | 顶部固定区伤害轨带                                                  |
| 技能 cast | `CastEvent.id`   | `timestamp` | 主体区对应 `playerId` 轨道行                                        |
| 注释      | `Annotation.id`  | `time`      | `anchor=damageTrack` → 伤害轨带；`anchor=skillTrack` → 对应技能轨行 |

坐标换算（既有）：`x = time * zoomLevel`，`time = (pixelX + scrollLeft) / zoomLevel`，`TIMELINE_START_TIME = -30`。顶部 Stage 仅横向滚动；主体 Stage 横纵向滚动（需用 `scrollTop` 修正 y）。

## 架构改动

### 1. 状态层

**`uiStore`（持久化 UI 偏好）** 新增：

```ts
canvasTool: 'pan' | 'select'   // 画布工具模式，默认 'pan'，持久化
setCanvasTool: (t: 'pan' | 'select') => void
```

**`timelineStore`（ephemeral 选中态，不进协作 doc）**：单选升级为多选，单选作为「数组长度为 1」的特例派生。

```ts
selectedEventIds: string[]
selectedCastEventIds: string[]
selectedAnnotationIds: string[]
```

- 保留派生的 `selectedEventId` / `selectedCastEventId`：**仅当总选中数 == 1 且该类型恰好选中 1 个**时取对应 id，否则 `null`。→ `PropertyPanel` 维持「`selectedEventId` 存在才渲染」，天然满足需求 2「多选不弹面板」，无需改 Panel。
- 各对象的 `isSelected` 改为「是否在对应数组内」，驱动高亮与 `draggable`。

**新增 selection actions：**

| action                                                     | 语义                              |
| ---------------------------------------------------------- | --------------------------------- |
| `setSelection({eventIds?, castEventIds?, annotationIds?})` | 替换整组选择                      |
| `addToSelection({...})`                                    | Shift 框选：与现有选择求并集      |
| `toggleSelection(kind, id)`                                | Ctrl/Cmd 点击：切换单个对象选中态 |
| `clearSelection()`                                         | 清空                              |

既有 `selectEvent/selectCastEvent` 改为「写多选数组的单选」实现。所有 selection action 末尾把全量选择写入 awareness（见第 5 节）。

**新增批量操作**（均以单个 `engine.doc.transact()` 包裹 → UndoManager 视作一步，复用既有 `yUpdate*/yRemove*` mutator，docSchema 无需新增函数）：

- `bulkMoveSelection(delta: number)`：对选中的伤害事件 `time += delta`、技能 `timestamp += delta`、注释 `time += delta`，各自按既有下界夹紧（伤害事件 `Math.max(0, …)`、cast / 注释 `Math.max(TIMELINE_START_TIME, …)`），一个事务内完成。
- `bulkDeleteSelection()`：一个事务内删除全部选中的三类对象，随后 `clearSelection()`。

### 2. 工具栏切换（`EditorToolbar`）

新增两态图标 toggle：**拖动平移**（手型，默认）↔ **框选**（虚线矩形），读写 `uiStore.canvasTool`。表格模式下与缩放滑块一样禁用/隐藏；只读模式隐藏。

### 3. 画布交互（核心）

**pointerdown 意图判定**（改 `useTimelinePanZoom` + 新增 `useMarqueeSelection`）：

| 起点 / 模式                    | 行为                                                                      |
| ------------------------------ | ------------------------------------------------------------------------- |
| 时间标尺区域（任意模式）       | 无限高度框选：仅按时间范围 `[x0,x1]` 选中范围内**所有**三类对象（需求 4） |
| select 模式，落在已选中对象上  | 交给对象的 group 拖动                                                     |
| select 模式，落在空白/未选对象 | 拉出矩形虚线选框                                                          |
| pan 模式，空白拖动             | 维持现状：平移时间轴                                                      |
| 任意模式，单击对象（不拖）     | 单选该对象；`Ctrl/Cmd` → 切换；`Shift` → 并集                             |
| select 模式，单击空白（不拖）  | `clearSelection()`                                                        |

**选框 hit-test（相交即选中）**：松手时把选框矩形转换到「世界坐标」，与每个对象的包围盒做矩形相交判定。顶部固定区对象只需修正 `scrollLeft`；主体区对象需修正 `scrollLeft` 与 `scrollTop`。无限高度框选忽略 y、只比时间范围，因而能横跨「顶部伤害区 + 下方技能区」一并选中。`Shift` 时 `addToSelection`，否则 `setSelection`。

**选框渲染**：在 overlay layer 渲染一个 dashed `Rect` 跟随指针；性能遵循项目约定 `perfectDrawEnabled={false}`、`shadowEnabled={false}`。

**批量拖动**：拖动任一选中对象时，`onDragMove` 以命令式（imperative，沿用项目「拖动期间直接操作 Konva 节点、绕过 React 渲染」的性能风格）把其余选中节点同步平移 `dx`；`onDragEnd` 计算 `delta = 新时间 - 原时间`，调 `bulkMoveSelection(delta)` 一次性提交并复位临时位移。整体等距平移、仅 t=0 夹紧，不改轨道 / `playerId`。

> 降级方案：若跨 Stage 的命令式实时同步成本过高，可退化为「仅抓取的那个对象跟手、松手时其余按 `delta` 归位」。

### 4. 右键菜单 & 删除（需求 3）

- `TimelineContextMenu` 新增 `multiSelection` 变体：两项「**复制（N 项）**」→ `copySelection()`、「**删除（N 项）**」→ `bulkDeleteSelection()`。右键命中的对象若属于当前多选 → 弹此菜单；若不属于 → 维持现状的单对象菜单。
- 空白处右键菜单（`damageTrackEmpty`、`skillTrackEmpty`）在编辑模式下显示「**粘贴**」，但**仅当系统剪贴板含本格式时才启用**：菜单打开时（右击是用户手势）异步探测 `navigator.clipboard.read()`，检查是否存在 `item.types` 含 `MIME` 的项（只看 `types`、不调 `getType`，尽量少读）。探测态 `pasteAvailable: 'checking' | true | false` 存本地 state——`'checking'` / `false` 时「粘贴」置灰，`true` 时启用。点击启用的「粘贴」→ 以 `menu.time` 为锚执行 `pasteClipboard`。既有 `damageTrackEmpty` 的单事件「粘贴」并入此组粘贴逻辑。
  > 取舍：探测会在每次打开菜单时触发一次剪贴板读取，可能弹 `clipboard-read` 授权 / 在 Safari 显示粘贴按钮——已确认接受。键盘 `Ctrl/Cmd+V` 路径不预探测，直接读取+校验+失败 toast。
- `delete` / `backspace` 快捷键：若存在多选（三类合计 > 0）→ `bulkDeleteSelection()`；否则走既有单项 / 注释（`pinnedAnnotationId`）逻辑。

### 5. 协作 awareness

`awarenessTypes.ts` 的 `selection` 字段由 `{ eventId, castEventId }` 改为：

```ts
selection: { eventIds: string[]; castEventIds: string[]; annotationIds: string[] }
```

消费端（`Timeline/index.tsx`、`SkillTracksCanvas.tsx`、`useSmoothedPeers.ts` 等读取 peer `selection` 处）改为按数组渲染队友的多选高亮。本地 selection action 每次更新后写入全量选择。

### 6. 复制 / 粘贴（批量，需求 6）

**剪贴板载荷格式 —— 复用 V2 分享格式 codec**（`src/utils/timelineFormat.ts` 的 `toV2` / `hydrateFromV2`）。载荷在 V2 外包一层标识 + 版本：

```ts
interface TimelineClipboard {
  __healerbook__: 'timeline-clipboard' // 标识字段，read() 后据此识别
  version: 1
  v2: V2Timeline // toV2(合成子集 Timeline) 的产物；已含 composition(职业槽位) + 三类对象
}
```

> 复用理由：`hydrateFromV2` 反序列化时**自动重新生成所有 id**、还原 composition、重建注释锚定；V2 自带版本与 V1→V2 迁移，适合"过夜"的剪贴板内容。`composition` 与各对象字段都由 V2 携带，无需单列；`baseTime` 在粘贴时由 hydrate 出的对象现算。

**存取（只写 web 自定义格式，无本地缓存回退）**，自定义格式常量 `MIME = 'web application/x-healerbook-timeline+json'`：

- 复制：
  ```ts
  const blob = new Blob([JSON.stringify(payload)], { type: MIME })
  await navigator.clipboard.write([new ClipboardItem({ [MIME]: blob })]) // 仅此一种格式，不写 text/plain
  ```
- 粘贴：`const items = await navigator.clipboard.read()`，找到 `item.types` 含 `MIME` 的项 → `await item.getType(MIME)` → `blob.text()` → `JSON.parse` → 校验 `__healerbook__` 标识。成功则执行粘贴；读取失败 / 无权限 / 浏览器不支持自定义格式 / 无本格式项 → 不粘贴并 toast 提示（无本地缓存回退）。粘贴流程因此**异步化**。
- 外部应用复制来的普通文本不含 `MIME` 项 → 我们忽略、不误粘；本应用复制的数据在外部应用粘贴为空（无 text/plain），不污染。
- 与伤害事件专属的「复制文本」（写 `text/plain` 到系统剪贴板，另一功能）互不影响。

**复制 `copySelection()`**：拼一个只含选中子集的合成 Timeline——`{ ...timeline, damageEvents: 选中伤害事件, castEvents: 选中 cast, annotations: 选中注释, syncEvents: [] }`（其余字段如 `encounter/name/composition` 沿用源时间轴），`v2 = toV2(subset)`，包成 `payload`，写系统剪贴板。单选（数量 1）同样走此路径。

**粘贴 `pasteClipboard(targetTime)`**：

1. **反序列化**：`const hydrated = hydrateFromV2(payload.v2)` → 得到带**新 id**、还原 composition、注释锚定的 `damageEvents / castEvents / annotations`。`baseTime = min(三类对象的 time/timestamp)`。
2. **职业映射**：`map = buildPlayerIdMap(hydrated.composition, currentTimeline.composition)`（复用 `importAdapter.ts`）。注意 V2 已把 playerId 归一为「职业槽位索引」，故**即便同页 / 同时间轴粘贴**，hydrate 出的 playerId 也是槽位索引、需经此映射按职业顺序落回当前真实 playerId（职业阵容相同时即一一落回原玩家）。
3. **逐对象处理**（`newTime = targetTime + (origTime - baseTime)`，按既有下界夹紧：伤害事件 `≥ 0`、cast / 注释 `≥ TIMELINE_START_TIME`）：
   - 伤害事件：始终保留，仅平移时间。
   - 技能 cast：`playerId` 经 `map` 重映射；映射缺失或 `actionId` 不在技能注册表 → 跳过计数。**不**套用导入流程 `validateCastsForImport` 的 CD/资源合法性丢弃——与第 3 节「批量拖动允许落到非法位置、由阴影/校验事后提示」保持一致。
   - 注释：`damageTrack` 锚定始终保留；`skillTrack` 锚定的 `playerId` 经 `map` 重映射，映射缺失则跳过。
4. **写入**：保留 / 重映射后的三类对象在**单个 `engine.doc.transact()`** 内一次性写入（扩展既有 `bulkImport` 使其支持 annotations，或新增专用 paste action；记录最终落库 id 供选中），UndoManager 视作一步。
5. **善后**：`setSelection` 选中新建对象便于接着拖动；若有跳过对象 toast 提示数量。

**触发**：

- `Ctrl/Cmd+C` → `copySelection()`（替换现有「仅复制单个伤害事件」的 `mod+c` 处理）。
- `Ctrl/Cmd+V` → 以 `hoverTimeRef`（无则视口中央）为 `targetTime` 执行 `pasteClipboard`（替换现有单事件 `mod+v`）。
- 右键菜单见第 4 节。
- 只读模式禁用复制粘贴（与现有 `enabled: !isReadOnly` 一致）。

## 不在本次范围

- 表格视图（TimelineTable）的批量选择 —— 需求 5 明确不做。
- 跨 phase 的批量拖动 / 删除（复制粘贴可跨时间轴，但拖动/删除仍限当前时间轴当前视图）。
- 批量「修改属性」（仅支持批量移动时间、批量删除、批量复制粘贴）。

## 测试要点

- store 单测：`setSelection/addToSelection/toggleSelection/clearSelection` 的并集与切换语义；`bulkMoveSelection` 的等距平移 + 下界夹紧；`bulkDeleteSelection` 的三类删除 + 清空；批量操作为单一 undo 步。
- 派生单选：选中数为 1 时 `selectedEventId` 正确、>1 时为 `null`（保证面板不弹）。
- hit-test：相交判定、无限高度框选只比时间范围、主体区 `scrollTop` 修正。
- 复制粘贴：`copySelection` 拼合成子集 Timeline → `toV2` → 带 `__healerbook__`/`version` 包装；粘贴 `hydrateFromV2` 还原（新 id、composition、注释锚定），`baseTime` 取 hydrate 后三类对象时间最小值。
- 粘贴职业映射：同 composition → 恒等映射全部保留；目标缺职业 → 对应 cast / skillTrack 注释跳过并计数；damageTrack 注释与伤害事件始终保留；`actionId` 不在注册表 → 跳过。
- 粘贴落位：保留相对间距、最早对象对齐 `targetTime`、下界夹紧、新 id、粘贴后选中新对象、为单一 undo 步；CD 非法的 cast 仍粘贴（不丢弃）。
- 系统剪贴板：复制只写 `MIME` 自定义格式、不写 `text/plain`；读不到 `MIME` 项 / `read()` 失败时 toast 提示且不粘贴（无本地缓存回退，mock `navigator.clipboard.write`/`read`）；外部普通文本不被误识别为可粘贴数据。
- 菜单粘贴探测：打开菜单时 `pasteAvailable` 由 `'checking'` 过渡到 `true`（剪贴板含 `MIME`）/ `false`（不含或读取失败）；置灰态不可点击。
