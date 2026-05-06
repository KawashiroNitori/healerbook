# HP 模拟 · 上下文恢复

> 日期：2026-04-28
> 分支：`feat/hp-simulate`
> 关联：[spec](./specs/2026-04-28-hp-simulate-design.md) · [plan](./plans/2026-04-28-hp-simulate.md)

## 一句话

编辑模式下，给非坦聚合 HP 池建立累积演化模型——AOE / partial AOE 累积扣血、cast 治疗 + HoT 补回、maxHP buff 同步伸缩；坦专事件不入池。

## 当前状态

✅ **基础设施完整**，**644 测试 PASS**、tsc / lint / build 干净。
❌ **未实际给治疗 action 挂 executor**——本期 plan 调研发现现有 `category: 'heal'` 的 9 个 action 全部已用 `createBuffExecutor`（buff-trigger 模式），不能直接覆盖；新增独立治疗 action 超出本期范围。spec §4.5 mapping 表已注释在 `mitigationActions.ts` 顶部。

## 13 个 commit（按时序）

```
905014b types  - HpPool / HealSnapshot / PerformanceType.selfHeal
87886d6 utils  - healMath（含 isTankOnly 过滤）
01f2b88 exec   - createHealExecutor
9629991 exec   - createRegenExecutor + regenStatusExecutor.onTick
4dc9221 sim    - simulate 主循环 HP 演化（partial 段累积、maxHP 同步、healSnapshots）
30a0448 hook   - useDamageCalculation 透传 healSnapshots + e2e 测试
1e2e2a7 ui     - PropertyPanel 累积视角
a64d2a1 fix    - partial 段公式 finalDamage（plan typo 修正）
22a620d docs   - mitigationActions.ts 接入进度注释
51ac7f8 fix    - 移除主循环 hp 覆盖（让钩子改 hp 生效）
98f3db1 sim    - 钩子 ctx 注入 recordHeal（让钩子 push HealSnapshot）
2b21cf0 ui     - 卡片/表格致死判定切累积视角
8f6ddbc fix    - 坦专 fallback 阈值对齐 5%
```

## 核心架构 cheat sheet

| 维度             | 决定                                                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| 模拟范围         | 编辑模式非坦聚合 HP 池；回放模式永不参与                                                                          |
| 粒度             | 单条 `PartyState.hp: HpPool`（不分玩家、不分坦克）                                                                |
| 治疗模型         | `createHealExecutor`（cast 时刻直接 +amount）+ `createRegenExecutor`（HoT，每 3s onTick）                         |
| HoT tickAmount   | snapshot-on-apply（cast 时锁定，写进 `status.data.tickAmount`）                                                   |
| heal vs selfHeal | `heal` = 全队作用域；`selfHeal` = 仅 `status.sourcePlayerId === castSourcePlayerId` 时生效                        |
| status 过滤      | 只消费 `!meta.isTankOnly` 的 status（坦专 buff 不污染非坦池）                                                     |
| partial 段       | `dealt = max(0, finalDamage − segMax)`；aoe 打断段 + 全额扣；pfaoe 与 paoe 同算法 + 段结束；tank/auto/heal 段穿透 |
| 重置规则         | 永不自动归满（只能靠治疗）；段结束不归满                                                                          |
| HP 边界          | clamp 到 `[0, hp.max]`（不允许负数）；overkill 单独记录                                                           |
| 接入路径         | HP 池作 `PartyState.hp`，与 status 同 simulate 主循环演化                                                         |
| 同时刻排序       | `expire → tick → cast → damage`                                                                                   |
| 暴击治疗         | 永不消费 `critHealByAbility`（永远取中位）                                                                        |

## 关键代码位置

```
src/types/partyState.ts         HpPool / PartyState.hp?
src/types/healSnapshot.ts       HealSnapshot
src/types/status.ts             PerformanceType.selfHeal；StatusExecutor 4 钩子 ctx 都含 recordHeal?
src/types/mitigation.ts         ActionExecutionContext.castEventId/recordHeal
src/executors/healMath.ts       computeFinalHeal / computeMaxHpMultiplier（isTankOnly 过滤）
src/executors/createHealExecutor.ts
src/executors/createRegenExecutor.ts  含 regenStatusExecutor.onTick
src/utils/mitigationCalculator.ts:
  ~270  applyDamageToHp（partial 段累积器）
  ~340  recomputeHpMax（按比例同步伸缩 hp.current）
  ~620  simulate 主循环 hp 演化嵌入点
src/hooks/useDamageCalculation.ts     return.healSnapshots
src/components/PropertyPanel.tsx
  ~140  renderHpBarAccumulative
  ~205  renderPartialSegInfo
src/components/Timeline/DamageEventCard.tsx
src/components/TimelineTable/TableDataRow.tsx     致死判定累积视角分流
```

