# 备注锚定到技能使用（cast anchor）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为备注新增一种「锚定到某一次具体技能使用（CastEvent）」的类型，备注随该 cast 移动而移动、随其删除而级联删除，并在时间轴视图与表格视图渲染在技能图标右上角。

**Architecture:** 复用已有稳定的 `CastEvent.id`（Yjs Y.Map key）作为锚点；新增 `AnnotationAnchor` 的 `cast` 分支只存 `castId`，位置在渲染时实时从被引用 cast 推导（天然跟随移动）。补齐 V2 序列化对 cast id 的持久化，使锚定穿过 localStorage / 导出 / 剪贴板往返。协作层通过级联删除 + 读路径 sanitizer 保证不产生孤儿。

**Tech Stack:** React 19 + TypeScript 5.9、React-Konva（画布）、Zustand 5、Yjs（CRDT 协作）、Vitest 4。设计文档见 `design/superpowers/specs/2026-07-16-annotation-cast-anchor-design.md`。

## Global Constraints

- 包管理器必须用 **pnpm**。
- 命名用 `action` 不用 `skill`；英文标识符 `annotation`/`Annotation` 保留不改。
- 面向用户的中文一律用「备注」，不用「注释」（「注释」仅保留给代码 comment 含义）。
- 提交信息 / 作者 / Co-Authored-By **禁止**出现「claude」（大小写不敏感），`.husky/commit-msg` 会拒绝。
- 不得用 `-c commit.gpgsign=false` / `--no-gpg-sign` 跳过签名。
- 声称任务「完成」前必跑：`pnpm exec tsc --noEmit`、`pnpm lint`、`pnpm test:run`。
- 状态不可变更新；Konva 组件保持 `shadowEnabled={false} perfectDrawEnabled={false}`。
- 内部笔记（spec/plan/design）必须放在 `design/` 下，不能进 `docs/`（VitePress 发布，禁含 superpowers/spec/plan/design 关键词）。

---

## File Structure

**修改：**

- `src/types/timeline.ts` — `AnnotationAnchor` 加 `cast` 分支。
- `src/types/timelineV2.ts` — `V2CastEvents` 加 `i`；`V2AnnotationAnchor` 加 cast 形态。
- `src/utils/timelineFormat.ts` — cast id 落盘/复用；annotation cast 锚定双向映射。
- `src/collab/docSchema.ts` — `yRemoveCastEvent` / `yReplaceComposition` 级联删除；`projectTimeline` sanitizer。
- `src/components/Timeline/TimelineContextMenu.tsx` — castEvent 菜单加「在此技能上添加备注」。
- `src/components/Timeline/index.tsx` — 创建时解析 cast 时间快照；备注分组；popover 基准位置；框选。
- `src/components/Timeline/SkillTracksCanvas.tsx` — cast 锚定备注渲染块（右上角、禁拖）。
- `src/utils/tableCellHitTest.ts` — `CastMarker` 加 `castId`。
- `src/components/TimelineTable/index.tsx` — 拆分备注（非 cast 走行、cast 走角标）。
- `src/components/TimelineTable/TableDataRow.tsx` — marker 单元格渲染角标。
- `src/utils/soumaExporter.ts` — cast 锚定按绑定技能导出。
- `src/utils/timelineClipboard.ts` — 粘贴时丢弃 cast 锚定（计入 skipped）。

**测试文件（修改现有）：**

- `src/utils/timelineFormat.test.ts`、`src/collab/docSchema.test.ts`、`src/utils/soumaExporter.test.ts`、`src/utils/tableRows.test.ts`。

---

## Task 1: 数据模型 + V2 持久化 cast id

**Files:**

- Modify: `src/types/timeline.ts:262-280`
- Modify: `src/types/timelineV2.ts:81-100`
- Modify: `src/utils/timelineFormat.ts:142-160`（toV2）、`:299-323`（fromV2）
- Test: `src/utils/timelineFormat.test.ts`

**Interfaces:**

- Produces:
  - `AnnotationAnchor` 新增 `{ type: 'cast'; castId: string }`。
  - `V2CastEvents.i?: string[]`（cast 稳定 id 列，与 `a/t/p` 同序）。
  - `V2AnnotationAnchor` 新增 `{ c: string }`。
  - `toV2CastEvents` 输出含 `i`；`fromV2CastEvents` 优先复用 `i[k]`。
  - `toV2Annotation` / `fromV2Annotation` 双向映射 cast 锚定。

- [ ] **Step 1: 更新现有 roundtrip 测试断言（先让它反映新契约）**

`src/utils/timelineFormat.test.ts` 的 `makeEditorTimeline()` 的 `annotations` 数组（第 60-68 行）追加一条 cast 锚定备注：

```ts
      {
        id: 'e6',
        text: '这一发要点名',
        time: 8,
        anchor: { type: 'cast', castId: 'e3' },
      },
```

再把 `v2.ce` / `v2.an` 断言（第 87-94 行）改为：

```ts
expect(v2.ce).toEqual({
  a: [7432, 7433],
  t: [5, 8],
  p: [2, 3],
  i: ['e2', 'e3'],
})
expect(v2.an).toHaveLength(3)
expect(v2.an?.[0]).toMatchObject({ x: 'remind', t: 20, k: 0 })
expect(v2.an?.[1]).toMatchObject({ x: 'WHM 礼仪', t: 25, k: [2, 7432] })
expect(v2.an?.[2]).toMatchObject({ x: '这一发要点名', t: 8, k: { c: 'e3' } })
```

