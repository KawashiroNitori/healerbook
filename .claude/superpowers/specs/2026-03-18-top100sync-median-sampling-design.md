# top100Sync 中位数采样重构设计

**日期**: 2026-03-18
**状态**: 待实现

## 背景

`top100Sync.ts` 是一个定时任务，每次运行随机采样 10 场战斗，提取伤害/盾值/HP 数据，汇总后存入 KV。

当前问题：

1. 每次运行结果独立计算，不累积历史数据
2. 使用平均值，对异常值敏感
3. 新数据直接覆盖旧数据，历史信息丢失

## 目标

1. 将平均值改为中位数
2. 跨多次运行累积历史样本，持续更新中位数
3. 高频读取的成品数据与低频使用的样本数据分离存储

## 数据结构

### 新增：`EncounterSamples`（样本存储，低频访问）

```typescript
interface EncounterSamples {
  encounterId: number
  /** 每个伤害技能的原始样本值，每个 ability 独立限制 MAX_SAMPLES 条 */
  damageByAbility: Record<number, number[]>
  /** 每个职业（Job 枚举字符串，如 "WHM"）的原始最大 HP 样本值 */
  maxHPByJob: Record<string, number[]>
  /** 每个盾值状态的原始样本值，每个 statusId 独立限制 MAX_SAMPLES 条 */
  shieldByAbility: Record<number, number[]>
  updatedAt: string
}
```

KV 键：`statistics-samples:encounter:{encounterId}`
TTL：无过期（长期保留；副本下线后数据自然停止更新，不需要主动清理）

### 修改：`EncounterStatistics`（成品数据，高频访问）

结构不变，字段注释从"平均值"改为"中位数"：

```typescript
interface EncounterStatistics {
  encounterId: number
  encounterName: string
  /** 每个伤害技能的中位数伤害值 */
  damageByAbility: Record<number, number>
  /** 每个职业的中位数最大生命值 */
  maxHPByJob: Record<string, number>
  /** 每个盾值技能的中位数盾值 */
  shieldByAbility: Record<number, number>
  sampleSize: number
  updatedAt: string
}
```

KV 键：`statistics:encounter:{encounterId}`（不变）
TTL：25 小时（不变）

## 常量

```typescript
const MAX_SAMPLES = 200
```

## 核心算法

### Reservoir Sampling（Algorithm R）

对每个 ability/job 的样本数组独立执行。输入为旧样本数组 `reservoir`（长度 ≤ MAX_SAMPLES）和新数据数组 `incoming`：

```
combined = reservoir + incoming
if combined.length <= MAX_SAMPLES:
  return combined  // 直接追加，无需采样

// 从 combined 中用 Algorithm R 抽取 MAX_SAMPLES 条
result = combined.slice(0, MAX_SAMPLES)
for i from MAX_SAMPLES to combined.length - 1:
  j = random integer in [0, i]
  if j < MAX_SAMPLES:
    result[j] = combined[i]
return result
```

这等价于从 combined 中均匀随机抽取 MAX_SAMPLES 条，历史数据和新数据权重相同。

### 中位数计算

对每个 ability/job 的样本数组独立计算：

```
sorted = values.slice().sort((a, b) => a - b)  // 计算时排序，不预存排序结果
mid = floor(sorted.length / 2)
median = sorted.length % 2 !== 0
  ? sorted[mid]
  : round((sorted[mid - 1] + sorted[mid]) / 2)
```

偶数个样本取两中间值的平均并取整。

## 数据流

```
aggregateStatistics(task, kv):
  1. 读取所有临时战斗数据（FightStatistics[]）
  2. 合并为本批次原始数据：
       batchDamage: Record<number, number[]>
       batchMaxHP:  Record<string, number[]>
       batchShield: Record<number, number[]>
  3. 读取旧 EncounterSamples（若不存在则视为空）
  4. 对每个 key，将 batchData merge 进旧样本（reservoir sampling）
  5. 保存新 EncounterSamples 到 KV
  6. 从合并后样本计算各字段中位数
  7. 保存 EncounterStatistics（成品）到 KV
  8. 清理临时数据
```

### 并发处理

`aggregateStatistics` 已有分布式锁机制（`stats-lock:{encounterId}`），步骤 3-5 在锁保护下执行，race condition 风险与现有实现相同，不引入新问题。

## 变更范围

`top100Sync.ts`：

- 新增 `EncounterSamples` 接口
- 新增 `getSamplesKVKey()` 函数
- 新增 `mergeWithReservoirSampling(reservoir, incoming, max)` 函数
- 新增 `calculateMedian(values)` 函数
- 新增 `calculateMedians(data)` 函数（替换 `calculateAverages()`）
- 修改 `aggregateStatistics()`：读旧样本 → merge → 存样本 → 算中位数 → 存成品
- 删除 `calculateAverages()` 函数
- 更新 `EncounterStatistics` 字段注释
