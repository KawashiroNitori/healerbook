# 技能使用与状态附加解耦 - 实现计划（修订版）

## 修订说明

根据反馈调整：
1. StatusDefinition → MitigationStatusMetadata
2. StatusInstance → MitigationStatus
3. ActionDefinition 保留现有设计，添加 executor
4. 移除 ActionExecutionResult 冗余字段
5. PlayerState 添加 HP 字段，移除 name
6. EnemyState 移除 name 和 id（虚拟敌方无需 ID）
7. 直接引用 keigenn.ts
8. 移除 actionStatusMapping.ts
9. 不考虑兼容问题
10. **ID 类型统一为 number**（参照 FFLogs API）
    - PlayerState.id: number（对应 FFLogsActor.id）
    - sourcePlayerId: number（对应 FFLogsActor.id）
    - targetPlayerId: number（对应 FFLogsActor.id）

## 1. 类型系统

### 状态类型

```typescript
// src/types/status.ts
import type { Keigenn } from '@/ff14-overlay-vue/src/types/keigennRecord2'

export type MitigationStatusMetadata = Keigenn

export interface MitigationStatus {
  instanceId: string  // 运行时生成的唯一 ID
  statusId: number    // 状态 ID（对应 Keigenn.id）
  startTime: number
  endTime: number
  remainingBarrier?: number
  sourceActionId?: number
  sourcePlayerId?: number  // 玩家 ID（对应 FFLogsActor.id）
}
```

### 技能类型（更新现有）

```typescript
// src/types/mitigation.ts
export interface MitigationAction {
  id: number
  name: string
  description?: string
  icon: string
  iconHD?: string
  jobs: Job[]
  uniqueGroup?: number[]
  duration: number
  cooldown: number
  executor: ActionExecutor  // 新增
}

export type ActionExecutor = (context: ActionExecutionContext) => PartyState

export interface ActionExecutionContext {
  actionId: number
  useTime: number
  partyState: PartyState
  targetPlayerId?: number  // 目标玩家 ID（对应 FFLogsActor.id）
}
```

### 小队状态

```typescript
// src/types/partyState.ts
export interface PartyState {
  players: PlayerState[]
  enemy: EnemyState
  timestamp: number
}

export interface PlayerState {
  id: number  // 玩家 ID（对应 FFLogsActor.id）
  job: Job
  currentHP: number
  maxHP: number
  statuses: MitigationStatus[]
}

export interface EnemyState {
  statuses: MitigationStatus[]  // 目标减伤状态列表
}
```

## 2. 实施阶段

### Phase 1: 类型系统（1-2 天）
1. 创建 src/types/status.ts
2. 创建 src/types/partyState.ts
3. 更新 src/types/mitigation.ts
4. 更新 src/types/index.ts

### Phase 2: 状态注册表（1 天）
1. 创建 src/utils/statusRegistry.ts
2. 单元测试

### Phase 3: 执行器（2-3 天）
1. createFriendlyBuffExecutor.ts
2. createEnemyDebuffExecutor.ts
3. createShieldExecutor.ts
4. utils.ts
5. 单元测试

### Phase 4: 技能数据（2 天）
1. 更新 mitigationActions.json
2. 创建 actionExecutors.ts
3. 创建 actionRegistry.ts
4. 单元测试

### Phase 5: 计算器重构（3-4 天）
1. 重构 MitigationCalculator
2. 实现 getActiveStatuses()
3. 实现百分比减伤计算
4. 实现盾值减伤计算
5. 更新测试

### Phase 6: 状态管理（2-3 天）
1. timelineStore 添加 partyState
2. 实现 executeAction()
3. 实现 updatePartyState()
4. 实现 getPartyStateAtTime()
5. 状态过期清理

### Phase 7: UI 适配（2-3 天）
1. 更新 DamageEventCard
2. 更新 SkillPanel
3. 创建 StatusIndicator
4. 更新 PropertyPanel
5. 更新拖拽逻辑