并把 hydrate 段的备注断言（第 118-124 行）改为：

```ts
expect(back.annotations).toHaveLength(3)
expect(back.annotations[0].anchor).toEqual({ type: 'damageTrack' })
expect(back.annotations[1].anchor).toEqual({
  type: 'skillTrack',
  playerId: 2,
  actionId: 7432,
})
expect(back.castEvents.find(c => c.timestamp === 8)?.id).toBe('e3')
expect(back.annotations.find(a => a.text === '这一发要点名')?.anchor).toEqual({
  type: 'cast',
  castId: 'e3',
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test:run timelineFormat`
Expected: FAIL —— 类型上 `{ type: 'cast', castId }` 不合法 / `v2.ce` 无 `i` / `k` 无 `{c}` 形态。

- [ ] **Step 3: 扩展运行时类型**

`src/types/timeline.ts`，把 `AnnotationAnchor`（第 264-266 行）改为：

```ts
export type AnnotationAnchor =
  | { type: 'damageTrack' }
  | { type: 'skillTrack'; playerId: number; actionId: number }
  | { type: 'cast'; castId: string }
```

并把 `Annotation.time` 字段说明（第 272-274 行一带）更新为：

```ts
/**
 * 锚定时间（秒，相对战斗起点）。
 * 对 damageTrack / skillTrack 为权威坐标；对 cast 锚定不参与定位（位置实时从
 * 被引用 CastEvent.timestamp 推导），仅作创建时的冗余快照。
 */
time: number
```

- [ ] **Step 4: 扩展 V2 类型**

`src/types/timelineV2.ts`，`V2CastEvents`（第 81-88 行）加 `i`：

```ts
export interface V2CastEvents {
  /** actionId 列 */
  a: number[]
  /** timestamp 列 */
  t: number[]
  /** playerId 列 */
  p: number[]
  /** cast 稳定 id 列（与 a/t/p 同序）；旧存档缺省，读入时重生成 */
  i?: string[]
}
```

`V2AnnotationAnchor`（第 90-91 行）加 cast 形态：

```ts
/** Annotation anchor：0=damageTrack，[playerId, actionId]=skillTrack，{c: castId}=cast */
export type V2AnnotationAnchor = 0 | [number, number] | { c: string }
```

- [ ] **Step 5: toV2 落盘 cast id + cast 锚定**

`src/utils/timelineFormat.ts`，`toV2CastEvents`（第 142-149 行）改为：

```ts
function toV2CastEvents(events: CastEvent[], remap: Map<number, number>): V2CastEvents {
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp)
  return {
    a: sorted.map(e => e.actionId),
    t: sorted.map(e => e.timestamp),
    p: sorted.map(e => remap.get(e.playerId) ?? e.playerId),
    i: sorted.map(e => e.id),
  }
}
```

`toV2Annotation`（第 151-160 行）改为：

```ts
function toV2Annotation(a: Annotation, remap: Map<number, number>): V2Annotation {
  let k: V2Annotation['k']
  if (a.anchor.type === 'damageTrack') k = 0
  else if (a.anchor.type === 'cast') k = { c: a.anchor.castId }
  else k = [remap.get(a.anchor.playerId) ?? a.anchor.playerId, a.anchor.actionId]
  return { x: a.text, t: a.time, k }
}
```

- [ ] **Step 6: fromV2 复用 cast id + cast 锚定**

`src/utils/timelineFormat.ts`，`fromV2CastEvents`（第 299-312 行）的 `id` 行改为复用 `ce.i`：

```ts
out[i] = {
  id: ce.i?.[i] ?? generateObjectId(),
  // 读取归一：旧文档持久化的子变体 id 读入即归一为 trackGroup 父 id（变体运行时推导）
  actionId: normalizeActionId(ce.a[i]),
  timestamp: ce.t[i],
  playerId: ce.p[i],
}
```

`fromV2Annotation`（第 314-323 行）改为：

```ts
function fromV2Annotation(a: V2Annotation): Annotation {
  let anchor: Annotation['anchor']
  if (a.k === 0) anchor = { type: 'damageTrack' }
  else if (Array.isArray(a.k)) anchor = { type: 'skillTrack', playerId: a.k[0], actionId: a.k[1] }
  else anchor = { type: 'cast', castId: a.k.c }
  return {
    id: generateObjectId(),
    text: a.x,
    time: a.t,
    anchor,
  }
}
```

- [ ] **Step 7: 运行测试确认通过**

Run: `pnpm test:run timelineFormat`
Expected: PASS（全部）。

- [ ] **Step 8: 补一条向后兼容测试（旧存档无 `i`）**

在 `src/utils/timelineFormat.test.ts` 的 `describe('toV2 / hydrateFromV2 ...')` 内追加：

```ts
it('旧 V2 存档缺 i 列时 cast id 重新发号且不崩', () => {
  const tl = makeEditorTimeline()
  const v2 = toV2(tl)
  delete (v2.ce as { i?: string[] }).i // 模拟旧存档
  const back = hydrateFromV2(v2, { id: 'tl_xxx' })
  expect(back.castEvents).toHaveLength(2)
  expect(back.castEvents[0].id).toBeTruthy()
  expect(back.castEvents[1].id).not.toBe(back.castEvents[0].id)
})
```

