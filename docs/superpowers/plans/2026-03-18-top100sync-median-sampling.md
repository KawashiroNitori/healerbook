# top100Sync 中位数采样重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 top100Sync 的统计汇总逻辑从平均值改为中位数，并通过 reservoir sampling 跨多次运行累积历史样��，同时将样本数据与成品数据分离存储。

**Architecture:** 新增 `EncounterSamples` 接口存储原始样本（低频访问），`EncounterStatistics` 保持不变仅更新注释（高频访问）。每次 `aggregateStatistics` 运行时读取旧样本、用 Algorithm R 合并新数据、计算中位数后写回两个独立 KV 键。

**Tech Stack:** TypeScript, Cloudflare Workers, Cloudflare KV

---

### Task 1: 新增纯函数 + 单元测试

**Files:**
- Modify: `src/workers/top100Sync.ts`
- Modify: `src/workers/top100Sync.test.ts`（若不存在则创建）

- [ ] **Step 1: 确认测试文件是否存在**

```bash
ls src/workers/top100Sync.test.ts 2>/dev/null || echo "not found"
```

- [ ] **Step 2: 写失败测试 — `mergeWithReservoirSampling`**

在测试文件中添加：

```typescript
import { mergeWithReservoirSampling, calculateMedian } from './top100Sync'

describe('mergeWithReservoirSampling', () => {
  it('总量未超上限时直接追加', () => {
    const result = mergeWithReservoirSampling([1, 2, 3], [4, 5], 10)
    expect(result).toEqual([1, 2, 3, 4, 5])
  })

  it('总量超上限时结果长度等于 max', () => {
    const reservoir = Array.from({ length: 10 }, (_, i) => i)
    const incoming = Array.from({ length: 5 }, (_, i) => i + 100)
    const result = mergeWithReservoirSampling(reservoir, incoming, 10)
    expect(result).toHaveLength(10)
  })

  it('空旧样本时直接返回新数据（不超限）', () => {
    const result = mergeWithReservoirSampling([], [1, 2, 3], 10)
    expect(result).toEqual([1, 2, 3])
  })

  it('空新数据时返回旧样本', () => {
    const result = mergeWithReservoirSampling([1, 2, 3], [], 10)
    expect(result).toEqual([1, 2, 3])
  })
})

describe('calculateMedian', () => {
  it('奇数个样本', () => {
    expect(calculateMedian([3, 1, 2])).toBe(2)
  })

  it('偶数个样本', () => {
    expect(calculateMedian([1, 2, 3, 4])).toBe(3) // round((2+3)/2)
  })

  it('偶数个样本，中间两值之和为奇数（.5 舍入）', () => {
    expect(calculateMedian([1, 2])).toBe(2) // round((1+2)/2) = round(1.5) = 2
  })

  it('单个样本', () => {
    expect(calculateMedian([42])).toBe(42)
  })

  it('空数组返回 0', () => {
    expect(calculateMedian([])).toBe(0)
  })
})
```

- [ ] **Step 3: 运行测试确认失败**

```bash
pnpm test:run src/workers/top100Sync.test.ts
```

期望：FAIL，提示 `mergeWithReservoirSampling` 未导出

- [ ] **Step 4: 在 `top100Sync.ts` 中实现两个纯函数**

在 `calculateAverages` 函数之前添加：

```typescript
const MAX_SAMPLES = 200

/**
 * Reservoir Sampling（Algorithm R）
 * 从 reservoir + incoming 中均匀随机保留 max 条样本
 */
export function mergeWithReservoirSampling(
  reservoir: number[],
  incoming: number[],
  max: number = MAX_SAMPLES
): number[] {
  const combined = [...reservoir, ...incoming]
  if (combined.length <= max) return combined

  const result = combined.slice(0, max)
  for (let i = max; i < combined.length; i++) {
    const j = Math.floor(Math.random() * (i + 1))
    if (j < max) result[j] = combined[i]
  }
  return result
}

/**
 * 计算中位数并取整
 */
export function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = values.slice().sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}
```

- [ ] **Step 5: 运行测试确认通过**

```bash
pnpm test:run src/workers/top100Sync.test.ts
```

期望：所有测试 PASS

- [ ] **Step 6: Commit**

```bash
git add src/workers/top100Sync.ts src/workers/top100Sync.test.ts
git commit -m "feat: 新增 mergeWithReservoirSampling 和 calculateMedian 纯函数"
```

