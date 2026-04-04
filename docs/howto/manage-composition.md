---
order: 3
title: 管理小队阵容
---

# 如何管理小队阵容

阵容决定了时间轴上显示哪些职业的技能轨道，以及有哪些减伤技能可用。

## 查看和快速操作

点击工具栏上的 <Users :size="16" style="display:inline;vertical-align:middle" /> **「小队阵容 ?/8」** 按钮，弹出阵容面板：

- 每个队员显示 **职业图标** 和 **职业名称**
- 点击队员旁边的 <Eye :size="16" style="display:inline;vertical-align:middle" />：显示该玩家的技能轨道；再次点击变为 <EyeOff :size="16" style="display:inline;vertical-align:middle" /> 隐藏
- **Shift +** <Eye :size="16" style="display:inline;vertical-align:middle" />：只显示这一个人，隐藏其他所有人（方便专注看某个职业的减伤安排）
- 点击 <XIcon :size="16" style="display:inline;vertical-align:middle" />：移除该队员

<!-- 📸 截图：阵容弹出面板
     内容：CompositionPopover 展开状态，显示 8 名队员列表，
     每人有职业图标、名称、眼睛按钮和 X 按钮，底部有「调整阵容」按钮。 -->

<!-- 🎬 动图：Shift+点击独显玩家
     内容：阵容面板中 Shift+点击白魔的眼睛图标 → 时间轴上其他职业轨道消失，
     只剩白魔一行 → 再次 Shift+点击恢复全部显示。时长 4-6 秒。 -->

## 编辑完整阵容

1. 在阵容面板底部点击 **「调整阵容」**
2. 在弹出的对话框中：
   - **上方**：显示当前阵容，点击职业图标可移除
   - **下方**：按角色分组（坦克 / 治疗 / 近战 / 远敏 / 法系）显示所有可选职业，点击添加
3. 阵容最多 8 人，满员后无法继续添加
4. 点击 **「完成」** 保存

<!-- 📸 截图：调整阵容对话框
     内容：CompositionDialog 打开状态，上方显示当前 8 人阵容图标，
     下方按角色分组排列所有可选职业图标（部分已置灰表示满员不可添加）。 -->