- [ ] **Step 9: 运行测试确认通过**

Run: `pnpm test:run timelineFormat`
Expected: PASS。

- [ ] **Step 10: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 此时其它文件（docSchema/index.tsx/soumaExporter/clipboard/SkillTracksCanvas）会因新增 union 分支报「未处理 cast」类型错误——**这是预期的**，将在后续 Task 逐一消除。本 Task 只需确认报错都集中在「新 union 未穷尽处理」这一类。

- [ ] **Step 11: Commit（连同后续 Task，或先跳过 pre-commit 全量 tsc）**

因为新增 union 会让其它文件暂时报错，`.husky/pre-commit` 的 tsc（针对 staged 文件）可能通过（只 stage 本 Task 文件时，跨文件报错不一定触发），也可能阻断。两种处理：

- 若 pre-commit 通过：

```bash
git add src/types/timeline.ts src/types/timelineV2.ts src/utils/timelineFormat.ts src/utils/timelineFormat.test.ts
git commit -m "feat(annotation): 新增 cast 锚定类型与 V2 cast id 持久化"
```

- 若 pre-commit 因跨文件 tsc 阻断：先完成 Task 2 与 Task 4（消除主要报错源），再统一 commit。实现者按 husky 实际行为决定 commit 粒度，**不得**用 `--no-verify` 绕过。

---

## Task 2: 协作层级联删除 + 读路径 sanitizer

**Files:**

- Modify: `src/collab/docSchema.ts:154-158`（yRemoveCastEvent）、`:213-223`（yReplaceComposition）、`:292-298`（projectTimeline sanitizer）
- Test: `src/collab/docSchema.test.ts`

**Interfaces:**

- Consumes: `AnnotationAnchor` 的 `cast` 分支（Task 1）。
- Produces: 删除 cast 时其 cast 锚定备注一并从 Y.Doc 删除；投影读路径丢弃 castId 指向不存在 cast 的备注。

- [ ] **Step 1: 确认测试文件已有的导入与建 doc 辅助**

打开 `src/collab/docSchema.test.ts`，确认顶部已 import `Y`、`yAddCastEvent`、`yAddAnnotation`、`yRemoveCastEvent`、`yReplaceComposition`、`projectTimeline`、`mapOf`、`Y_MAP`。缺哪个补哪个（均从 `./docSchema` 或 `@/collab/constants` 导出；`Y` 从 `'yjs'`）。

- [ ] **Step 2: 写失败测试（级联删除）**

追加：

```ts
it('删除 cast 时级联删除其 cast 锚定备注', () => {
  const doc = new Y.Doc()
  yAddCastEvent(doc, { id: 'cast-1', actionId: 7432, timestamp: 5, playerId: 2 })
  yAddAnnotation(doc, {
    id: 'anno-1',
    text: '点名',
    time: 5,
    anchor: { type: 'cast', castId: 'cast-1' },
  })
  yAddAnnotation(doc, {
    id: 'anno-2',
    text: '无关',
    time: 9,
    anchor: { type: 'damageTrack' },
  })
  yRemoveCastEvent(doc, 'cast-1')
  const anns = mapOf(doc, Y_MAP.annotations)
  expect(anns.has('anno-1')).toBe(false)
  expect(anns.has('anno-2')).toBe(true)
})
```

- [ ] **Step 3: 运行确认失败**

Run: `pnpm test:run docSchema`
Expected: FAIL —— `anno-1` 仍存在。

- [ ] **Step 4: yRemoveCastEvent 内级联删除**

`src/collab/docSchema.ts`，`yRemoveCastEvent`（第 154-158 行）改为：

```ts
export function yRemoveCastEvent(doc: Y.Doc, id: string): void {
  doc.transact(() => {
    mapOf(doc, Y_MAP.castEvents).delete(id)
    // 级联：删掉锚定在这次 cast 上的备注
    const an = mapOf(doc, Y_MAP.annotations)
    for (const [aid, am] of [...an.entries()]) {
      const anchor = am.get('anchor') as { type: string; castId?: string }
      if (anchor?.type === 'cast' && anchor.castId === id) an.delete(aid)
    }
  }, LOCAL_ORIGIN)
}
```

- [ ] **Step 5: 运行确认通过**

Run: `pnpm test:run docSchema`
Expected: PASS。

- [ ] **Step 6: 写失败测试（换阵容级联 + sanitizer）**

追加：

```ts
it('换阵容移除玩家时级联删除其 cast 的 cast 锚定备注', () => {
  const doc = new Y.Doc()
  yReplaceComposition(doc, [
    { id: 2, job: 'WHM' },
    { id: 3, job: 'SCH' },
  ])
  yAddCastEvent(doc, { id: 'cast-2', actionId: 7432, timestamp: 5, playerId: 2 })
  yAddAnnotation(doc, {
    id: 'anno-3',
    text: '点名',
    time: 5,
    anchor: { type: 'cast', castId: 'cast-2' },
  })
  yReplaceComposition(doc, [{ id: 3, job: 'SCH' }]) // 移除玩家 2
  const anns = mapOf(doc, Y_MAP.annotations)
  expect(anns.has('anno-3')).toBe(false)
})

it('projectTimeline 丢弃指向不存在 cast 的孤儿 cast 备注', () => {
  const doc = new Y.Doc()
  yReplaceComposition(doc, [{ id: 2, job: 'WHM' }])
  yAddAnnotation(doc, {
    id: 'anno-orphan',
    text: '孤儿',
    time: 5,
    anchor: { type: 'cast', castId: 'missing-cast' },
  })
  const tl = projectTimeline(doc)
  expect(tl.annotations.find(a => a.id === 'anno-orphan')).toBeUndefined()
})
```