### Phase 8: 测试文档（2-3 天）
1. 单元测试覆盖率
2. 集成测试
3. E2E 测试
4. 更新 CLAUDE.md
5. 代码审查

## 3. 关键实现

### 友方 Buff 执行器

```typescript
export function createFriendlyBuffExecutor(
  statusIds: number[],
  duration: number,
  isPartyWide = true
): ActionExecutor {
  return (ctx) => {
    const targets = isPartyWide
      ? ctx.partyState.players
      : ctx.partyState.players.filter(p => p.id === ctx.targetPlayerId)

    return {
      ...ctx.partyState,
      players: ctx.partyState.players.map(p => {
        if (!targets.includes(p)) return p

        const newStatuses = statusIds.map(sid => ({
          instanceId: generateId(),
          statusId: sid,
          startTime: ctx.useTime,
          endTime: ctx.useTime + duration,
          sourceActionId: ctx.actionId,
        }))

        return { ...p, statuses: [...p.statuses, ...newStatuses] }
      })
    }
  }
}
```

### 敌方 Debuff 执行器

```typescript
export function createEnemyDebuffExecutor(
  statusIds: number[],
  duration: number
): ActionExecutor {
  return (ctx) => {
    const newStatuses = statusIds.map(sid => ({
      instanceId: generateId(),
      statusId: sid,
      startTime: ctx.useTime,
      endTime: ctx.useTime + duration,
      sourceActionId: ctx.actionId,
    }))

    return {
      ...ctx.partyState,
      enemy: {
        ...ctx.partyState.enemy,
        statuses: [...ctx.partyState.enemy.statuses, ...newStatuses]
      }
    }
  }
}
```

### 减伤计算

```typescript
calculate(event: DamageEvent, party: PartyState, time: number) {
  const friendlyStatuses = getActiveStatuses(party.players, time)
  const enemyStatuses = getActiveStatuses([party.enemy], time)

  // 百分比减伤
  let multiplier = 1.0
  for (const s of [...friendlyStatuses, ...enemyStatuses]) {
    const meta = getStatusById(s.statusId)
    if (meta?.type === 'multiplier') {
      multiplier *= meta.performance[event.damageType]
    }
  }

  let damage = event.damage * multiplier

  // 盾值减伤
  for (const s of friendlyStatuses) {
    const meta = getStatusById(s.statusId)
    if (meta?.type === 'absorbed' && s.remainingBarrier > 0) {
      const absorbed = Math.min(damage, s.remainingBarrier)
      damage -= absorbed
      s.remainingBarrier -= absorbed
    }
  }

  return { finalDamage: damage }
}
```

## 4. 技能声明示例

### 4.1 使用现成 Executor（大部分技能）

