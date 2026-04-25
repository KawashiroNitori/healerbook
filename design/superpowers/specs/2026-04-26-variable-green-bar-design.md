# 可变长度绿条 设计文档

**日期**: 2026-04-26
**状态**: spec drafted

## 背景与动机

当前技能的"绿条"（持续时间条）按 `action.duration` 静态绘制，配合"同 trackGroup
下一 cast"做视觉截短。这与 buff/盾的真实生命周期可能不一致——例如盾被打穿后绿条
仍在显示，造成"绿条还在但盾已经没了"的视觉撒谎。

短期需求：盾被打穿、被同类替换、自然过期 → 绿条应同步在那一刻收束，末尾文字
反映真实存活时长。

中期需求（实现尚未落地，但本设计须为它腾出空间）：

- **延长**：阳星合相 cast 把现存的 天宫图 buff 延长 30s
- **变身**：天宫图 → 阳星天宫图（statusId 改、duration 延长）
- **立即结束 / 引爆**：地星、礼仪之铃、天宫图、大宇宙在持续时间内手动引爆，buff
  立即消失，原 cast 的绿条立即结束

## 核心原则

**一条 cast 的绿条 = 该 cast 在 `simulate` 输出里附着 instance 的实际存活区间。**

- 不再有"`action.duration` 固定值"作为绿条数据源——`action.duration` 仅在 cast
  没有产生任何 status 时作为兜底
- 多 status cast 取 `max(interval.to)`（与现有 `action.duration` 默认值口径一致）
- 末尾文字显示真实存活秒数（`Math.round(actualEnd - timestamp)`）
- 删除"同 trackGroup 下一 cast"对绿条的视觉截短——uniqueGroup 替换路径的截短
  完全由 simulator 通过 instanceId diff 自动收束

## 数据流改动

### simulator 层（`src/utils/mitigationCalculator.ts`）

`SimulateOutput` 新增字段：

```ts
interface SimulateOutput {
  damageResults: Map<string, CalculationResult>
  statusTimelineByPlayer: Map<number, Map<number, StatusInterval[]>>
  /**
   * castEvent.id → 该 cast 附着 instance 中最大的实际收束时刻。
   * 无附着（cast 无 executor / executor 没新建任何 status）→ 不进表，渲染层退化到 action.duration。
   * seeded buff（无 cast 来源、sourceCastEventId === ''）→ 不进表。
   */
  castEffectiveEndByCastEventId: Map<string, number>
}
```

填充点：`pushInterval(rec, to)` 是 simulator 里**唯一**关闭 interval 的地方
（自然过期 / 盾击穿 / uniqueGroup 替换 / 未来 detonation 都经此点）。在那行后追加：

```ts
if (rec.sourceCastEventId !== '') {
  const prev = castEffectiveEndByCastEventId.get(rec.sourceCastEventId) ?? -Infinity
  castEffectiveEndByCastEventId.set(rec.sourceCastEventId, Math.max(prev, to))
}
```

walk 结束时仍未关闭的 interval 由现有 `for (const [, rec] of open) { pushInterval(rec, rec.endTime) }`
覆盖，自动写入正确的 max。

### context 层

- `DamageCalculationResult` 透传 `castEffectiveEndByCastEventId`
- `src/contexts/DamageCalculationContext.ts` 新增 `useCastEffectiveEnd()` hook
- `src/hooks/useDamageCalculation.ts` 把 simulate 的新字段穿透到 context value

## 渲染层改动

### `SkillTracksCanvas`（`src/components/Timeline/SkillTracksCanvas.tsx`）

```ts
const castEffectiveEnd = useCastEffectiveEnd()

// 渲染循环里，每条 cast：
const fallbackEnd = castEvent.timestamp + action.duration
const effectiveEndSec = castEffectiveEnd.get(castEvent.id) ?? fallbackEnd
```

- 删除 `nextCastTime` 在绿条侧的所有用途
- `visibleBarsByTrack`（用于不可放阴影减算）的 `effectiveDuration` 也换成
  `effectiveEndSec - ce.timestamp`，否则 cd shadow 与绿条会脱节