- [ ] **Step 7: 运行确认失败**

Run: `pnpm test:run docSchema`
Expected: FAIL（两条新测试）。

- [ ] **Step 8: yReplaceComposition 级联 cast 备注**

`src/collab/docSchema.ts`，castEvents 清理块（第 213-222 行）改为收集被删 cast id 并一并删 cast 锚定备注：

```ts
const keepIds = new Set(players.map(p => p.id))
const ce = mapOf(doc, Y_MAP.castEvents)
const removedCastIds = new Set<string>()
for (const [id, cm] of [...ce.entries()]) {
  if (!keepIds.has(cm.get('playerId') as number)) {
    ce.delete(id)
    removedCastIds.add(id)
  }
}
const an = mapOf(doc, Y_MAP.annotations)
for (const [id, am] of [...an.entries()]) {
  const anchor = am.get('anchor') as { type: string; playerId?: number; castId?: string }
  if (anchor?.type === 'skillTrack' && !keepIds.has(anchor.playerId!)) an.delete(id)
  else if (anchor?.type === 'cast' && removedCastIds.has(anchor.castId!)) an.delete(id)
}
```

- [ ] **Step 9: projectTimeline sanitizer 丢孤儿 cast 备注**

`src/collab/docSchema.ts`，`projectTimeline` 里 `annotations` 的 filter（第 292-298 行）改为（`castEvents` 已在其上方第 279-290 行算好）：

```ts
const castIds = new Set(castEvents.map(c => c.id))
const annotations = projectCollection<Annotation>(
  doc.getMap<Y.Map<unknown>>(Y_MAP.annotations).values(),
  indexById(prev?.annotations)
).filter(a => {
  if (a.anchor.type === 'skillTrack') return playerIds.has(a.anchor.playerId)
  if (a.anchor.type === 'cast') return castIds.has(a.anchor.castId)
  return true
}) // sanitizer
```

- [ ] **Step 10: 运行确认通过**

Run: `pnpm test:run docSchema`
Expected: PASS（全部）。

- [ ] **Step 11: 类型检查 + Commit**

Run: `pnpm exec tsc --noEmit`（docSchema 相关 cast 报错应消除）

```bash
git add src/collab/docSchema.ts src/collab/docSchema.test.ts
git commit -m "feat(annotation): cast 锚定备注的级联删除与读路径 sanitizer"
```

---

## Task 3: 右键菜单创建入口 + 时间快照解析

**Files:**

- Modify: `src/components/Timeline/TimelineContextMenu.tsx:127-138`
- Modify: `src/components/Timeline/index.tsx:1368-1381`（handleAddAnnotation）

**Interfaces:**

- Consumes: `onAddAnnotation(time: number, anchor: AnnotationAnchor)`（已存在签名，anchor 现含 cast）。
- Produces: castEvent 右键菜单出现「在此技能上添加备注」；点击后以 cast 的真实 `timestamp` 作 time 快照创建 `{ type: 'cast', castId }` 备注。

- [ ] **Step 1: castEvent 菜单加入口**

`src/components/Timeline/TimelineContextMenu.tsx`，`{menu.type === 'castEvent' && (...)}` 块（第 127-138 行）改为（castEvent 在只读时已被第 112 行整体短路，无需再判只读）：

```tsx
{
  menu.type === 'castEvent' && (
    <>
      <DropdownMenuItem
        onClick={() => {
          onAddAnnotation(menu.time, { type: 'cast', castId: menu.castEventId })
          onClose()
        }}
      >
        在此技能上添加备注
      </DropdownMenuItem>
      <DropdownMenuItem
        className="text-destructive focus:text-destructive"
        onClick={() => {
          onDeleteCast(menu.castEventId)
          onClose()
        }}
      >
        删除
        <DropdownMenuShortcut>{deleteKeyLabel}</DropdownMenuShortcut>
      </DropdownMenuItem>
    </>
  )
}
```

- [ ] **Step 2: handleAddAnnotation 解析 cast 时间快照**

`src/components/Timeline/index.tsx`，`handleAddAnnotation`（第 1368-1381 行）改为：

```tsx
const handleAddAnnotation = useCallback(
  (time: number, anchor: AnnotationAnchor) => {
    const menuX = contextMenu?.x ?? 0
    const menuY = contextMenu?.y ?? 0
    // cast 锚定：time 只是冗余快照，取 cast 的真实 timestamp（定位实时从 cast 推导）
    const snapTime =
      anchor.type === 'cast'
        ? (timeline?.castEvents.find(c => c.id === anchor.castId)?.timestamp ?? time)
        : time
    setEditingAnnotation({
      annotation: null,
      time: snapTime,
      anchor,
      screenX: menuX,
      screenY: menuY,
    })
  },
  [contextMenu, setEditingAnnotation, timeline]
)
```

- [ ] **Step 3: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 本 Task 两文件无新报错（其余 UI 文件的 cast 报错在 Task 4/5 消除）。