```typescript
// src/data/mitigationActions.ts
import type { MitigationAction } from '@/types/mitigation'
import { createFriendlyBuffExecutor, createEnemyDebuffExecutor, createShieldExecutor } from '@/executors'

export interface MitigationDataSource {
  version: string
  lastUpdated: string
  source: string
  actions: MitigationAction[]
}

export const MITIGATION_DATA: MitigationDataSource = {
  version: '7.1',
  lastUpdated: '2026-02-21',
  source: 'CafeMaker API',
  actions: [
    // 1. 简单友方 Buff（群体）- 节制
    {
      id: 16536,
      name: '节制',
      description: '一定时间内，自身发动治疗魔法的治疗量提高20%，自身与50米以内的队员受到的伤害减轻10%　<span style="color:#00cc22;">持续时间：</span>20秒',
      icon: '/i/002000/002645.png',
      iconHD: '/i/002000/002645_hr1.png',
      uniqueGroup: [16536],
      jobs: ['WHM'],
      duration: 25,
      cooldown: 120,
      executor: createFriendlyBuffExecutor(
        [1873],  // 状态 ID：节制
        25,      // 持续时间
        true     // 群体技能
      )
    },

    // 2. 简单友方 Buff（群体）- 行吟
    {
      id: 7405,
      name: '行吟',
      description: '一定时间内，令自身和周围队员所受到的伤害减轻 15 %\n<span style="color:#00cc22;">持续时间：</span>15秒\n无法与机工士的策动、舞者的防守之桑巴效果共存',
      icon: '/i/002000/002612.png',
      iconHD: '/i/002000/002612_hr1.png',
      uniqueGroup: [7405, 16889, 16012],
      jobs: ['BRD'],
      duration: 15,
      cooldown: 90,
      executor: createFriendlyBuffExecutor(
        [1934],  // 状态 ID：行吟
        15,
        true
      )
    },

    // 3. 敌方 Debuff（目标减伤）- 雪仇
    {
      id: 7535,
      name: '雪仇',
      description: '使自身周围的敌人攻击伤害降低10%　<span style="color:#00cc22;">持续时间：</span> 15 秒',
      icon: '/i/000000/000806.png',
      iconHD: '/i/000000/000806_hr1.png',
      uniqueGroup: [7535],
      jobs: ['WAR', 'PLD', 'DRK', 'GNB'],
      duration: 15,
      cooldown: 60,
      executor: createEnemyDebuffExecutor(
        [1193],  // 状态 ID：雪仇
        15
      )
    },

    // 4. 敌方 Debuff（目标减伤）- 牵制
    {
      id: 7549,
      name: '牵制',
      description: '一定时间内，令目标物理攻击造成的伤害降低10%，魔法攻击造成的伤害降低5%\n<span style="color:#00cc22;">持续时间：</span> 15 秒',
      icon: '/i/000000/000828.png',
      iconHD: '/i/000000/000828_hr1.png',
      uniqueGroup: [7549],
      jobs: ['MNK', 'DRG', 'NIN', 'SAM', 'RPR', 'VPR'],
      duration: 15,
      cooldown: 90,
      executor: createEnemyDebuffExecutor(
        [1195],  // 状态 ID：牵制
        15
      )
    },

    // 5. 盾值技能（群体）- 泛输血
    {
      id: 24311,
      name: '泛输血',
      description: '为自身及周围队员附加能够抵消一定伤害量的防护罩\n该防护罩能够抵消相当于200恢复力的伤害量',
      icon: '/i/003000/003679.png',
      iconHD: '/i/003000/003679_hr1.png',
      uniqueGroup: [24311],
      jobs: ['SGE'],
      duration: 15,
      cooldown: 120,
      executor: createShieldExecutor(
        [2613],  // 状态 ID：泛输血
        15,
        true,    // 群体
        0.10     // 盾值倍率（目标最大 HP 的 10%）
      )
    },

    // 6. 盾值技能（单体）- 鼓舞激励之策
    {
      id: 185,
      name: '鼓舞激励之策',
      description: '恢复目标的体力　<span style="color:#00cc22;">恢复力：</span>300\n<span style="color:#00cc22;">追加效果：</span>为目标附加能够抵御一定伤害的防护罩<span style="color:#ff7b1a;">鼓舞</span>',
      icon: '/i/002000/002801.png',
      iconHD: '/i/002000/002801_hr1.png',
      uniqueGroup: [185, 37013, 37034],
      jobs: ['SCH'],
      duration: 30,
      cooldown: 2.5,
      executor: createShieldExecutor(
        [297],   // 状态 ID：鼓舞
        30,
        false,   // 单体
        0.125    // 盾值倍率（治疗量的 125%）
      )
    },

    // 7. 复合技能（减伤 + 盾值）- 整体论
    {
      id: 24310,
      name: '整体论',
      description: '恢复自身及周围队员的体力\n<span style="color:#00cc22;">追加效果：</span>自身及周围队员所受伤害减轻10%　<span style="color:#00cc22;">持续时间：</span>20秒',
      icon: '/i/003000/003678.png',
      iconHD: '/i/003000/003678_hr1.png',
      uniqueGroup: [24310],
      jobs: ['SGE'],
      duration: 20,
      cooldown: 120,
      executor: createFriendlyBuffExecutor(
        [3003, 3365],  // 状态 ID：整体论（减伤）+ 整体盾（盾值）
        20,
        true
      )
    },
  ]
}

export default MITIGATION_DATA
```