---

### Task 2: 新增 `EncounterSamples` 接口和 KV 键函数

**Files:**
- Modify: `src/workers/top100Sync.ts`

- [ ] **Step 1: 在 `EncounterStatistics` 接口之后添加 `EncounterSamples` 接口**

```typescript
/** 样本存储（低频访问，供定时任务读写） */
export interface EncounterSamples {
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

- [ ] **Step 2: 在 `getStatisticsKVKey` 之后添加 `getSamplesKVKey`**

```typescript
/** 获取样本数据的 KV 键名 */
export function getSamplesKVKey(encounterId: number): string {
  return `statistics-samples:encounter:${encounterId}`
}
```

- [ ] **Step 3: 更新 `EncounterStatistics` 字段注释**

将三个字段注释从"平均值/平均"改为"中位数"：

```typescript
/** 每个伤害技能的中位数伤害值 */
damageByAbility: Record<number, number>
/** 每个职业的中位数最大生命值 */
maxHPByJob: Record<string, number>
/** 每个盾值技能的中位数盾值 */
shieldByAbility: Record<number, number>
```

- [ ] **Step 4: 写测试验证 KV 键格式**

```typescript
import { getSamplesKVKey } from './top100Sync'

describe('getSamplesKVKey', () => {
  it('返回正确格式', () => {
    expect(getSamplesKVKey(1234)).toBe('statistics-samples:encounter:1234')
  })
})
```

- [ ] **Step 5: 运行测试**

```bash
pnpm test:run src/workers/top100Sync.test.ts
```

期望：PASS

- [ ] **Step 6: Commit**

```bash
git add src/workers/top100Sync.ts src/workers/top100Sync.test.ts
git commit -m "feat: 新增 EncounterSamples 接口和 getSamplesKVKey"
```

---

### Task 3: 新增 `calculateMedians` 函数，替换 `calculateAverages`

**Files:**
- Modify: `src/workers/top100Sync.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { calculateMedians } from './top100Sync'