- [ ] **Step 4: 手动冒烟（开发服已由用户启动）**

在编辑器右键任一技能图标 → 应出现「在此技能上添加备注」；点击 → 弹出备注编辑框；输入文字 Ctrl/Cmd+Enter 保存。此时画布尚未渲染 cast 备注（Task 4 才做），但可在 store/DevTools 确认 `timeline.annotations` 出现一条 `anchor.type === 'cast'`。

- [ ] **Step 5: Commit**

```bash
git add src/components/Timeline/TimelineContextMenu.tsx src/components/Timeline/index.tsx
git commit -m "feat(annotation): 右键技能图标新增在此技能上添加备注"
```

---

## Task 4: 时间轴画布渲染（右上角、禁拖）

**Files:**

- Modify: `src/components/Timeline/index.tsx:1516-1518`（分组）、`:1521-1545`（getAnnotationBasePos）、`:1610-1637`（框选）、`:2065`/`:2077`（prop）
- Modify: `src/components/Timeline/SkillTracksCanvas.tsx:159`（castById map）、`:694-755`（渲染块）

**Interfaces:**

- Consumes: `AnnotationAnchor` 的 cast 分支；`timeline.castEvents`；`actionMap`（已在两组件作用域可用）。
- Produces: cast 锚定备注在技能图标右上角渲染、不可拖、支持 hover/pin/右键。

- [ ] **Step 1: 分组把 cast 备注并入技能区**

`src/components/Timeline/index.tsx`，`skillTrackAnnotations`（第 1516-1518 行）改名为 `skillAreaAnnotations` 并放宽过滤；同时更新第 2065、2077 行两处 `annotations={skillTrackAnnotations}` → `annotations={skillAreaAnnotations}`：

```tsx
const skillAreaAnnotations = (timeline.annotations ?? []).filter(
  a => a.anchor.type === 'skillTrack' || a.anchor.type === 'cast'
)
```

- [ ] **Step 2: getAnnotationBasePos 加 cast 分支**

`src/components/Timeline/index.tsx`，`getAnnotationBasePos`（第 1521-1545 行）在 damageTrack 分支后插入 cast 分支（skillTrack 分支保持在最后）：

```tsx
// cast 锚定：位置从被引用 cast 实时推导，落在技能图标右上角
if (annotation.anchor.type === 'cast') {
  const cast = timeline.castEvents.find(c => c.id === annotation.anchor.castId)
  if (!cast) return null
  const castAction = actionMap.get(cast.actionId)
  const groupId = castAction?.trackGroup ?? cast.actionId
  const trackIndex = trackIndexMap.get(trackKey(cast.playerId, groupId)) ?? -1
  if (trackIndex === -1) return null
  const container = stageRef.current?.container()
  if (!container) return null
  const rect = container.getBoundingClientRect()
  return {
    x: rect.left + cast.timestamp * zoomLevel + 12,
    y: rect.top + trackIndex * skillTrackHeight + skillTrackHeight / 2 - 12,
    scrollY: true,
  }
}
```

（插在第 1531 行 damageTrack 分支的 `}` 之后、`else {` skillTrack 分支之前；把原 `else {` 改成 `if (annotation.anchor.type === 'skillTrack') {` 或保留 else——因 cast 分支提前 return，保留 else 亦可，但为类型窄化清晰，建议改成显式 `else` 内用 `annotation.anchor as { type:'skillTrack'; ... }`（原代码第 1533 行已是此写法）。）

- [ ] **Step 3: 框选把 cast 备注排除（v1 不参与框选）**

`src/components/Timeline/index.tsx`，框选备注块（第 1610-1637 行）改为显式三分支，cast 不 push：

```tsx
for (const annotation of timeline.annotations ?? []) {
  const center = canvasLeft + annotation.time * zoomLevel - clampedScrollLeft
  if (annotation.anchor.type === 'damageTrack') {
    const cy = timeRulerHeight + eventTrackHeight - 20
    objs.push({
      id: annotation.id,
      kind: 'annotation',
      x0: center - ANNOTATION_ICON_HALF,
      x1: center + ANNOTATION_ICON_HALF,
      y0: cy - ANNOTATION_ICON_HALF,
      y1: cy + ANNOTATION_ICON_HALF,
    })
  } else if (annotation.anchor.type === 'skillTrack') {
    const anchor = annotation.anchor
    const trackIndex = trackIndexMap.get(trackKey(anchor.playerId, anchor.actionId)) ?? -1
    if (trackIndex === -1) continue
    const cy =
      fixedAreaHeight + trackIndex * skillTrackHeight + skillTrackHeight / 2 - clampedScrollTop
    objs.push({
      id: annotation.id,
      kind: 'annotation',
      x0: center - ANNOTATION_ICON_HALF,
      x1: center + ANNOTATION_ICON_HALF,
      y0: cy - ANNOTATION_ICON_HALF,
      y1: cy + ANNOTATION_ICON_HALF,
    })
  }
  // cast 锚定备注：v1 不参与框选（锁定不可拖，删除走右键/级联）
}
```

- [ ] **Step 4: SkillTracksCanvas 建 castById 查找表**

`src/components/Timeline/SkillTracksCanvas.tsx`，在 `trackIndexMap`（第 159 行）附近加：