### 4.2 自定义 Executor（少数特殊技能）

```typescript
// 示例 1：展开战术（3585）- 复制目标的鼓舞盾到所有成员
{
  id: 3585,
  name: '展开战术',
  description: '将目标身上的<span style="color:#ff7b1a;">鼓舞</span>或<span style="color:#ff7b1a;">激励</span>效果扩散到自身及周围队员身上',
  icon: '/i/002000/002813.png',
  iconHD: '/i/002000/002813_hr1.png',
  uniqueGroup: [3585],
  jobs: ['SCH'],
  duration: 30,
  cooldown: 120,
  executor: (ctx) => {
    // 自定义逻辑：
    // 1. 检测目标身上是否有鼓舞盾（297）
    // 2. 如果有，将该盾值状态复制到所有队员身上

    const targetPlayer = ctx.partyState.players.find(p => p.id === ctx.targetPlayerId)
    if (!targetPlayer) {
      return ctx.partyState
    }

    // 查找目标身上的鼓舞状态
    const shieldStatus = targetPlayer.statuses.find(s => s.statusId === 297)

    if (!shieldStatus) {
      // 目标没有鼓舞盾，无法展开
      return ctx.partyState
    }

    // 为所有队员复制该盾值状态
    const newStatuses = ctx.partyState.players.map(player => ({
      instanceId: generateId(),
      statusId: shieldStatus.statusId,
      startTime: ctx.useTime,
      endTime: ctx.useTime + 30,
      remainingBarrier: shieldStatus.remainingBarrier,  // 复制相同的盾值
      sourceActionId: ctx.actionId,
      sourcePlayerId: player.id,
    }))

    return {
      ...ctx.partyState,
      players: ctx.partyState.players.map((p, i) => ({
        ...p,
        statuses: [...p.statuses, newStatuses[i]]
      }))
    }
  }
},

// 示例 2：气宇轩昂之策（37013）- 检测秘策状态附加额外盾值
{
  id: 37013,
  name: '气宇轩昂之策',
  description: '恢复自身及周围队员的体力\n<span style="color:#00cc22;">追加效果：</span>附加能够抵御一定伤害的防护罩\n该防护罩能够抵消相当于治疗量180%的伤害',
  icon: '/i/002000/002880.png',
  iconHD: '/i/002000/002880_hr1.png',
  uniqueGroup: [37013, 185, 37034],
  jobs: ['SCH'],
  duration: 30,
  cooldown: 2.5,
  executor: (ctx) => {
    // 自定义逻辑：
    // 1. 检测施法者身上是否有秘策状态（1896）
    // 2. 为所有队员附加普通鼓舞盾（297）
    // 3. 如果有秘策，额外附加激励盾（1918）

    const caster = ctx.partyState.players.find(p => p.id === ctx.targetPlayerId)
    const hasRecitation = caster?.statuses.some(s => s.statusId === 1896)  // 秘策

    const newStatuses: MitigationStatus[] = []

    ctx.partyState.players.forEach(player => {
      // 基础鼓舞盾
      newStatuses.push({
        instanceId: generateId(),
        statusId: 297,  // 鼓舞
        startTime: ctx.useTime,
        endTime: ctx.useTime + 30,
        remainingBarrier: player.maxHP * 0.18,  // 治疗量的 180%，简化为 18% 最大 HP
        sourceActionId: ctx.actionId,
        sourcePlayerId: player.id,
      })

      // 如果有秘策，额外附加激励盾
      if (hasRecitation) {
        newStatuses.push({
          instanceId: generateId(),
          statusId: 1918,  // 激励
          startTime: ctx.useTime,
          endTime: ctx.useTime + 30,
          remainingBarrier: player.maxHP * 0.18,  // 与鼓舞相同的盾值
          sourceActionId: ctx.actionId,
          sourcePlayerId: player.id,
        })
      }
    })

    // 如果有秘策，消耗该状态
    const updatedPlayers = ctx.partyState.players.map(p => {
      const playerStatuses = newStatuses.filter(s => s.sourcePlayerId === p.id)
      const filteredStatuses = hasRecitation && p.id === ctx.targetPlayerId
        ? p.statuses.filter(s => s.statusId !== 1896)  // 移除秘策
        : p.statuses

      return {
        ...p,
        statuses: [...filteredStatuses, ...playerStatuses]
      }
    })

    return {
      ...ctx.partyState,
      players: updatedPlayers
    }
  }
}
```

