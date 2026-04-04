# 设计文档：时间轴 description 字段、FFLogs 来源记录、nanoid ID

**日期**：2026-03-24
**状态**：已确认

---

## 背景

当前 `Timeline` 类型缺少用户备注字段，从 FFLogs 导入的时间轴无法追溯来源战斗，且 ID 使用 `timeline-${Date.now()}` 生成，存在微小冲突风险且格式不规范。

---

## 目标

1. 为时间轴添加可选的 `description` 字段，供用户填写简短说明。
2. 从 FFLogs 导入时，记录来源的 `reportCode` 和 `fightId`。
3. 将时间轴 ID 生成方式改为 nanoid（纯字母数字，长度 21）。

---

## 类型变更

### `Timeline`（`src/types/timeline.ts`）

新增两个可选字段：

```typescript
interface Timeline {
  id: string // 改为 nanoid 生成
  name: string
  description?: string // 新增：用户自定义说明
  fflogsSource?: {
    // 新增：FFLogs 导入来源
    reportCode: string
    fightId: number
  }
  // ...其余字段不变
}
```

### `TimelineMetadata`（`src/utils/timelineStorage.ts`）

同步新增 `description`，用于首页列表展示无需加载完整数据：

```typescript
interface TimelineMetadata {
  id: string
  name: string
  description?: string // 新增
  encounterId: string
  createdAt: string
  updatedAt: string
}
```

注意：`fflogsSource` 不加入 `TimelineMetadata`。首页展示 FFLogs 来源标签由 `TimelineCard.tsx` 通过**已有的** `getTimeline()` 调用读取完整数据实现（该调用为已有逻辑，非本次新增）。

另外，`saveTimeline` 函数中构建 `newMetadata` 的逻辑需同步更新，将 `timeline.description` 写入元数据，确保首页列表能直接读取。

---

## ID 生成

项目中已有 `nanoid@^5.1.6`，在 `src/utils/timelineStorage.ts` 中使用 `customAlphabet`：

```typescript
import { customAlphabet } from 'nanoid'

// 使用纯字母数字字母表（排除默认的 _ 和 -），避免 ID 中出现特殊字符
const generateId = customAlphabet(
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  21
)
```

替换 `createNewTimeline` 函数中的 `timeline-${Date.now()}` 调用。

---

## FFLogs 来源记录

`fflogsImporter.ts` 只提供解析函数（`parseComposition`、`parseDamageEvents`、`parseCastEvents`），不负责构建 Timeline 对象。Timeline 对象完全在 `ImportFFLogsDialog.tsx` 中拼装，因此 `fflogsSource` 也在此处赋值：

### 对话框变更（`src/components/ImportFFLogsDialog.tsx`）

在拼装 Timeline 对象时（与其他字段赋值模式保持一致），直接设置：

```typescript
newTimeline.fflogsSource = {
  reportCode,
  fightId: fightId!, // fightId 在此处已经过 isLastFight 分支处理，与第 181 行保持一致
}
```

同时新增可选的 `description` 输入框（见 UI 变更节）。

---

## UI 变更

### 创建对话框（`src/components/CreateTimelineDialog.tsx`）

在现有名称输入框下方添加可选的 `description` 文本输入框，placeholder 如「可选：为这个时间轴添加简短说明」。

### FFLogs 导入对话框（`src/components/ImportFFLogsDialog.tsx`）

同上，添加可选的 `description` 输入框。

### 首页时间轴列表

`description` 和 `fflogsSource` 的展示均在 `TimelineCard.tsx` 中实现：

- `description` 通过 `TimelineMetadata` 直接可用
- `fflogsSource` 通过已有的 `getTimeline()` 调用读取完整数据

`HomePage.tsx` 无需额外变更（`TimelineMetadata` 接口不变，传参不受影响）。

---

## 受影响文件

| 文件                                      | 变更类型                                                                                                  |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `src/types/timeline.ts`                   | 新增字段                                                                                                  |
| `src/utils/timelineStorage.ts`            | 替换 ID 生成逻辑；更新 TimelineMetadata 接口；修改 saveTimeline 的 newMetadata 构建逻辑以写入 description |
| `src/components/CreateTimelineDialog.tsx` | 新增 description 输入，赋值给 timeline.description                                                        |
| `src/components/ImportFFLogsDialog.tsx`   | 新增 description 输入，赋值 fflogsSource                                                                  |
| `src/components/TimelineCard.tsx`         | 展示 description 和 fflogsSource 来源标签（通过已有的 getTimeline 调用）                                  |

---

## 兼容性

- `description` 和 `fflogsSource` 均为可选字段，已有的本地存储数据无需迁移。
- 旧 ID 格式（`timeline-*`）的已有数据继续正常读取，新建时间轴使用 nanoid。