```tsx
const castById = useMemo(() => {
  const m = new Map<string, (typeof timeline.castEvents)[number]>()
  for (const c of timeline.castEvents) m.set(c.id, c)
  return m
}, [timeline.castEvents])
```

- [ ] **Step 5: SkillTracksCanvas 渲染 cast 锚定备注块**

`src/components/Timeline/SkillTracksCanvas.tsx`，在 skillTrack 备注渲染块之后（第 755 行 `})}` 之后、`</Layer>`（第 756 行）之前）插入：

```tsx
{
  /* cast 锚定备注图标（悬挂在技能图标右上角；锁定不可拖） */
}
{
  annotations
    .filter(a => {
      if (a.anchor.type !== 'cast') return false
      if (peerDraggingIds?.has(a.id)) return false
      const cast = castById.get(a.anchor.castId)
      if (!cast) return false
      const x = cast.timestamp * zoomLevel
      return x >= visibleMinX && x <= visibleMaxX
    })
    .map(annotation => {
      const anchor = annotation.anchor as { type: 'cast'; castId: string }
      const cast = castById.get(anchor.castId)
      if (!cast) return null
      const castAction = actionMap?.get(cast.actionId)
      const groupId = castAction?.trackGroup ?? cast.actionId
      const trackIndex = trackIndexMap.get(trackKey(cast.playerId, groupId)) ?? -1
      if (trackIndex === -1) return null

      // 技能图标 center 在 (castX, trackY)，偏移到右上角
      const x = cast.timestamp * zoomLevel + 12
      const y = trackIndex * trackHeight + trackHeight / 2 - 12

      return (
        <AnnotationIcon
          key={`cast-annotation-${annotation.id}`}
          x={x}
          y={y}
          isPinned={pinnedAnnotationId === annotation.id}
          draggable={false}
          onMouseEnter={(e: KonvaEventObject<MouseEvent>) => {
            const stage = e.target.getStage()
            if (!stage) return
            const box = stage.container().getBoundingClientRect()
            const parent = e.target.getParent()
            if (!parent) return
            const absPos = parent.getAbsolutePosition()
            onAnnotationHover(annotation, box.left + absPos.x + 8, box.top + absPos.y + 8)
          }}
          onMouseLeave={onAnnotationHoverEnd}
          onClick={(e: KonvaEventObject<MouseEvent>) => {
            const stage = e.target.getStage()
            if (!stage) return
            const box = stage.container().getBoundingClientRect()
            const parent = e.target.getParent()
            if (!parent) return
            const absPos = parent.getAbsolutePosition()
            onAnnotationClick(annotation, box.left + absPos.x + 8, box.top + absPos.y + 8)
          }}
          onContextMenu={(e: KonvaEventObject<PointerEvent>) => {
            e.evt.preventDefault()
            onAnnotationContextMenu(annotation.id, e.evt.clientX, e.evt.clientY, annotation.time)
          }}
        />
      )
    })
}
```

（`AnnotationIcon` 的 `onDragStart/Move/End` 为可选 prop，不传即禁拖；`draggable={false}` 双保险。）

- [ ] **Step 6: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: index.tsx / SkillTracksCanvas.tsx 的 cast 相关报错消除。

- [ ] **Step 7: 手动冒烟**

刷新编辑器：

1. 右键某技能图标 → 添加备注 → 保存 → 图标右上角出现蓝色备注气泡。
2. 拖动该 cast 到别的时间 → 备注气泡跟随移动。
3. hover 气泡 → 显示备注文本；点击 → pin；右键 → 删除。
4. 删除该 cast → 备注一并消失。
5. 备注气泡不能被单独拖动。

- [ ] **Step 8: Commit**

```bash
git add src/components/Timeline/index.tsx src/components/Timeline/SkillTracksCanvas.tsx
git commit -m "feat(annotation): 画布渲染 cast 锚定备注于技能图标右上角"
```

---

## Task 5: 表格视图角标

**Files:**

- Modify: `src/utils/tableCellHitTest.ts:78-81`（CastMarker）、`:115-116`（写入 castId）
- Modify: `src/components/TimelineTable/index.tsx:225-228`（拆分备注）、`:425-442`（传 prop）
- Modify: `src/components/TimelineTable/TableDataRow.tsx`（新增 prop + 渲染角标）
- Test: `src/utils/tableRows.test.ts`

**Interfaces:**

- Consumes: `CastMarker`、cast 锚定备注列表。
- Produces: 表格中 cast 锚定备注作为角标渲染在对应技能图标右上角；不占独立 `AnnotationRow`。

- [ ] **Step 1: CastMarker 加 castId**

`src/utils/tableCellHitTest.ts`，`CastMarker`（第 78-81 行）：

```ts
/** cast 起点格的载荷：显示变体 id + cast 的使用时刻（悬浮资源预览用）+ cast 稳定 id（角标用） */
export interface CastMarker {
  actionId: number
  castTime: number
  castId: string
}
```

写入处（第 116 行）：

```ts
map.set(key, { actionId: variantId, castTime: castEvent.timestamp, castId: castEvent.id })
```

- [ ] **Step 2: 表格主组件拆分备注**

`src/components/TimelineTable/index.tsx`，`rows` 的 memo（第 225-228 行）只喂非 cast 备注，并新增 cast 备注文本查找表：