### 4.3 Executor 工厂函数

```typescript
// src/executors/createFriendlyBuffExecutor.ts
export function createFriendlyBuffExecutor(
  statusIds: number[],
  duration: number,
  isPartyWide: boolean = true
): ActionExecutor {
  return (ctx) => {
    const targets = isPartyWide
      ? ctx.partyState.players
      : ctx.partyState.players.filter(p => p.id === ctx.targetPlayerId)

    const newStatuses = targets.flatMap(player =>
      statusIds.map(statusId => ({
        instanceId: generateId(),
        statusId,
        startTime: ctx.useTime,
        endTime: ctx.useTime + duration,
        sourceActionId: ctx.actionId,
        sourcePlayerId: player.id,
      }))
    )

    return {
      ...ctx.partyState,
      players: ctx.partyState.players.map(p => {
        const playerStatuses = newStatuses.filter(s => s.sourcePlayerId === p.id)
        return playerStatuses.length > 0
          ? { ...p, statuses: [...p.statuses, ...playerStatuses] }
          : p
      })
    }
  }
}

// src/executors/createEnemyDebuffExecutor.ts
export function createEnemyDebuffExecutor(
  statusIds: number[],
  duration: number
): ActionExecutor {
  return (ctx) => {
    const newStatuses = statusIds.map(statusId => ({
      instanceId: generateId(),
      statusId,
      startTime: ctx.useTime,
      endTime: ctx.useTime + duration,
      sourceActionId: ctx.actionId,
    }))

    return {
      ...ctx.partyState,
      enemy: {
        ...ctx.partyState.enemy,
        statuses: [...ctx.partyState.enemy.statuses, ...newStatuses]
      }
    }
  }
}

// src/executors/createShieldExecutor.ts
export function createShieldExecutor(
  statusIds: number[],
  duration: number,
  isPartyWide: boolean = true,
  shieldMultiplier: number = 0.1  // 盾值倍率（相对于目标最大 HP）
): ActionExecutor {
  return (ctx) => {
    const targets = isPartyWide
      ? ctx.partyState.players
      : ctx.partyState.players.filter(p => p.id === ctx.targetPlayerId)

    const newStatuses = targets.flatMap(player =>
      statusIds.map(statusId => ({
        instanceId: generateId(),
        statusId,
        startTime: ctx.useTime,
        endTime: ctx.useTime + duration,
        sourceActionId: ctx.actionId,
        sourcePlayerId: player.id,
        remainingBarrier: player.maxHP * shieldMultiplier,  // 根据最大 HP 计算盾值
      }))
    )

    return {
      ...ctx.partyState,
      players: ctx.partyState.players.map(p => {
        const playerStatuses = newStatuses.filter(s => s.sourcePlayerId === p.id)
        return playerStatuses.length > 0
          ? { ...p, statuses: [...p.statuses, ...playerStatuses] }
          : p
      })
    }
  }
}
```

## 5. 时间估算

| 阶段 | 时间 |
|------|------|
| Phase 1-2 | 2-3 天 |
| Phase 3-4 | 4-5 天 |
| Phase 5-6 | 5-7 天 |
| Phase 7-8 | 4-6 天 |
| **总计** | **15-21 天** |

## 5. 验收标准

- [ ] 技能使用正确附加状态
- [ ] 减伤计算基于状态
- [ ] 盾值正确消耗
- [ ] 虚拟敌方正确工作
- [ ] 单元测试覆盖率 ≥ 80%
- [ ] 时间轴渲染 ≥ 30 FPS

