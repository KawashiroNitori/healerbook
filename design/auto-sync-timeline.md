# 时间轴自动 Sync 设计（草案）

> 草案阶段，暂不实现。记录从 ff14-overlay-vue 逆向分析与多轮讨论后得到的设计思路，供后续实现参考。

## 背景

ff14-overlay-vue 的时间轴 sync 机制依赖 `src/resources/timelineSpecialRules.ts` 这份手工维护的表：每个副本每个关键技能的 `actionId` → `{ type, window, syncOnce?, battleOnce? }` 都由人工逐条添加。每出一个新副本就要手动追加条目，非常费力，且容易漏。

本项目（Healerbook）的导出流程若要复用这种 sync 机制，不应该再手写一份特殊规则表，而应依靠已有的 FFLogs 数据采样能力自动生成 sync 锚点。

## 目标

- 从多场 FFLogs 战斗记录自动推导出一组 sync 锚点（actionId + 时间 + window）。
- 对随机序列、中途团灭、推进点时间漂移等常见噪声鲁棒。
- 保留人工校准入口，不追求全自动。
- 生成结果可序列化、可复用，与 FFLogs 原始数据解耦。

## 核心难点

1. **数据不完整**：FFLogs 导入样本多为团灭记录，每场覆盖不同时间段，没有一场能覆盖全程。
2. **随机机制**：部分 BOSS（如 P8S 赫淮斯托斯）存在双轴或多轴随机序列，同一技能在不同 log 中出现在不同时间。
3. **推进点漂移**：可推进阶段（Ultimate 等）每个 log 的阶段切换时间不同，绝对时间不可直接比较。
4. **周期性技能**：autoattack、普通循环技能在一场 log 里会出现多次，不适合作为 sync 锚点。
5. **Window 安全边界**：window 决定 runtime 匹配容差，过窄会漏 sync，过宽会跨阶段误匹配。

## 自动生成策略

### 阶段 1：数据归集

对每个副本聚合 N 场 FFLogs 战斗的 cast 事件：

```
Record<actionId, Array<{ logId, relativeTime, type }>>
```

`relativeTime` 以战斗开始为 0 点。

### 阶段 2：每 log 出现次数统计

对每个 `actionId`，分别统计它在每个 log 中出现了多少次：

- **per-log count === 1** 的技能 → 候选 sync 锚点
- **per-log count > 1** 的技能 → 周期性技能，直接排除（不能作为锚点）

这是关键过滤：先按 log 分组计数，再跨 log 判断，能正确区分"不同 log 出现在不同时间的随机技能（仍是每 log 1 次）"和"同一 log 内重复出现的周期技能"。

### 阶段 3：时间聚类

对候选锚点，把它在不同 log 中的出现时间做 1D 聚类：

- 排序后按 gap > 阈值（建议 3–5 秒，现代非推进内容足够）切分簇。
- 每个簇代表一个潜在的 sync 时机。

随机多轴 BOSS 会产生多个簇（每个可能序列一个），周期技能在阶段 2 已经被过滤，不会干扰。

### 阶段 4：簇质量评估与分层

对每个簇计算：

- 样本数 `n` / 总 log 数 `N` → 覆盖率
- 时间 stddev `σ`
- 平均时间 `μ`

分三档：

| 档位        | 条件                            | 默认行为             |
| ----------- | ------------------------------- | -------------------- |
| 🟢 自动采纳 | 覆盖率 ≥ 80% 且 `σ < 2s`        | 默认勾选生成 sync 行 |
| 🟡 待确认   | 覆盖率 40–80% 或 `σ ∈ [2s, 5s]` | 默认不勾选，列出理由 |
| 🔴 排除     | 覆盖率 < 40% 或 `σ ≥ 5s`        | 折叠隐藏             |

### 阶段 5：Window 生成

自动 window 取 `[μ - 2σ, μ + 2σ]`，向上取整到 0.5 秒，最小 2.5 秒。

ff14-overlay-vue 的规则：

- `syncOnce`: 运行时只触发一次同步（写入时间轴文本为 `once` 关键字）
- `battleOnce`: 生成期去重标记（不写入文本，仅控制一个 actionId 只生成一条 sync 行）

自动生成阶段只需决定 `syncOnce`：若同一 actionId 只产生一个采纳簇则默认 `once`，多个簇则都不加 `once`（运行时都可能触发）。

## 人工校准 UI

导入对话框提供以下交互，尽量避免让用户改代码：

1. **候选分层展示**：按 🟢/🟡/🔴 分组，用户勾选采纳项。
2. **Window 覆盖**：滑块调整 σ 倍率，或直接填数字；同步显示"覆盖 X/N 场样本"。
3. **Phase 锚点标注**：用户点某行标记为推进点，之后的 sync 改为相对该锚点的相对时间，解决推进漂移。
4. **样本过滤**：列出每场 wipe 的持续时间与最后命中技能，用户可排除异常样本后重新聚类。
5. **持久化校准结果**：存为 JSON（按副本组织），与 FFLogs 原始数据分离，重生成时不丢人工调整。

## 数据结构草图

```ts
interface AutoSyncCandidate {
  actionId: number
  name: string
  type: 'cast' | 'begincast'
  clusters: AutoSyncCluster[]
}

interface AutoSyncCluster {
  meanTime: number
  stddev: number
  coverage: number // 0..1
  samples: { logId: string; time: number }[]
  tier: 'accept' | 'review' | 'reject'
  windowBefore: number
  windowAfter: number
  syncOnce: boolean
}

interface AutoSyncCalibration {
  encounterId: number
  acceptedClusters: string[] // cluster 唯一 id
  overrides: Record<string, Partial<AutoSyncCluster>>
  excludedLogs: string[]
  phaseAnchors: { clusterId: string; label: string }[]
  updatedAt: string
}
```

## 实现阶段建议

1. 先做阶段 1–3 的纯计算逻辑，输出 JSON 到 `analysis/` 供离线验证。
2. 接入现有 cron 采样管道，批量产出候选结果。
3. 再做 UI 层，先只展示分层列表与勾选，window 调整与 phase 锚点放后续迭代。
4. 最后接入 export-souma 的实际输出路径，替换目前可能的手工 sync 逻辑。

## 开放问题

- 推进内容（Ultimate）的阶段对齐算法：需要先识别 phase 切换事件，再把每 log 时间转换为"相对阶段起点"。这套识别逻辑单独值得一份设计。
- 采样规模：多少场 log 够用？初步估计 20–50 场，实际需实验。
- 跨版本 patch 的技能 ID 变化如何处理：可能需要按 patch 版本隔离候选集。

## 参考

- `3rdparty/ff14-overlay-vue/src/resources/timelineSpecialRules.ts` — 手工规则表现状
- `3rdparty/ff14-overlay-vue/src/pages/timeline.vue` — runtime sync 匹配逻辑
- `3rdparty/ff14-overlay-vue/src/store/timeline.ts` `parseTimeline()` — sync 文本解析
- `3rdparty/ff14-overlay-vue/src/components/timeline/FflogsImport.vue` — 当前 FFLogs 导入生成逻辑
