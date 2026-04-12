# 鼠标悬浮十字准线 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 鼠标悬浮在技能轨道区域时显示十字准线（纵向时间实线 + 横轴轨道高亮 + 时间标尺标记），鼠标离开时立即消失。

**Architecture:** 使用 ref 存储鼠标位置避免 React 重渲染。轨道高亮绘制在 bgLayer 上（不遮挡技能图标），纵线绘制在新增 overlayLayer 上。鼠标时间通过回调同步到父组件，传递给固定区域的 TimeRuler。

**Tech Stack:** React-Konva, Konva Layer, useRef

---

## File Structure

| File                                            | Action | Responsibility                                                                                 |
| ----------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------- |
| `src/components/Timeline/SkillTracksCanvas.tsx` | Modify | 新增 overlayLayer + 轨道高亮 + mousemove/mouseleave 事件                                       |
| `src/components/Timeline/index.tsx`             | Modify | 管理 crosshair 状态 ref，传递给 SkillTracksCanvas 和固定区域 Stage，新增固定区域 overlay Layer |
| `src/components/Timeline/TimeRuler.tsx`         | Modify | 接收 hoverTime prop，绘制时间标记                                                              |
| `src/components/Timeline/constants.ts`          | Modify | 新增十字准线样式常量                                                                           |

---

### Task 1: 添加十字准线样式常量

**Files:**

- Modify: `src/components/Timeline/constants.ts`

- [ ] **Step 1: 添加常量**

```typescript
// 在 constants.ts 末尾添加

// 鼠标十字准线样式
export const CROSSHAIR_VERTICAL_LINE_STYLE = {
  stroke: '#9ca3af',
  strokeWidth: 1,
}

export const CROSSHAIR_TRACK_HIGHLIGHT_COLOR = 'rgba(59, 130, 246, 0.08)'
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Timeline/constants.ts
git commit -m "feat: 添加十字准线样式常量"
```

---

### Task 2: TimeRuler 支持显示鼠标时间标记

**Files:**

- Modify: `src/components/Timeline/TimeRuler.tsx`

- [ ] **Step 1: 添加 hoverTime prop 和时间标记渲染**

在 `TimeRulerProps` 接口添加可选的 `hoverTime` 属性，在组件内根据该属性绘制时间标记（竖线 + 时间文本）。

修改 `TimeRulerProps`：

```typescript
interface TimeRulerProps {
  maxTime: number
  zoomLevel: number
  timelineWidth: number
  height: number
  hoverTime?: number | null
}
```

新增 `formatTimeWithDecimal` 函数（精确到小数点后 1 位）：

```typescript
function formatTimeWithDecimal(seconds: number): string {
  const abs = Math.abs(seconds)
  const sign = seconds < 0 ? '-' : ''
  const min = Math.floor(abs / 60)
  const sec = abs % 60
  return `${sign}${min}:${sec < 10 ? '0' : ''}${sec.toFixed(1)}`
}
```

在 `TimeRuler` 组件的 `<>` 末尾、`0 秒标记线` 之后，添加 hoverTime 标记：

```tsx
{
  /* 鼠标悬浮时间标记 */
}
{
  hoverTime != null &&
    (() => {
      const x = hoverTime * zoomLevel
      return (
        <Group>
          <Line points={[x, 0, x, height]} stroke="#9ca3af" strokeWidth={1} listening={false} />
          <Rect
            x={x - 1}
            y={0}
            width={50}
            height={18}
            fill="#374151"
            cornerRadius={2}
            listening={false}
          />
          <Text
            x={x + 3}
            y={3}
            text={formatTimeWithDecimal(hoverTime)}
            fontSize={11}
            fill="#ffffff"
            fontFamily="Arial, sans-serif"
            perfectDrawEnabled={false}
            listening={false}
          />
        </Group>
      )
    })()
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Timeline/TimeRuler.tsx
git commit -m "feat: TimeRuler 支持显示鼠标悬浮时间标记"
```

---

### Task 3: SkillTracksCanvas 添加十字准线渲染

**Files:**

- Modify: `src/components/Timeline/SkillTracksCanvas.tsx`

- [ ] **Step 1: 添加新 props 和 overlayLayer ref**

在 `SkillTracksCanvasProps` 接口添加：

```typescript
interface SkillTracksCanvasProps {
  // ... 现有 props ...
  overlayLayerRef?: RefObject<Konva.Layer | null>
  hoverTrackIndex: number | null
  hoverTimeX: number | null // 鼠标时间对应的像素 X 坐标（Layer 坐标系）
}
```

