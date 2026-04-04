---
order: 7
title: 使用注释
---

# 如何使用注释

注释可以在时间轴上标记需要注意但时间轴无法全面展示的重点信息，比如"这里必须有 TLB"或者"全队集合吃展开盾"。

## 添加注释

1. 在伤害事件轨道或技能轨道的空白处**右键**
2. 选择 **「添加注释」**
3. 在弹出的输入框中输入文字（最多 200 字）
4. 按 **Ctrl + Enter** 或点击确认按钮保存

<!-- 🎬 动图：添加和查看注释
     内容：右键技能轨道 → 选择「添加注释」→ 输入 "这里必须有节制" →
     按 Ctrl+Enter 保存 → 时间轴上出现注释图标 → 悬浮显示注释内容。
     时长 6-8 秒。 -->

## 查看注释

- 注释在时间轴上显示为 <MessageSquareText :size="16" style="display:inline;vertical-align:middle" /> 图标
- **悬浮**鼠标到 <MessageSquareText :size="16" style="display:inline;vertical-align:middle" /> 上：临时显示注释内容
- **单击** <MessageSquareText :size="16" style="display:inline;vertical-align:middle" />：固定显示，再次点击或点击空白处取消固定

## 编辑注释

- **右键**点击 <MessageSquareText :size="16" style="display:inline;vertical-align:middle" /> 图标，选择 **「编辑」**

## 移动注释

直接**拖拽** <MessageSquareText :size="16" style="display:inline;vertical-align:middle" /> 图标到新的时间位置。

## 删除注释

- 选中后按 **Delete** 键
- 或右键选择 **「删除」**
