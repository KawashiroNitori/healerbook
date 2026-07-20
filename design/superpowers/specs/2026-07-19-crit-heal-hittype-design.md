# 暴击治疗量改用 hitType 真实区分设计

**日期**: 2026-07-19
**状态**: 已确认，待实现

## 背景与问题

时间轴统计数据中的"暴击治疗量"（`critHealByAbility`）当前实现为**同一份治疗样本集的 p90 分位数**，与普通治疗量的 p50 共用一份混合样本：

- Worker 侧 TOP100 聚合：`src/workers/top100Sync.ts:289-290`
  ```ts
  healByAbility: calculatePercentiles(mergedHeal),        // p50
  critHealByAbility: calculatePercentiles(mergedHeal, 90), // p90 代理
  ```
- 前端单场导入：`src/utils/fflogsImporter.ts:parseStatData`（普通 p50 / 暴击 p90）

**p90 只是"暴击治疗"的粗略代理，实测偏高**：它取的是全体治疗（含暴击与非暴击）分布的高位数，而非真实暴击治疗事件的中位值。

FFLogs 事件数据本身携带 `hitType`（`src/types/fflogs.ts:104`），治疗事件可据此真实区分暴击/非暴击。`getEvents` 以 `data` 字段返回完整事件 JSON，`Healing` 类型在抓取矩阵中（`src/workers/fflogsClientV2.ts:143`），故 `hitType` 天然可用，无需改查询。

## 目标

改用 `hitType` 真实区分暴击/非暴击治疗事件，**分别各取其 p50**：

- 普通治疗量 = 非暴击样本 p50
- 暴击治疗量 = 暴击样本 p50

## 非目标

- **暴击盾 `critShield` 维持 p90 不变**：盾值样本来自 `absorbed`（盾吸收）事件，其 `hitType` 不表达盾体本身的暴击性，无法同法真实区分。本次仅治疗。
- 不改 `EncounterStatistics` / `TimelineStatData` 的字段与类型（仍为 `Record<number, number>`），仅改其计算方式。
- 不改 FFLogs GraphQL 查询、不改采样队列（queue 行不含样本）。

## 设计

### 1. 暴击判定

- 治疗事件暴击判定：`hitType === 2`，固化为具名常量（如 `HEAL_CRIT_HIT_TYPE = 2`）。
- **实现前先用 `scripts/fetch-events.ts` 拉一份真实报告的治疗事件核验取值**，确认 FFXIV 治疗暴击的 `hitType` 枚举值，避免假设错误。
- 直接治疗与 HoT tick 一视同仁，各按自身 `hitType` 归类。
- `overheal` 事件仍整条剔除（现状不变，避免过量治疗污染样本）。

### 2. 共享提取器 `extractHealData` 改造

`src/utils/fflogsImporter.ts:920` `extractHealData`：

- 返回值从 `Record<number, number[]>` 改为：
  ```ts
  {
    healByAbility: Record<number, number[]>
    critHealByAbility: Record<number, number[]>
  }
  ```
  即**非暴击桶 / 暴击桶**，均按 `abilityGameID` 聚样。
- 分桶条件在现有过滤（`type==='heal'` 且非 `overheal` 且有 `amount`、`abilityGameID`）基础上，仅新增按 `hitType === 2` 归入暴击桶、否则归入非暴击桶。

### 3. 样本结构与平滑过渡

- `EncounterSamples`（`src/workers/encounterStats.ts:5`）新增字段：
  ```ts
  critHealByAbility: Record<number, number[]>
  ```
  原 `healByAbility` 样本语义变为"非暴击治疗样本"。
- `ExtractedFightData`（`src/workers/top100Sync.ts:56`）同步新增 `critHealByAbility`。
- `extractFightStats`（`top100Sync.ts:88`）从 `extractHealData` 返回的两桶分别赋值。
- `processOneSample`（`top100Sync.ts:256`）对暴击桶做 reservoir merge（复用 `mergeRecord`），与其它桶一致；`EncounterSamples` 默认值补 `critHealByAbility: {}`。

**平滑过渡**（用户已确认）：

- 旧 KV 中已累积的混合 `healByAbility` 样本继续留在**非暴击桶**，随后续 TOP100 同步经 reservoir 逐步被真实非暴击样本替换。
- 暴击桶从空开始累积。
- 无需重置、无停机。过渡期内暴击桶偏稀、普通治疗略偏高，会随采样自愈（见下方回退规则兜底）。

### 4. 统一计算口径（抽共享辅助函数，两路共用）

新增一个共享纯函数（放在 `fflogsImporter.ts` 或 `encounterStats.ts`），输入非暴击桶、暴击桶（均为某 key 的样本数组或整份 Record），输出该 key 的普通治疗与暴击治疗值：

对每个技能 key：

- **普通治疗** = `p50(非暴击桶[key])`
  - 非暴击桶为空的极端情况 → 回退 `p50(全部[key])`（全部 = 非暴击 ∪ 暴击）
- **暴击治疗** = 暴击桶[key] 非空 ? `p50(暴击桶[key])` : `p90(全部[key])`
  - 暴击桶为空时回退到 `p90(全部)`，即**沿用当前 P90 估算**（用户已确认）。

应用点：

- Worker 聚合 `top100Sync.ts:289-290`：改为经该辅助函数从 `mergedHeal`（非暴击）+ `mergedCritHeal`（暴击）算出 `healByAbility` / `critHealByAbility`。
- 前端单场导入 `fflogsImporter.ts:994-999` `parseStatData`：`rawHeal` 现为两桶，按同一辅助函数计算，仍分别用 `healKeys` / `critHealKeys` 过滤合法 key。

### 5. 消费方零改动

`EncounterStatistics` / `TimelineStatData` 字段与类型不变，故：

- `src/data/mitigationActions.ts` 三处秘策消费点（185 / 37013 / 3583，行 613/657/764）不动。
- `src/components/StatDataDialog.tsx` 展示/编辑不动。

## 测试

- **`extractHealData` 分桶**（`fflogsImporter.test.ts`）：暴击事件入暴击桶、非暴击入非暴击桶、`overheal` 事件两桶均不计。
- **计算辅助函数**：暴击桶有样本 → p50(暴击)；暴击桶空 → p90(全部) 回退；非暴击桶空 → p50(全部) 回退。
- **改写** `fflogsImporter.test.ts:2258` "暴击治疗走 p90，与普通治疗 p50 区分" 用例为新口径（暴击 = 暴击桶 p50；补 `hitType` 到事件构造）。
- **补 `hitType` / 新桶字段**：`top100Sync.test.ts`、`mitigationActions.test.ts` 中涉及治疗样本的用例。
- 全量 `pnpm test:run` + `pnpm lint` + `pnpm exec tsc --noEmit` 通过。

## 影响文件清单

| 文件                            | 改动                                                                                               |
| ------------------------------- | -------------------------------------------------------------------------------------------------- |
| `src/utils/fflogsImporter.ts`   | `extractHealData` 双桶返回；`parseStatData` 用共享计算；新增暴击判定常量 + 计算辅助函数            |
| `src/workers/encounterStats.ts` | `EncounterSamples` 增 `critHealByAbility`                                                          |
| `src/workers/top100Sync.ts`     | `ExtractedFightData` 增字段；`extractFightStats` / `processOneSample` 处理暴击桶；聚合改用共享计算 |
| 对应 `*.test.ts`                | 按新口径更新/新增用例                                                                              |
