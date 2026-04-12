# 时间轴注释功能设计

## 概述

为时间轴添加文字注释功能，用户可在任意时刻、任意轨道上添加注释，注释作为时间轴数据的一部分随共享同步到服务器。

## 数据模型

### Annotation 类型

```typescript
interface Annotation {
  id: string // crypto.randomUUID()
  text: string // 最大 200 字符，允许换行
  time: number // 锚定时间（秒）
  anchor: { type: 'damageTrack' } | { type: 'skillTrack'; playerId: number; actionId: number }
}
```

### Timeline 接口变更

`Timeline` 新增 `annotations: Annotation[]` 字段。

### 常量

`constants/limits.ts` 新增 `ANNOTATION_TEXT_MAX_LENGTH = 200`。

## Store 层

在 `timelineStore` 新增三个 action：

- `addAnnotation(annotation: Annotation)` — 添加注释
- `updateAnnotation(id: string, updates: Partial<Pick<Annotation, 'text' | 'time'>>)` — 更新注释文本或时间
- `removeAnnotation(id: string)` — 删除注释

规则：

- 遵循不可变更新模式
- 每个 action 调用后触发 `triggerAutoSave()`
- 纳入 zundo temporal 历史记录（撤销/重做）
- `updateComposition` 中过滤掉不在新阵容中的 skillTrack 类型注释

## Canvas 渲染

### 注释图标

- 使用 Konva 绘制小气泡形状（圆角矩形 + 小三角），16x16，半透明蓝色填充
- 位置：`x = time * zoomLevel`，y 根据所在轨道行计算
- 层级：渲染在技能图标和伤害卡片之上

### 分发渲染

- **伤害轨道注释**（`anchor.type === 'damageTrack'`）：在 `DamageEventTrack` 中渲染
- **技能轨道注释**（`anchor.type === 'skillTrack'`）：在 `SkillTracksCanvas` 中渲染，根据 `playerId + actionId` 匹配轨道行

## Popover 交互

- **悬浮查看**：鼠标悬停图标时弹出只读 Popover，显示注释文字
- **点击编辑**：点击图标弹出可编辑 Popover（textarea + 确认按钮），非只读模式下可用
- **定位**：通过 Konva 事件获取屏幕坐标，HTML Popover 叠加在 Canvas 之上（类似 TooltipOverlay）

## 右键菜单

### 新增菜单项

- 伤害轨道空白处右键：增加"添加注释"选项
- 技能轨道空白处右键：增加"添加注释"选项
- 注释图标右键：显示"删除注释"选项

### ContextMenuState 扩展

新增菜单类型：`{ type: 'annotation'; annotationId: string }`

### 创建流程

右键 → "添加注释" → 弹出编辑 Popover（空 textarea）→ 输入内容 → 确认 → `addAnnotation`

## 服务器同步

### API 层

`UploadPayload` 和 `buildPayload` 新增 `annotations` 字段。

### Worker 校验（Valibot）

```typescript
const AnnotationAnchorSchema = v.variant('type', [
  v.object({ type: v.literal('damageTrack') }),
  v.object({
    type: v.literal('skillTrack'),
    playerId: v.number(),
    actionId: v.number(),
  }),
])

const AnnotationSchema = v.object({
  id: v.string(),
  text: v.pipe(v.string(), v.maxLength(ANNOTATION_TEXT_MAX_LENGTH)),
  time: v.number(),
  anchor: AnnotationAnchorSchema,
})
```

在 `TimelineSchema` 中添加 `annotations: v.optional(v.array(AnnotationSchema))`，用 `v.optional` 兼容旧数据。

### applyServerTimeline

覆盖本地时包含 `annotations` 字段。

## 只读模式

- 悬浮查看正常工作
- 右键菜单不显示"添加注释"/"删除注释"
- 点击注释图标弹出只读 Popover（无编辑能力）
- 复用现有 `useEditorReadOnly` hook

## 向后兼容

旧时间轴数据不含 `annotations` 字段，前端加载时默认为 `[]`。服务器 schema 使用 `v.optional` 允许该字段缺失。