在解构 props 时添加：

```typescript
export default function SkillTracksCanvas({
  // ... 现有 props ...
  overlayLayerRef,
  hoverTrackIndex,
  hoverTimeX,
}: SkillTracksCanvasProps) {
```

- [ ] **Step 2: 在 bgLayer 中添加轨道高亮矩形**

在 bgLayer 内、轨道背景 `{skillTracks.map(...)}` 之后、轨道分隔线之前，添加：

```tsx
{
  /* 鼠标悬浮轨道高亮 */
}
{
  hoverTrackIndex != null && hoverTrackIndex >= 0 && hoverTrackIndex < skillTracks.length && (
    <Rect
      x={TIMELINE_START_TIME * zoomLevel}
      y={hoverTrackIndex * trackHeight}
      width={timelineWidth}
      height={trackHeight}
      fill={CROSSHAIR_TRACK_HIGHLIGHT_COLOR}
      listening={false}
      perfectDrawEnabled={false}
    />
  )
}
```

导入常量：

```typescript
import {
  CROSSHAIR_VERTICAL_LINE_STYLE,
  CROSSHAIR_TRACK_HIGHLIGHT_COLOR,
  DAMAGE_TIME_LINE_STYLE,
  TIMELINE_START_TIME,
} from './constants'
```

- [ ] **Step 3: 添加 overlayLayer 绘制纵向实线**

在 `<>` 末尾、eventLayer 的 `</Layer>` 之后，添加新的 overlay Layer：

```tsx
{
  /* 十字准线叠加层 */
}
;<Layer ref={overlayLayerRef} x={-scrollLeft} y={-scrollTop} listening={false}>
  {hoverTimeX != null && (
    <Line
      points={[hoverTimeX, 0, hoverTimeX, skillTracksHeight]}
      {...CROSSHAIR_VERTICAL_LINE_STYLE}
      listening={false}
      perfectDrawEnabled={false}
    />
  )}
</Layer>
```

- [ ] **Step 4: Commit**

```bash
git add src/components/Timeline/SkillTracksCanvas.tsx
git commit -m "feat: SkillTracksCanvas 添加十字准线渲染层"
```

---

### Task 4: 主组件集成鼠标事件和状态管理

**Files:**

- Modify: `src/components/Timeline/index.tsx`

- [ ] **Step 1: 添加 crosshair 状态 ref 和 overlay Layer refs**

在 `TimelineCanvas` 组件中，已有 ref 声明区域后添加：

```typescript
// 十字准线状态
const hoverTimeRef = useRef<number | null>(null)
const hoverTrackIndexRef = useRef<number | null>(null)
const [hoverTime, setHoverTime] = useState<number | null>(null)
const [hoverTrackIndex, setHoverTrackIndex] = useState<number | null>(null)
// overlay Layer refs
const mainOverlayLayerRef = useRef<Konva.Layer | null>(null)
const fixedOverlayLayerRef = useRef<Konva.Layer | null>(null)
```

- [ ] **Step 2: 添加鼠标事件处理函数**

在 `handleDirectScroll` 之后添加：

```typescript
// 十字准线：鼠标移动事件
const handleCrosshairMove = useCallback(
  (e: MouseEvent) => {
    if (isDraggingRef.current) {
      // 拖拽平移时隐藏十字准线
      if (hoverTimeRef.current !== null) {
        hoverTimeRef.current = null
        hoverTrackIndexRef.current = null
        setHoverTime(null)
        setHoverTrackIndex(null)
      }
      return
    }

    const stage = stageRef.current
    if (!stage) return

    const rect = stage.container().getBoundingClientRect()
    const pointerX = e.clientX - rect.left
    const pointerY = e.clientY - rect.top

    const time = (pointerX + clampedScrollRef.current.scrollLeft) / zoomLevel
    const trackIndex = Math.floor((pointerY + visualScrollTopRef.current) / skillTrackHeight)

    hoverTimeRef.current = time
    hoverTrackIndexRef.current =
      trackIndex >= 0 && trackIndex < (layoutData?.skillTracks.length ?? 0) ? trackIndex : null

    setHoverTime(time)
    setHoverTrackIndex(hoverTrackIndexRef.current)
  },
  [zoomLevel, layoutData?.skillTracks.length]
)

// 十字准线：鼠标离开事件
const handleCrosshairLeave = useCallback(() => {
  hoverTimeRef.current = null
  hoverTrackIndexRef.current = null
  setHoverTime(null)
  setHoverTrackIndex(null)
}, [])
```

