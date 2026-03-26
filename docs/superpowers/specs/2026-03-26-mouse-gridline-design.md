# 鼠标悬浮十字准线

## 概述

鼠标悬浮在技能轨道区域（SkillTracksCanvas）时，显示十字准线辅助定位：纵线标示当前鼠标时间，横轴高亮对应技能轨道。鼠标离开时立即消失。

## 视觉设计

### 纵向时间线

- 1px 虚线，贯穿整个技能轨道高度
- 颜色：浅灰色（`#9ca3af`）
- 跟随鼠标 X 位置实时移动

### 时间标尺标记

- 在顶部 TimeRuler 组件上同步显示当前鼠标对应时间的高亮标记
- 显示精确时间文本（如 "1:23"）
- 配合一条与纵线对齐的短竖线

### 轨道高亮

- 鼠标所在轨道整行覆盖半透明背景色
- 颜色：`rgba(59, 130, 246, 0.08)`
- 宽度：覆盖整个可见视口宽度（不仅限于内容区域）

## 渲染层级

```
bgLayer（背景层）
  ├── 轨道背景矩形（交替白灰色）
  ├── 轨道高亮矩形 ← 新增，在此层绘制
  ├── 轨道分隔线
  └── 垂直网格线

eventLayer（事件层）
  ├── 伤害事件虚线
  ├── 空转时间提示
  └── CastEventIcon 技能图标  ← 始终在高亮之上

overlayLayer（叠加层）← 新增
  └── 纵向时间虚线（listening={false}）
```

关键：轨道高亮在 bgLayer 上绘制，确保不遮挡事件层的技能图标。纵向虚线在新增的 overlayLayer 上绘制，位于最顶层但不响应鼠标事件。

## 数据流

```
SkillTracksCanvas Stage mousemove
  → 计算鼠标对应时间 = (pointerX + scrollLeft) / zoomLevel
  → 计算鼠标对应轨道索引 = Math.floor((pointerY + scrollTop) / trackHeight)
  → 更新 ref 状态（mouseTime, hoverTrackIndex）
  → 触发 overlayLayer 重绘

SkillTracksCanvas Stage mouseleave
  → 清除 ref 状态
  → 隐藏所有十字准线元素

mouseTime 通过 store 或回调同步到 TimeRuler
  → TimeRuler 绘制时间标记
```

## 性能考量

- 使用 ref 而非 state 存储鼠标位置，避免每帧触发 React 重渲染
- overlayLayer 设置 `listening={false}`，不参与事件检测
- 轨道高亮矩形设置 `listening={false}`，不干扰现有双击/拖拽交互
- 纵向虚线和轨道高亮均设置 `perfectDrawEnabled={false}`、`shadowEnabled={false}`

## 交互细节

- 鼠标进入技能轨道区域：显示十字准线
- 鼠标移动：实时更新纵线位置和轨道高亮
- 鼠标离开技能轨道区域：立即消失（无动画）
- 拖拽平移时：隐藏十字准线（避免干扰）
- 轨道索引越界时（如在轨道间隙）：不显示轨道高亮，仅显示纵线