describe('calculateMedians', () => {
  it('计算每个 key 的中位数', () => {
    const result = calculateMedians({ 100: [1, 3, 5], 200: [2, 4] })
    expect(result[100]).toBe(3)
    expect(result[200]).toBe(3) // round((2+4)/2)
  })

  it('空数组的 key 不出现在结果中', () => {
    const result = calculateMedians({ 100: [], 200: [5] })
    expect(result[100]).toBeUndefined()
    expect(result[200]).toBe(5)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm test:run src/workers/top100Sync.test.ts
```

- [ ] **Step 3: 实现 `calculateMedians`，删除 `calculateAverages`**

将 `calculateAverages` 函数替换为：

```typescript
/**
 * 对 Record<K, number[]> 中每个 key 计算中位数
 */
function calculateMedians<T extends number | string>(
  data: Record<T, number[]>
): Record<T, number> {
  const result: Record<string, number> = {}
  for (const [key, values] of Object.entries(data)) {
    if (Array.isArray(values) && values.length > 0) {
      result[key] = calculateMedian(values as number[])
    }
  }
  return result as Record<T, number>
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm test:run src/workers/top100Sync.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/workers/top100Sync.ts src/workers/top100Sync.test.ts
git commit -m "refactor: 用 calculateMedians 替换 calculateAverages"
```

---

### Task 4: 修改 `aggregateStatistics` 实现 merge + 中位数逻辑

**Files:**
- Modify: `src/workers/top100Sync.ts`

- [ ] **Step 1: 将 `aggregateStatistics` 替换为以下实现**

```typescript
async function aggregateStatistics(task: StatisticsTask, kv: KVNamespace): Promise<void> {
  console.log(`[Statistics] 开始汇总数据: encounter ${task.encounterId}`)

  const batchDamage: Record<number, number[]> = {}
  const batchMaxHP: Record<string, number[]> = {}
  const batchShield: Record<number, number[]> = {}

  // Step 1: 读取本批次所有临时战斗数据
  for (const battle of task.fights) {
    const key = getFightStatisticsKVKey(task.encounterId, battle.reportCode, battle.fightID)
    const data = await kv.get(key, 'json')
    if (!data) continue

    const battleStats = data as FightStatistics

    for (const [abilityId, damages] of Object.entries(battleStats.damageByAbility)) {
      const id = Number(abilityId)
      if (!batchDamage[id]) batchDamage[id] = []
      batchDamage[id].push(...(damages as number[]))
    }

    for (const [abilityId, shields] of Object.entries(battleStats.shieldByAbility)) {
      const id = Number(abilityId)
      if (!batchShield[id]) batchShield[id] = []
      batchShield[id].push(...(shields as number[]))
    }

    for (const [job, hps] of Object.entries(battleStats.maxHPByJob)) {
      if (!batchMaxHP[job]) batchMaxHP[job] = []
      batchMaxHP[job].push(...(hps as number[]))
    }
  }

  // Step 2: 读取旧样本（不存在则视为空）
  const oldSamplesRaw = await kv.get(getSamplesKVKey(task.encounterId), 'json')
  const oldSamples = (oldSamplesRaw as EncounterSamples | null) ?? {
    encounterId: task.encounterId,
    damageByAbility: {},
    maxHPByJob: {},
    shieldByAbility: {},
    updatedAt: '',
  }

  // Step 3: Merge 新数据进历史样本（reservoir sampling）
  const mergedDamage: Record<number, number[]> = { ...oldSamples.damageByAbility }
  for (const [id, values] of Object.entries(batchDamage)) {
    const key = Number(id)
    mergedDamage[key] = mergeWithReservoirSampling(mergedDamage[key] ?? [], values as number[])
  }

  const mergedShield: Record<number, number[]> = { ...oldSamples.shieldByAbility }
  for (const [id, values] of Object.entries(batchShield)) {
    const key = Number(id)
    mergedShield[key] = mergeWithReservoirSampling(mergedShield[key] ?? [], values as number[])
  }

  const mergedMaxHP: Record<string, number[]> = { ...oldSamples.maxHPByJob }
  for (const [job, values] of Object.entries(batchMaxHP)) {
    mergedMaxHP[job] = mergeWithReservoirSampling(mergedMaxHP[job] ?? [], values as number[])
  }

  // Step 4: 保存新样本（无 TTL）
  const newSamples: EncounterSamples = {
    encounterId: task.encounterId,
    damageByAbility: mergedDamage,
    maxHPByJob: mergedMaxHP,
    shieldByAbility: mergedShield,
    updatedAt: new Date().toISOString(),
  }
  await kv.put(getSamplesKVKey(task.encounterId), JSON.stringify(newSamples))

  // Step 5: 计算中位数并保存成品
  const statistics: EncounterStatistics = {
    encounterId: task.encounterId,
    encounterName: task.encounterName,
    damageByAbility: calculateMedians(mergedDamage),
    maxHPByJob: calculateMedians(mergedMaxHP),
    shieldByAbility: calculateMedians(mergedShield),
    // sampleSize 反映历史累积样本总数（取 damage 样本数之和作为代表）
    sampleSize: Object.values(mergedDamage).reduce((sum, arr) => sum + arr.length, 0),
    updatedAt: new Date().toISOString(),
  }

  await kv.put(getStatisticsKVKey(task.encounterId), JSON.stringify(statistics), {
    expirationTtl: 25 * 60 * 60,
  })

  // Step 6: 清理临时数据
  await Promise.all([
    kv.delete(getStatisticsTaskKVKey(task.encounterId)),
    kv.delete(`stats-lock:${task.encounterId}`),
    ...task.fights.map(f =>
      kv.delete(getFightStatisticsKVKey(task.encounterId, f.reportCode, f.fightID))
    ),
    ...task.fights.map(f =>
      kv.delete(`fight-completed:${task.encounterId}:${f.reportCode}:${f.fightID}`)
    ),
  ])

  const totalSamples = Object.values(mergedDamage).reduce((sum, arr) => sum + arr.length, 0)
  console.log(
    `[Statistics] 汇总完成: encounter ${task.encounterId}, 本批次 ${task.totalFights} 场, 累计样本 ${totalSamples} 条`
  )
}
```

- [ ] **Step 2: 构建检查**

```bash
pnpm build 2>&1 | head -30
```

期望：无 TypeScript 错误

- [ ] **Step 3: 运行全部测试**

```bash
pnpm test:run
```

期望：全部 PASS

- [ ] **Step 4: Commit**

```bash
git add src/workers/top100Sync.ts
git commit -m "feat: aggregateStatistics 改用 reservoir sampling + 中位数，样本数据分离存储"
```