```tsx
const rows = useMemo(() => {
  if (!timeline) return []
  const nonCast = (timeline.annotations ?? []).filter(a => a.anchor.type !== 'cast')
  return mergeAndSortRows(filteredDamageEvents, nonCast)
}, [filteredDamageEvents, timeline])

// cast 锚定备注：castId → 合并文本（角标 title 用）
const castAnnotationTextByCastId = useMemo(() => {
  const m = new Map<string, string>()
  for (const a of timeline?.annotations ?? []) {
    if (a.anchor.type !== 'cast') continue
    const prev = m.get(a.anchor.castId)
    m.set(a.anchor.castId, prev ? `${prev}\n${a.text}` : a.text)
  }
  return m
}, [timeline])
```

- [ ] **Step 3: 传 prop 给 TableDataRow**

`src/components/TimelineTable/index.tsx`，`<TableDataRow ... />`（第 433 行 `markerCells=` 之后）追加：

```tsx
                  markerCells={markerCellsByEvent.get(row.id) ?? new Map()}
                  castAnnotationTextByCastId={castAnnotationTextByCastId}
```

- [ ] **Step 4: TableDataRow 渲染角标**

`src/components/TimelineTable/TableDataRow.tsx`：

1. import 加 `MessageSquareText`（若文件已从 `lucide-react` import 则并入该行）：`import { MessageSquareText } from 'lucide-react'`。
2. Props interface 加：

```ts
/** cast 锚定备注文本（castId → 合并文本）；marker 格右上角显示角标 */
castAnnotationTextByCastId: Map<string, string>
```

3. 解构参数加 `castAnnotationTextByCastId`。
4. 在 marker 的 `<GameIcon .../>`（第 260-266 行）之后、该 `<td>` 闭合前加：

```tsx
{
  isMarker && marker.castId && castAnnotationTextByCastId.has(marker.castId) && (
    <span
      className="pointer-events-none absolute top-0.5 right-0.5 flex items-center justify-center rounded-sm bg-blue-500/80 p-[1px] shadow"
      title={castAnnotationTextByCastId.get(marker.castId)}
    >
      <MessageSquareText className="h-2.5 w-2.5 text-white" />
    </span>
  )
}
```

- [ ] **Step 5: tableRows 防回归测试**

`src/utils/tableRows.test.ts` 追加：

```ts
it('mergeAndSortRows 收到的备注若含 cast 锚定也会成行（过滤由调用方负责）', () => {
  // 契约说明：mergeAndSortRows 不认识 anchor 类型，cast 过滤在 TimelineTableView 完成
  const rows = mergeAndSortRows(
    [],
    [{ id: 'a1', text: 'x', time: 1, anchor: { type: 'cast', castId: 'c1' } }]
  )
  expect(rows).toHaveLength(1)
})
```

- [ ] **Step 6: 运行测试 + 类型检查**

Run: `pnpm test:run tableRows` → PASS
Run: `pnpm exec tsc --noEmit` → 表格相关无报错

- [ ] **Step 7: 手动冒烟**

切到表格视图：cast 锚定备注不再独占一行；对应技能图标格右上角出现小蓝色备注角标，hover 显示 `title` 文本。坐标锚定备注仍独占黄色行。

- [ ] **Step 8: Commit**

```bash
git add src/utils/tableCellHitTest.ts src/components/TimelineTable/index.tsx src/components/TimelineTable/TableDataRow.tsx src/utils/tableRows.test.ts
git commit -m "feat(annotation): 表格视图 cast 锚定备注以技能图标角标呈现"
```

---

## Task 6: 导出（Souma）+ 剪贴板兼容

**Files:**

- Modify: `src/utils/soumaExporter.ts:45-57`
- Modify: `src/utils/timelineClipboard.ts:125-145`
- Test: `src/utils/soumaExporter.test.ts`

**Interfaces:**

- Consumes: cast 锚定；`timeline.castEvents`。
- Produces: Souma 导出把 cast 锚定按其绑定技能（图标前缀 + cast 真实时刻）输出；剪贴板粘贴时丢弃 cast 锚定并计入 `skipped`。

- [ ] **Step 1: 写失败测试（Souma 导出 cast 锚定）**

`src/utils/soumaExporter.test.ts` 追加（沿用文件已有的 timeline 构造模式；`actionId` 用文件里已验证过命中的减伤技能 id——例如现有测试第 235-241 行「节制」用的那条 cast 的 actionId，复制过来保证 `MITIGATION_DATA.actions.find` 命中）：

```ts
it('cast 锚定备注按绑定技能的时刻和图标导出', () => {
  const timeline = {
    encounter: { id: 1, name: '', displayName: '', zone: '', damageEvents: [] },
    composition: { players: [{ id: 1, job: 'WHM' }] },
    damageEvents: [],
    castEvents: [
      { id: 'c1', actionId: /* 与既有测试同一合法 id */ 16536, timestamp: 5, playerId: 1 },
    ],
    statusEvents: [],
    annotations: [{ id: 'a1', text: '开团减伤', time: 0, anchor: { type: 'cast', castId: 'c1' } }],
    syncEvents: [],
  }
  const out = buildSoumaTimelineText(timeline as never, 1, [], false)
  expect(out).toContain('# 00:05.0 <') // 时间取 cast 的 5s，且带技能图标前缀
  expect(out).toContain('开团减伤')
})
```