## 用户/Reviewer 留下的陷阱

1. **commit 信息严禁含 "Claude"**——`.husky/commit-msg` 拒。也不加 `Co-Authored-By`。
2. **不在代码注释 / 文档里硬编 FF14 具体技能名**——容易幻觉，用功能性描述。
3. **`MITIGATION_DATA.actions` 中现有 `category: 'heal'` action 已挂 executor**，不能直接覆盖。新接入要么新增 action，要么改成"先 heal 后 buff" 的组合 executor。
4. **三视图致死判定（PropertyPanel / 卡片 / 表格）目前重复 3 份**，公式：`isLethal = hpAfter === 0 && overkill > 0`、`isDangerous = hpAfter / hpMax < 0.05`（坦专 fallback 用 `damage >= refHP * 0.95`）。任一处改要同步三处——见后续工作 #1。
5. **`result.hpSimulation` 是 simulate 主循环里后置 mutate 的**——`damageResults.set(id, result)` 之后才赋值。simulate 跑完后读 `damageResults.get(id)` 是完整的，但**不要在 simulate 内部缓存 result 副本**，会拿到 hpSimulation=undefined。见后续工作 #2。
6. **HoT 写进 `status.data` 的两个字段名硬编为 `tickAmount` / `castEventId`**（`createRegenExecutor.ts` 写、`onTick` 读），未来加第三字段时考虑封装 `RegenStatusData` 类型。
7. **多坦 perVictim 路径下"反应式治疗钩子改 hp" 仅取 bestBranch 的修改**——同 buff 在不同 tank 分支触发会丢，本期不解决（spec 列了 future work）。

## 还能/想做（按优先级）

### 阻塞性 = 0，纯清扫（小成本）

- **#A util 提取 `deriveLethalDangerous(hpSim, finalDamage, refHP, hasOverkill)`**——三视图共用一处计算，未来加主轨道 HP 曲线第四视图时只改一处
- **#B `result.hpSimulation` 改成构造时合并**——`damageResults.set(id, { ...result, hpSimulation })`，消除"放进 Map 后 mutate" 的语义瑕疵
- **#C `healSnapshots` 出口加 `.sort((a, b) => a.time - b.time)`**——把 spec 注释承诺的"按 time 升序"从流程惯性升级为出口保证

### 业务功能（中成本）

- **治疗 action 实际接入**：按 spec §4.5 mapping 表给具体 action 挂 executor / heal 倍率（要么新增独立治疗 action，要么改组合 executor）
- **手动重置锚点**：用户在时间轴某点打"假设此处归满"标记。`applyDamageToHp` 加 `HpResetMarker` event 类型即可
- **主时间轴 HP 曲线 overlay**：Konva `<SkillTracksCanvas>` 叠加绿色折线，hover 展示该时刻 hp/治疗/伤害明细。消费 `simulateOutput.healSnapshots` + `damageResults.*.hpSimulation`
- **治疗 cast / HoT tick 详情面板**：PropertyPanel 选中 cast event 时展示 `healSnapshots` 中对应 castEventId 的条目（applied / overheal / finalHeal）
- **治疗效率统计**：聚合 `Σ overheal / Σ finalHeal`，按 sourcePlayerId / actionId 分组

### 已知限制（暂不修）

- partial 段无超时（永不自动结束，必须靠 aoe / pfaoe 收尾）
- 多坦 perVictim 路径下钩子改 hp 仅取 bestBranch 修改（要支持 per-tank HP 池才能解决）
- per-player HP 池（坦克 HP 模拟、个体 HP 演化）

## 测试入口

```bash
pnpm test:run src/utils/mitigationCalculator.test.ts -t "HP 池"          # 8 + 1 + 1 用例（partial 段、maxHP buff、钩子改 hp、recordHeal）
pnpm test:run src/executors/healMath.test.ts                              # 12 用例
pnpm test:run src/executors/createHealExecutor.test.ts                    # 6 用例
pnpm test:run src/executors/createRegenExecutor.test.ts                   # 9 用例
pnpm test:run src/hooks/useDamageCalculation.test.ts -t "HP 模拟端到端"   # 1 用例
pnpm test:run                                                             # 全量 644
```