- [ ] **Step 3: 绑定鼠标事件到技能轨道 Stage 容器**

在已有的 `useTimelinePanZoom` 调用之后添加：

```typescript
// 绑定十字准线鼠标事件到技能轨道 Stage
useEffect(() => {
  const stage = stageRef.current
  if (!stage) return

  const container = stage.container()
  container.addEventListener('mousemove', handleCrosshairMove)
  container.addEventListener('mouseleave', handleCrosshairLeave)

  return () => {
    container.removeEventListener('mousemove', handleCrosshairMove)
    container.removeEventListener('mouseleave', handleCrosshairLeave)
  }
}, [handleCrosshairMove, handleCrosshairLeave])
```

- [ ] **Step 4: 更新 handleDirectScroll 同步 overlay Layers**

在 `handleDirectScroll` 回调中，`mainEventLayerRef` 操作之后、标签列滚动之前，添加：

```typescript
// 十字准线 overlay Layer 同步
if (mainOverlayLayerRef.current) {
  mainOverlayLayerRef.current.x(-newScrollLeft)
  mainOverlayLayerRef.current.y(-newScrollTop)
}
// 固定区域十字准线 overlay
if (fixedOverlayLayerRef.current) {
  fixedOverlayLayerRef.current.x(-newScrollLeft)
  fixedOverlayLayerRef.current.getStage()?.batchDraw()
}
```

- [ ] **Step 5: 传递 props 给 SkillTracksCanvas**

在 `<SkillTracksCanvas>` 组件上添加新 props：

```tsx
<SkillTracksCanvas
  // ... 现有 props ...
  overlayLayerRef={mainOverlayLayerRef}
  hoverTrackIndex={hoverTrackIndex}
  hoverTimeX={hoverTime != null ? hoverTime * zoomLevel : null}
/>
```

- [ ] **Step 6: 传递 hoverTime 给 TimeRuler**

修改固定区域的 `<TimeRuler>` 组件：

```tsx
<TimeRuler
  maxTime={maxTime}
  zoomLevel={zoomLevel}
  timelineWidth={timelineWidth}
  height={timeRulerHeight}
  hoverTime={hoverTime}
/>
```

- [ ] **Step 7: 在固定区域 Stage 添加纵线 overlay Layer**

在固定区域 Stage 中，`<Layer ref={fixedLayerRef}>` 之后添加新的 overlay Layer：

```tsx
<Stage width={viewportWidth} height={fixedAreaHeight} ref={fixedStageRef}>
  <Layer ref={fixedLayerRef} x={-clampedScrollLeft}>
    <TimeRuler
      maxTime={maxTime}
      zoomLevel={zoomLevel}
      timelineWidth={timelineWidth}
      height={timeRulerHeight}
      hoverTime={hoverTime}
    />
    <DamageEventTrack ... />
  </Layer>
  {/* 固定区域十字准线纵线 */}
  <Layer ref={fixedOverlayLayerRef} x={-clampedScrollLeft} listening={false}>
    {hoverTime != null && (
      <Line
        points={[
          hoverTime * zoomLevel, 0,
          hoverTime * zoomLevel, fixedAreaHeight,
        ]}
        stroke="#9ca3af"
        strokeWidth={1}
        listening={false}
        perfectDrawEnabled={false}
      />
    )}
  </Layer>
</Stage>
```

需要在文件顶部导入 `Line`：

```typescript
import { Stage, Layer, Line } from 'react-konva'
```

- [ ] **Step 8: Commit**

```bash
git add src/components/Timeline/index.tsx
git commit -m "feat: 集成鼠标十字准线事件处理和状态管理"
```

---

### Task 5: 验证和微调

- [ ] **Step 1: 启动开发服务器验证**

```bash
pnpm dev
```

在浏览器中打开编辑器页面，验证：

1. 鼠标进入技能轨道区域 → 显示纵线 + 轨道高亮 + 时间标尺标记
2. 纵线贯穿时间标尺、伤害事件轨道、技能轨道三个区域
3. 轨道高亮不遮挡技能图标
4. 时间标尺标记显示精确到小数点后 1 位的时间
5. 鼠标离开 → 立即消失
6. 拖拽平移时 → 十字准线隐藏
7. 双击添加技能 → 正常工作（不受十字准线干扰）

- [ ] **Step 2: 运行 lint 检查**

```bash
pnpm lint
```

- [ ] **Step 3: 运行测试**

```bash
pnpm test:run
```

- [ ] **Step 4: 修复发现的问题（如有）**

- [ ] **Step 5: Final commit（如有修复）**