### `CastEventIcon`（`src/components/Timeline/CastEventIcon.tsx`）

接口变更：

- **新增 prop**：`effectiveEndSec: number`
- 内部 `effectiveDuration = effectiveEndSec - castEvent.timestamp` 替代原来基于
  `action.duration` 的计算
- `nextCastTime: number` prop 是否保留：取决于 cdBar 侧验证结果（见下文）。
  cdBar 仍需要它则保留；引擎已自处理则一并删除

末尾文字内容与阈值：

```tsx
{effectiveDuration >= 3 && (
  <Text
    text={`${Math.round(effectiveDuration)}s`}
    x={effectiveDuration * zoomLevel - 32}
    ...
  />
)}
```

cdBar 那侧的 `nextCastTime` 截短独立于绿条改造——实现时需核对
`PlacementEngine.cdBarEndFor` 是否已经处理"下一 cast 砍齐 cd"，决定是否同步删除
那一处的 `nextCastTime` 兜底。如未处理则保留，仅删除绿条侧的截短。

## Executor 写作规范（影响中期需求）

simulator 的 `captureTransition` 用 instanceId 集合 diff 判定 buff 的
attach / persist / consume，并据此驱动绿条长度、status interval 等 UI 数据。

**核心约束：修改既有 status 时必须保持 `instanceId` 不变。**

| 场景                              | 写法                                                                                    |
| --------------------------------- | --------------------------------------------------------------------------------------- |
| 延长持续时间                      | `statuses.map(s => s.instanceId === id ? { ...s, endTime: s.endTime + 30 } : s)`        |
| 变身（statusId 改、其它字段同步） | `statuses.map(s => s.instanceId === id ? { ...s, statusId: NEW_ID, endTime: ... } : s)` |
| 立即结束 / 引爆                   | `statuses.filter(s => s.instanceId !== id)`                                             |

**反例**：

```ts
// ❌ filter 掉旧 instance，再 push 一条新 instanceId
const filtered = statuses.filter(s => s.instanceId !== target.instanceId)
return [...filtered, { ...target, instanceId: generateId(), endTime: ... }]
```

后果：原 cast 的 interval 被收束到此刻，新 instance 被错误归属到当前 cast；
原 cast 的绿条会"断开 + 另起一条"，而不是延长。

**真的"换主人"了的例外**：极少数场景（buff 转给另一个 cast 接管），新建 instanceId
是正确语义——这条 interval 归新 cast，原 cast 的绿条收束在转移时刻。绝大多数
extension / transformation / detonation 都不属于这种情况。

文档分布：

- `src/types/status.ts` 的 `MitigationStatus.instanceId` 字段注释（详尽正反例，权威）
- `CLAUDE.md` 新增 "2.1. Executor 写作规范"（短，10 行内，作为 agent 入场视野）
- 不再单独建 `src/executors/README`——三处同义文档容易腐坏

## 边界场景与回退

| 场景                                                         | 行为                                                                                                            |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| cast 无 executor                                             | `castEffectiveEnd.get(id)` miss → 退化到 `timestamp + action.duration`                                          |
| cast 有 executor 但没新建任何 status                         | 同上，退化                                                                                                      |
| `simulate === null`（未挂 DamageCalculationProvider）        | 整张 Map 为空，全部 cast 退化到 `action.duration`，与现状字面一致                                               |
| `action.duration === 0`                                      | 不画绿条（沿用现有 `action.duration > 0` guard）                                                                |
| 多坦路径不同 victim 看到不同的盾消耗顺序                     | simulator 用 `perVictim[0]`（按 finalDamage 升序的最优分支）作为后续状态来源；`castEffectiveEnd` 跟此主路径一致 |
| 同一 cast 既附 buff 又附 shield，shield 先被打穿但 buff 还活 | `max(interval.to)` → 取 buff 那条；视觉上盾没了但绿条还在，符合"绿条代表 cast 影响仍在持续"语义                 |
| seeded buff（用户初始 partyState、无 cast 来源）             | simulator 把 sourceCastEventId 记为 `''`；填表时跳过                                                            |
| simulate 数据未就绪首帧                                      | useDamageCalculation 的 stale 行为不变，首帧 fallback 到 `action.duration`，下一帧自然刷新                      |