> 实现者注意：把上面 `16536` 替换为本测试文件里已存在、且 `MITIGATION_DATA` 中真实存在的减伤技能 id（照抄现有 skillTrack 导出测试用的那个 id，避免 find 落空导致无图标前缀）。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test:run soumaExporter`
Expected: FAIL —— 当前 cast 锚定按 `ann.time=0` 且无图标前缀输出，`# 00:05.0 <` 不匹配。

- [ ] **Step 3: soumaExporter 处理 cast 锚定**

`src/utils/soumaExporter.ts`，备注循环（第 45-57 行）改为：

```ts
// 备注（全部包含；skillTrack / cast 锚定会带上绑定技能的图标语法与真实时刻）
for (const ann of timeline.annotations ?? []) {
  let annTime = ann.time
  let iconPrefix = ''
  if (ann.anchor.type === 'skillTrack') {
    const action = MITIGATION_DATA.actions.find(a => a.id === ann.anchor.actionId)
    if (action) iconPrefix = `<${action.name}>`
  } else if (ann.anchor.type === 'cast') {
    const cast = timeline.castEvents.find(c => c.id === ann.anchor.castId)
    if (cast) {
      annTime = cast.timestamp
      const action = MITIGATION_DATA.actions.find(a => a.id === cast.actionId)
      if (action) iconPrefix = `<${action.name}>`
    }
  }
  const timeLabel = formatSoumaTime(annTime)
  for (const line of ann.text.split('\n')) {
    entries.push({ time: annTime, order: 0, text: `# ${timeLabel} ${iconPrefix}${line}` })
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm test:run soumaExporter`
Expected: PASS。

- [ ] **Step 5: 剪贴板粘贴丢弃 cast 锚定**

`src/utils/timelineClipboard.ts`，annotations 循环（第 125-145 行）在 skillTrack 分支前加 cast 分支：

```ts
const annotations: Omit<Annotation, 'id'>[] = []
for (const a of hydrated.annotations ?? []) {
  if (a.anchor.type === 'cast') {
    // cast 锚定引用具体 cast 实例，粘贴后目标 cast 是新实例、id 无法重映射 → 丢弃计数
    skipped++
    continue
  }
  if (a.anchor.type === 'skillTrack') {
    const mapped = map.get(a.anchor.playerId)
    if (mapped === undefined) {
      skipped++
      continue
    }
    annotations.push({
      text: a.text,
      time: Math.max(TIMELINE_START_TIME, shift(a.time)),
      anchor: { type: 'skillTrack', playerId: mapped, actionId: a.anchor.actionId },
    })
  } else {
    annotations.push({
      text: a.text,
      time: Math.max(TIMELINE_START_TIME, shift(a.time)),
      anchor: { type: 'damageTrack' },
    })
  }
}
```

- [ ] **Step 6: 类型检查 + 全量测试**

Run: `pnpm exec tsc --noEmit` → 无报错
Run: `pnpm test:run` → 全绿

- [ ] **Step 7: Commit**

```bash
git add src/utils/soumaExporter.ts src/utils/soumaExporter.test.ts src/utils/timelineClipboard.ts
git commit -m "feat(annotation): Souma 导出支持 cast 锚定，剪贴板粘贴丢弃 cast 锚定"
```

---

## 收尾验证（所有 Task 完成后）

- [ ] **Step 1: 全量类型检查** — Run: `pnpm exec tsc --noEmit` → 无错误。
- [ ] **Step 2: Lint** — Run: `pnpm lint` → 无错误。
- [ ] **Step 3: 全量测试** — Run: `pnpm test:run` → 全绿。
- [ ] **Step 4: 构建兜底** — Run: `pnpm build` → 构建成功。
- [ ] **Step 5: 端到端手动验证清单**

1. 右键技能图标 → 添加备注 → 画布右上角出现气泡；表格视图对应图标出现角标（不占独立行）。
2. 拖动该 cast → 两视图备注均跟随。
3. 删除该 cast → 两视图备注消失。
4. 换阵容移除该玩家 → 其 cast 备注消失。
5. 本地时间轴刷新页面（localStorage 走 V2 往返）→ cast 备注仍在、仍绑对 cast。
6. 发布 → 公开只读打开 → cast 备注正常显示。
7. Souma 导出 → cast 备注以 `# mm:ss.d <技能名>文本` 出现在 cast 时刻。
8. 复制含 cast 备注的选区并粘贴 → cast 备注被丢弃（不报错）。

---

## Self-Review 结论

- **Spec 覆盖**：数据模型（T1）、V2 补洞（T1）、级联删除/sanitizer/换阵容（T2）、创建入口（T3）、画布右上角渲染+禁拖（T4）、表格角标不独立行（T5）、导出/剪贴板（T6）—— spec 各节均有对应 Task。
- **YAGNI 项**：拖拽创建/重锚、降级为坐标、孤立备注、cast 备注独立时间编辑、框选命中、粘贴保留 cast 锚定 —— 均未实现，符合 spec「明确不做」。
- **类型一致**：`AnnotationAnchor` cast 分支字段 `castId`、`V2AnnotationAnchor` 的 `{ c }`、`CastMarker.castId`、`castAnnotationTextByCastId`、`skillAreaAnnotations` 在跨 Task 引用中命名一致。
- **占位符**：无 TODO / 「类似上文」；每个代码步骤给出完整代码（Souma 测试的 actionId 已显式标注需替换为文件内既有合法 id）。
