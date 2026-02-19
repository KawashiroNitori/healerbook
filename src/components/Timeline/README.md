# Timeline 组件

时间轴 Canvas 组件的模块化实现。

## 组件结构

```
Timeline/
├── index.tsx                      # 主组件 (548 行)
├── TimeRuler.tsx                  # 时间标尺 (47 行)
├── DamageEventTrack.tsx           # 伤害事件轨道 (66 行)
├── DamageEventCard.tsx            # 伤害事件卡片 (145 行)
├── SkillTrackLabels.tsx           # 技能轨道标签 (51 行)
├── SkillTracksCanvas.tsx          # 技能轨道 Canvas (180 行)
├── SkillIcon.tsx                  # 技能图标 (57 行)
└── MitigationAssignmentIcon.tsx   # 减伤分配图标 (120 行)
```

## 组件职责

### index.tsx (主组件)
- 管理整体布局和状态
- 处理拖放、滚动、缩放等交互
- 协调子组件之间的通信

### TimeRuler.tsx
- 渲染时间标尺刻度
- 显示时间格式 (MM:SS)

### DamageEventTrack.tsx
- 渲染伤害事件轨道背景
- 管理伤害事件列表

### DamageEventCard.tsx
- 渲染单个伤害事件卡片
- 显示原始伤害、最终伤害、减伤比例
- 处理拖动和选择

### SkillTrackLabels.tsx
- 渲染左侧技能轨道标签列
- 显示职业图标、技能图标、技能名称

### SkillTracksCanvas.tsx
- 渲染技能轨道背景和网格
- 渲染伤害事件时刻的红色虚线
- 管理减伤分配图标列表
- 处理双击添加技能

### SkillIcon.tsx
- 渲染技能图标
- 处理图标加载状态
- 显示选中状态

### MitigationAssignmentIcon.tsx
- 渲染减伤分配图标
- 显示持续时间条和冷却时间条
- 处理拖动边界限制
- 处理右键删除

## 使用方式

```tsx
import TimelineCanvas from '@/components/Timeline'

function EditorPage() {
  return (
    <TimelineCanvas width={1200} height={800} />
  )
}
```

## 设计原则

1. **单一职责**: 每个组件只负责一个功能
2. **低耦合**: 子组件通过 props 接收数据和回调
3. **高内聚**: 相关逻辑封装在同一组件内
4. **可测试**: 子组件可独立测试
5. **可维护**: 文件大小控制在 200 行以内(除主组件)

## 性能优化

- 使用 `perfectDrawEnabled={false}` 禁用精确绘制
- 使用 `shadowEnabled={false}` 禁用阴影
- 使用 `listening={false}` 禁用不需要交互的元素
- 减少 Layer 数量(目标 ≤3 层)
- 使用 `batchDraw()` 批量更新

## 未来改进

- [ ] 添加虚拟滚动优化长时间轴
- [ ] 添加缩略图导航
- [ ] 支持多选和批量操作
- [ ] 添加撤销/重做功能
- [ ] 支持键盘快捷键