## 测试

### simulator 单测（`src/utils/mitigationCalculator.test.ts`）

新增 `castEffectiveEndByCastEventId` 输出 case：

1. **过期场景**：cast 一个 buff，duration 30s，无后续事件 → `effectiveEnd === ts + 30`
2. **盾击穿**：原生盾 `removeOnBarrierBreak: true`，伤害事件中途打穿 → `effectiveEnd === damageEvent.time`
3. **uniqueGroup 替换**：同 statusId cast 两次，第一条 `effectiveEnd === 第二条 ts`
4. **多 status max**：cast 同时附 8s + 4s 两个 buff（参考干预）→ `effectiveEnd === ts + 8`
5. **延长（同 instanceId 改 endTime）**：测试用 executor `map(s => ...endTime + 30)` → `effectiveEnd === 原 endTime + 30`
6. **detonation（filter by instanceId）**：测试用 executor 移除某 instance → `effectiveEnd === detonation cast ts`
7. **反例文档化**：filter 旧 + push 新 instanceId 的写法下，原 cast `effectiveEnd` 收束到 transformation 时刻；新 cast 接管新 interval。锁定此行为防止退化。

### 渲染层手动验证

- `pnpm dev` 启动，导入贤者意气轩昂之策（盾被中途击穿）的样例时间轴
- 检查：绿条末端 = 盾击穿事件时间；末尾文字显示击穿时长
- 检查：同 trackGroup 同 uniqueGroup 替换（37013 / 37016）绿条在替换点收束
- 检查：无 executor 技能（如纯产出资源类）绿条按 `action.duration` 显示

## 实现顺序

1. simulator 输出 `castEffectiveEndByCastEventId`，写好 1-7 号测试
2. context / useDamageCalculation 透传字段 + `useCastEffectiveEnd` hook
3. `MitigationStatus.instanceId` 注释升级（带正反例）
4. `CLAUDE.md` 加 "2.1. Executor 写作规范"
5. `SkillTracksCanvas` / `CastEventIcon` 切换数据源；删绿条侧 `nextCastTime` 截短；`visibleBarsByTrack` 同步换口径
6. 核对 `PlacementEngine.cdBarEndFor` 是否处理"下一 cast 砍齐 cd"，决定 cdBar 侧是否同步拆 `nextCastTime` 截短
7. `pnpm exec tsc --noEmit && pnpm lint && pnpm test:run`
8. 浏览器手动验证（按上节场景）

## 不做的事

- **不**实现延长 / 变身 / 引爆 类 executor 本身——它们是中期需求，本设计只确保
  绿条特性可以正确反映这类 executor 一旦实现的语义
- **不**引入 buff lineage（`parentInstanceId` / `lineageId`）——通过约束 executor
  保持 instanceId 不变就能覆盖所有当前已知的中期需求；真到了"必须换 instanceId"
  的极端场景再独立设计
- **不**给 status 加 `onTerminate` / `onRemove` 钩子——绿条特性只读 interval 数据，
  不需要副作用钩子；即便未来需要也是另一个独立设计
- **不**在 `MitigationAction` 上加 `primaryStatusId` 字段——`max(interval.to)` 的
  无配置策略已经覆盖现有所有 cast；真有反例时再引入

## 关联文档

- `design/superpowers/specs/2026-04-22-placement-architecture-design.md` —— `simulate()`
  与 `statusTimelineByPlayer` 的产出契约
- `design/superpowers/specs/2026-04-21-tank-mode-multi-victim-calculation-design.md` ——
  多坦路径 perVictim 排序逻辑
- `CLAUDE.md` "1. 技能与状态解耦架构" / "2. 执行器工厂" —— 上下文
