# PartyState 简化实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 简化 PartyState 结构，分离编辑模式和回放模式的数据流

**Architecture:**

- 编辑模式使用简化的 `PartyState`（单个玩家 + 全局状态）
- 回放模式直接从 `StatusEvent[]` 计算，不构建 PartyState
- 删除 `isPartyWide` 参数，简化执行器逻辑

**Tech Stack:** TypeScript, Zustand, Vitest

---

## 计划文件结构

本实现计划分为三个部分：

1. **Part 1: 类型定义和执行器重构** (`2026-03-16-partystate-simplification-part1.md`)
   - Task 1: 更新 PartyState 类型定义
   - Task 2: 更新友方 Buff 执行器
   - Task 3: 更新盾值执行器
   - Task 4: 更新敌方 Debuff 执行器

2. **Part 2: 技能数据和计算器** (`2026-03-16-partystate-simplification-part2.md`)
   - Task 5: 更新技能数据中的执行器调用
   - Task 6: 更新计算器以支持简化的 PartyState
   - Task 7: 添加回放模式计算方法

3. **Part 3: 状态管理和清理** (`2026-03-16-partystate-simplification-part3.md`)
   - Task 8: 更新 timelineStore
   - Task 9: 更新 useDamageCalculation Hook
   - Task 10: 更新所有测试
   - Task 11: 删除 mitigationStore 中的 isPartyWide 逻辑
   - Task 12: 最终验证和文档更新

---

## 执行顺序

按照以下顺序执行各个部分：

1. 阅读并执行 Part 1（类型定义和执行器）
2. 阅读并执行 Part 2（技能数据和计算器）
3. 阅读并执行 Part 3（状态管理和清理）

每个部分完成后进行 commit，确保代码可以逐步回滚。

---

## 关键变更总结

### 类型变更

**之前**:

```typescript
interface PartyState {
  players: PlayerState[]
  enemy: EnemyState
  timestamp: number
}
```

**之后**:

```typescript
interface PartyState {
  player: PlayerState
  statuses: MitigationStatus[]
  timestamp: number
}
```

### 执行器变更

**之前**:

```typescript
createBuffExecutor(statusId, duration, (isPartyWide = true))
createShieldExecutor(statusId, duration, (isPartyWide = true), shieldMultiplier)
```

**之后**:

```typescript
createBuffExecutor(statusId, duration)
createShieldExecutor(statusId, duration, shieldMultiplier)
```

### 计算器变更

**编辑模式**: 使用 `calculate(damage, partyState, time, damageType)`

**回放模式**: 使用 `calculateFromSnapshot(damage, statusEvents, packetId, damageType, targetPlayerId)`

---

## 预期影响

### 代码简化

- 删除约 100 行代码（buildPartyStateFromStatusEvents 等）
- 执行器逻辑简化 30%
- 消除所有 `players[0]` 数组访问

### 测试更新

- 更新约 20 个测试用例
- 所有测试应保持通过

### 性能影响

- 编辑模式：性能提升（减少数组操作）
- 回放模式：性能持平（直接从快照计算）

---

## 风险和缓解

### 风险 1: 回放模式计算错误

**缓解**: 添加详细的单元测试，对比新旧计算结果

### 风险 2: 类型错误传播

**缓解**: 每个 Task 完成后运行 `tsc --noEmit`

### 风险 3: 测试覆盖率下降

**缓解**: 运行 `pnpm test:run --coverage` 确保覆盖率不低于 67%

---

## 参考文档

- 设计文档: `docs/superpowers/specs/2026-03-16-partystate-simplification-design.md`
- CLAUDE.md: 项目架构说明

---

**开始执行**: 请按顺序阅读并执行 Part 1、Part 2、Part 3