## 6. 下一步

1. 确认计划
2. 创建分支 feature/skill-status-decoupling
3. 开始 Phase 1

---

**创建时间**：2026-02-21
**预计完成**：2026-03-10 至 2026-03-14
**状态**：待确认

### 4.4 技能声明统计

**预计技能分布**：
- 使用 `createFriendlyBuffExecutor`：~60 个技能（约 70%）
  - 简单友方 Buff（铁壁、盾阵、预警等）
  - 单体减伤（干预、石之心、献奉等）

- 使用 `createEnemyDebuffExecutor`：~10 个技能（约 12%）
  - 目标减伤（雪仇、牵制、昏乱、武装解除等）

- 使用 `createShieldExecutor`：~10 个技能（约 12%）
  - 盾值技能（鼓舞、激励、野战治疗阵等）

- 自定义 executor：~5 个技能（约 6%）
  - 特殊机制（神圣领域、行尸走肉、壁垒等）

**总计**：约 85 个减伤技能

### 4.5 数据迁移示例

**迁移前**（旧格式）：
```typescript
{
  id: 16536,
  name: '节制',
  description: '一定时间内，自身发动治疗魔法的治疗量提高20%...',
  icon: '/i/002000/002645.png',
  iconHD: '/i/002000/002645_hr1.png',
  uniqueGroup: [16536],
  jobs: ['WHM'],
  physicReduce: 10,    // ❌ 将被移除
  magicReduce: 10,     // ❌ 将被移除
  barrier: 0,          // ❌ 将被移除
  duration: 25,
  cooldown: 120,
}
```

**迁移后**（新格式）：
```typescript
{
  id: 16536,
  name: '节制',
  description: '一定时间内，自身发动治疗魔法的治疗量提高20%...',
  icon: '/i/002000/002645.png',
  iconHD: '/i/002000/002645_hr1.png',
  uniqueGroup: [16536],
  jobs: ['WHM'],
  duration: 25,
  cooldown: 120,
  executor: createFriendlyBuffExecutor([1873], 25, true)  // ✅ 新增
}
```

**关键变化**：
- ❌ 移除 `physicReduce`, `magicReduce`, `barrier` 字段
- ✅ 添加 `executor` 字段
- ✅ 减伤值由状态元数据（keigenn.ts）提供
- ✅ 保留 `description`, `icon`, `iconHD`, `uniqueGroup` 等字段

**迁移脚本示例**：
```typescript
// scripts/migrate-actions.ts
import { MITIGATION_DATA } from '@/data/mitigationActions'
import { createFriendlyBuffExecutor, createEnemyDebuffExecutor } from '@/executors'

// 技能 ID 到状态 ID 的映射（手动维护）
const ACTION_TO_STATUS_MAP: Record<number, number[]> = {
  16536: [1873],  // 节制
  7405: [1934],   // 行吟
  7535: [1193],   // 雪仇
  // ... 其他映射
}

// 判断是否为敌方技能
const ENEMY_ACTIONS = [7535, 7549, 7560, 2887]

function migrateAction(oldAction: any) {
  const statusIds = ACTION_TO_STATUS_MAP[oldAction.id]
  if (!statusIds) {
    console.warn(`No status mapping for action ${oldAction.id}`)
    return null
  }

  const isEnemy = ENEMY_ACTIONS.includes(oldAction.id)
  const executor = isEnemy
    ? createEnemyDebuffExecutor(statusIds, oldAction.duration)
    : createFriendlyBuffExecutor(statusIds, oldAction.duration, true)

  return {
    id: oldAction.id,
    name: oldAction.name,
    description: oldAction.description,
    icon: oldAction.icon,
    iconHD: oldAction.iconHD,
    uniqueGroup: oldAction.uniqueGroup,
    jobs: oldAction.jobs,
    duration: oldAction.duration,
    cooldown: oldAction.cooldown,
    executor,
  }
}
```

