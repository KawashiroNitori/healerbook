# 技能等级分歧系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 `MitigationAction` 引入等级分歧能力，使时间轴能按 70/80/90/100 四个副本同步等级正确表达技能的可用性、数值、效果与充能差异。

**Architecture:** 技能数据以 100 级为基线，低等级通过 `levelOverrides` 覆盖层表达；`resolveAction(action, level)` 把基线与覆盖层合并成「有效 action」，消费方只看合并结果。等级值存在 `Timeline.level`（Y.Doc meta），由副本表推导默认值。切换等级时在单个 Y.Doc 事务内写入新等级并清理不可用的 castEvent，使其可一步撤销。

**Tech Stack:** React 19 + TypeScript 5.9、Zustand 5、Yjs（协作与撤销栈）、Vitest 4、Tailwind v3 + shadcn/ui

**Spec:** `design/superpowers/specs/2026-08-12-action-level-variants-design.md`

## Global Constraints

- 包管理器必须用 `pnpm`，不得用 npm / yarn。
- 减伤技能相关命名一律用 `action`，禁止 `skill`（`MitigationAction` / `actionId`，不是 `MitigationSkill` / `skillId`）。
- 提交信息、作者、Co-Authored-By 中**禁止**出现 "Claude" 字样（`.husky/commit-msg` 会拒绝，大小写不敏感）。
- 提交信息用 conventional commits 格式（`feat(scope): 描述`），描述用中文。
- 测试文件与源文件同目录，命名 `*.test.ts`。
- 状态更新必须不可变（`set(state => ({ ...state, x }))`），禁止直接 mutate。
- 修改既有 status 时必须保持 `instanceId`（见 `src/types/status.ts` 契约）。本计划不涉及 executor 内部改写，但样例数据任务需遵守。
- i18n 源语言是 `zh-CN`（`fallbackLng`），新增文案 key **只写入 `src/i18n/locales/zh-CN/`**，其余 6 种语言（en / ja / zh-TW / ko-KR / de / fr）由 Crowdin 回流，不手工填写。
- 每个 task 结束前跑 `pnpm exec tsc --noEmit` 与该 task 涉及的测试；声称完成前跑 `pnpm test:run` 与 `pnpm lint`。

---

## File Structure

**新建：**

| 文件                                | 职责                                                     |
| ----------------------------------- | -------------------------------------------------------- |
| `src/types/level.ts`                | 等级档位常量与 `Level` 类型，唯一的 `DEFAULT_LEVEL` 出口 |
| `src/data/resolveAction.ts`         | 基线 + 覆盖层 → 有效 action 的合并逻辑，带 memo 缓存     |
| `src/data/resolveAction.test.ts`    | resolve 语义的单测                                       |
| `src/hooks/useResolvedActions.ts`   | UI 层入口：从 store 读 level，返回 resolved 集合         |
| `src/components/SettingsDialog.tsx` | 由 `StatDataDialog.tsx` 更名重构而来的设置对话框         |

**修改：**

| 文件                                                 | 改动                                                                                                  |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `src/types/mitigation.ts`                            | `MitigationAction` 加 `minLevel` / `maxLevel` / `levelOverrides`；新增 `LevelOverride` / `LevelPatch` |
| `src/utils/placement/validate.ts`                    | 新增 4 条等级校验规则                                                                                 |
| `src/data/mitigationActions.ts`                      | dev 校验改为四档位重跑；末尾追加样例数据                                                              |
| `src/types/timeline.ts`                              | `Timeline.level?: Level`                                                                              |
| `src/types/timelineV2.ts`                            | `V2Timeline.lv?: Level`                                                                               |
| `src/utils/timelineFormat.ts`                        | `toV2` / `fromV2` 处理 `lv`                                                                           |
| `src/collab/docSchema.ts`                            | `META_KEYS` 加 `'level'`，`readMeta` 读出                                                             |
| `src/collab/migration.ts` / `timelineToLocalInit.ts` | 随 meta 搬运 level                                                                                    |
| `src/data/raidEncounters.ts`                         | `RaidEncounter.level`                                                                                 |
| `src/utils/timelineStorage.ts`                       | `createNewTimeline` 写入 level                                                                        |
| `src/store/timelineStore.ts`                         | 新增 `setLevel`                                                                                       |
| `src/types/calculation.ts`                           | `SimulateInput.level?: Level`                                                                         |
| `src/utils/mitigationCalculator.ts`                  | `simulate` 用 resolved 建 variantMembers                                                              |
| `src/utils/simulation/timeAdvancer.ts`               | 接收 actionMap，替换 `MITIGATION_DATA.actions.find`                                                   |
| `src/utils/autoMitigation/types.ts`                  | `OptimizeInput.level?: Level`                                                                         |
| `src/utils/autoMitigation/evaluate.ts`               | 内部 `simulate` 调用透传 level                                                                        |
| `src/web-workers/calculator/index.ts`                | optimize 路径按等级注入技能池                                                                         |
| `src/utils/statDataUtils.ts`                         | `resolveStatData` / `cleanupStatData` 加 level 参数                                                   |
| `src/hooks/useSkillTracks.ts`                        | `ACTIONS` → resolved                                                                                  |
| `src/hooks/useDamageCalculation.ts`                  | 透传 level                                                                                            |
| `src/components/FilterMenu/EditPresetDialog.tsx`     | `ACTIONS` → resolved                                                                                  |
| `src/components/ActionTooltip.tsx`                   | 显示 resolved 的 CD / duration                                                                        |
| `src/components/EditorToolbar.tsx`                   | 入口更名 + 引用新组件                                                                                 |
| `src/i18n/locales/zh-CN/editor.json`                 | 设置对话框新文案                                                                                      |

---

## Task 1: 等级类型与 resolve 层

**Files:**

- Create: `src/types/level.ts`
- Modify: `src/types/mitigation.ts`
- Create: `src/data/resolveAction.ts`
- Test: `src/data/resolveAction.test.ts`

**Interfaces:**

- Consumes: `MitigationAction` from `@/types/mitigation`，`ACTIONS` / `ACTIONS_BY_ID` from `@/data/mitigationActions`
- Produces:
  - `SUPPORTED_LEVELS: readonly [70, 80, 90, 100]`、`type Level = 70 | 80 | 90 | 100`、`DEFAULT_LEVEL: Level`（`@/types/level`）
  - `interface LevelOverride { upTo: number; patch: LevelPatch }`、`type LevelPatch`（`@/types/mitigation`）
  - `resolveAction(action: MitigationAction, level: number): MitigationAction | null`
  - `resolveActions(level: Level): ResolvedActionSet`，`interface ResolvedActionSet { actions: MitigationAction[]; actionMap: Map<number, MitigationAction> }`（`@/data/resolveAction`）

- [ ] **Step 1: 创建等级类型文件**

`src/types/level.ts`：

```ts
/**
 * 副本同步等级档位。
 *
 * 只收录各代绝本 / 零式的同步等级，不做 1–100 全精度。
 * 与技能数据里的 minLevel / maxLevel / upTo（任意真实等级，如 96、82）区分开：
 * 「用户能选什么」收窄到四档，「数据能写什么」保持真实等级。
 */
export const SUPPORTED_LEVELS = [70, 80, 90, 100] as const

export type Level = (typeof SUPPORTED_LEVELS)[number]

/**
 * 默认等级。所有回退路径的唯一出口：
 * 存量时间轴无 level 字段、副本表查不到、V1 格式迁移，一律回退到此。
 */
export const DEFAULT_LEVEL: Level = 100

/** 运行时窄化：把任意 number 收敛为合法档位，非法值回退 DEFAULT_LEVEL */
export function toLevel(value: number | undefined): Level {
  return SUPPORTED_LEVELS.includes(value as Level) ? (value as Level) : DEFAULT_LEVEL
}
```

- [ ] **Step 2: 给 MitigationAction 加等级字段**

在 `src/types/mitigation.ts` 的 `MitigationAction` 接口末尾（`resourceEffects` 之后）追加：

```ts
  /**
   * 可用等级下限（闭区间）。省略 = 无下限。
   * 用真实学习等级，不限于 SUPPORTED_LEVELS 档位。
   */
  minLevel?: number
  /**
   * 可用等级上限（闭区间）。省略 = 无上限。
   * 用于被升级技能顶掉的场景：医济 maxLevel: 95，医养 minLevel: 96。
   */
  maxLevel?: number
  /**
   * 低等级覆盖层，必须按 upTo 升序排列。
   * 基线字段写 100 级；resolve 时取第一个满足 level <= upTo 的层，**只命中一层，不叠加**。
   */
  levelOverrides?: LevelOverride[]
```

在同文件 `MitigationAction` 定义之前插入：

```ts
/**
 * 允许被等级覆盖的字段白名单。
 *
 * 刻意排除 id / jobs / trackGroup / category：
 *   - id：技能身份
 *   - jobs：技能不随等级换职业
 *   - trackGroup：变了会让轨道在切等级时跳位
 *   - category：UI 过滤与 calculate 的目标减判定依赖它，允许变会把等级感知
 *     污染到一批本可保持静态的消费点
 */
export type LevelPatch = Partial<
  Pick<
    MitigationAction,
    'duration' | 'cooldown' | 'executor' | 'resourceEffects' | 'statDataEntries' | 'placement'
  >
>

export interface LevelOverride {
  /** 本层生效的等级上限（闭区间）：level <= upTo 时命中 */
  upTo: number
  patch: LevelPatch
}
```

- [ ] **Step 3: 写 resolve 层的失败测试**

`src/data/resolveAction.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { resolveAction, resolveActions } from './resolveAction'
import type { MitigationAction } from '@/types/mitigation'
import { createBuffExecutor } from '@/executors'

const base: MitigationAction = {
  id: 9001,
  name: '测试技能',
  icon: '/i/test.png',
  jobs: ['WHM'],
  category: ['partywide', 'percentage'],
  duration: 20,
  cooldown: 120,
}

describe('resolveAction 区间过滤', () => {
  it('level 低于 minLevel 返回 null', () => {
    expect(resolveAction({ ...base, minLevel: 96 }, 90)).toBeNull()
  })

  it('level 等于 minLevel 可用（闭区间）', () => {
    expect(resolveAction({ ...base, minLevel: 90 }, 90)).not.toBeNull()
  })

  it('level 高于 maxLevel 返回 null', () => {
    expect(resolveAction({ ...base, maxLevel: 95 }, 100)).toBeNull()
  })

  it('level 等于 maxLevel 可用（闭区间）', () => {
    expect(resolveAction({ ...base, maxLevel: 90 }, 90)).not.toBeNull()
  })

  it('无区间声明时任何等级都可用', () => {
    expect(resolveAction(base, 70)).not.toBeNull()
  })
})

describe('resolveAction 覆盖层', () => {
  const withOverrides: MitigationAction = {
    ...base,
    levelOverrides: [
      { upTo: 81, patch: { duration: 10, cooldown: 180 } },
      { upTo: 87, patch: { duration: 15 } },
    ],
  }

  it('命中第一个 upTo >= level 的层', () => {
    const r = resolveAction(withOverrides, 70)!
    expect(r.duration).toBe(10)
    expect(r.cooldown).toBe(180)
  })

  it('只命中一层，不与后续层叠加', () => {
    // level 80 命中 upTo:81 层（duration 10 / cooldown 180），
    // 不应被 upTo:87 层的 duration 15 覆盖
    const r = resolveAction(withOverrides, 80)!
    expect(r.duration).toBe(10)
  })

  it('命中中间层时，未声明的字段回落基线而非前一层', () => {
    // level 85 命中 upTo:87 层，该层只声明 duration，
    // cooldown 应取基线 120，而不是 upTo:81 层的 180
    const r = resolveAction(withOverrides, 85)!
    expect(r.duration).toBe(15)
    expect(r.cooldown).toBe(120)
  })

  it('无层命中时返回基线原引用', () => {
    expect(resolveAction(withOverrides, 100)).toBe(withOverrides)
  })

  it('数组字段整体替换，不做元素级合并', () => {
    const action: MitigationAction = {
      ...base,
      statDataEntries: [
        { type: 'shield', key: 1 },
        { type: 'heal', key: 2 },
      ],
      levelOverrides: [{ upTo: 80, patch: { statDataEntries: [{ type: 'heal', key: 2 }] } }],
    }
    expect(resolveAction(action, 70)!.statDataEntries).toEqual([{ type: 'heal', key: 2 }])
  })

  it('executor 可被覆盖层替换', () => {
    const legacy = createBuffExecutor(1, 10)
    const action: MitigationAction = {
      ...base,
      executor: createBuffExecutor(2, 20),
      levelOverrides: [{ upTo: 80, patch: { executor: legacy } }],
    }
    expect(resolveAction(action, 70)!.executor).toBe(legacy)
  })
})

describe('resolveActions', () => {
  it('同一等级返回同一引用（memo 缓存）', () => {
    expect(resolveActions(100)).toBe(resolveActions(100))
  })

  it('actionMap 与 actions 内容一致', () => {
    const { actions, actionMap } = resolveActions(100)
    expect(actionMap.size).toBe(actions.length)
    for (const a of actions) expect(actionMap.get(a.id)).toBe(a)
  })

  it('不同等级得到不同集合大小时，低等级不多于高等级', () => {
    // 仅当已有数据声明了 minLevel 才会不等；此断言在无数据时也成立
    expect(resolveActions(70).actions.length).toBeLessThanOrEqual(
      resolveActions(100).actions.length
    )
  })
})
```

- [ ] **Step 4: 运行测试确认失败**

Run: `pnpm test:run resolveAction`
Expected: FAIL —— `Failed to resolve import "./resolveAction"`

- [ ] **Step 5: 实现 resolve 层**

`src/data/resolveAction.ts`：

```ts
import type { MitigationAction } from '@/types/mitigation'
import type { Level } from '@/types/level'
import { ACTIONS } from './mitigationActions'

export interface ResolvedActionSet {
  /** 已滤掉区间外的技能，且覆盖层已合并 */
  actions: MitigationAction[]
  actionMap: Map<number, MitigationAction>
}

/**
 * 把基线 action 与命中的等级覆盖层合并成「有效 action」。
 *
 * 区间外返回 null。覆盖层按 upTo 升序取**第一个**满足 level <= upTo 的层，
 * 只命中一层不叠加——每层是该等级段的完整快照。
 */
export function resolveAction(action: MitigationAction, level: number): MitigationAction | null {
  if (action.minLevel !== undefined && level < action.minLevel) return null
  if (action.maxLevel !== undefined && level > action.maxLevel) return null

  const hit = action.levelOverrides?.find(o => level <= o.upTo)
  if (!hit) return action

  return { ...action, ...hit.patch }
}

/** 静态数据不可变，缓存永不失效；档位固定为 4 个，常驻开销可忽略 */
const cache = new Map<Level, ResolvedActionSet>()

export function resolveActions(level: Level): ResolvedActionSet {
  const cached = cache.get(level)
  if (cached) return cached

  const actions: MitigationAction[] = []
  for (const a of ACTIONS) {
    const resolved = resolveAction(a, level)
    if (resolved) actions.push(resolved)
  }
  const set: ResolvedActionSet = {
    actions,
    actionMap: new Map(actions.map(a => [a.id, a])),
  }
  cache.set(level, set)
  return set
}
```

- [ ] **Step 6: 收窄静态导出的 JSDoc**

`src/data/mitigationActions.ts` 末尾两个导出的注释改为：

```ts
/**
 * 全部技能的**基线表**（等于 100 级形态）。
 *
 * 仅供不关心等级的消费点使用：trackGroup 映射、actionId 识别、名称查找。
 * 需要感知等级的场景一律走 `resolveActions(level)` / `useResolvedActions()`，
 * 否则低等级下会拿到不可用技能或未经覆盖的数值。
 */
export const ACTIONS = MITIGATION_DATA.actions

/**
 * id → 基线 action 索引（数据不可变，模块级建一次）。
 * 同 ACTIONS：不含等级覆盖，需要等级语义时用 resolveActions(level).actionMap。
 */
export const ACTIONS_BY_ID: Map<number, MitigationAction> = new Map(
  MITIGATION_DATA.actions.map(a => [a.id, a])
)
```

- [ ] **Step 7: 运行测试确认通过**

Run: `pnpm test:run resolveAction`
Expected: PASS，全部用例绿

- [ ] **Step 8: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误

- [ ] **Step 9: Commit**

```bash
git add src/types/level.ts src/types/mitigation.ts src/data/resolveAction.ts src/data/resolveAction.test.ts src/data/mitigationActions.ts
git commit -m "feat(level): 引入等级档位类型与技能 resolve 层"
```

---

## Task 2: 等级校验规则与四档位重跑

**Files:**

- Modify: `src/utils/placement/validate.ts`
- Modify: `src/data/mitigationActions.ts:1590-1600`（dev 校验块）
- Test: `src/utils/placement/validate.test.ts`

**Interfaces:**

- Consumes: `resolveActions` from `@/data/resolveAction`，`SUPPORTED_LEVELS` from `@/types/level`
- Produces: `IssueRule` 扩展 4 个取值：`'level-range-inverted'` / `'level-overrides-unsorted'` / `'level-override-dead'` / `'level-override-empty'`

- [ ] **Step 1: 写校验规则的失败测试**

追加到 `src/utils/placement/validate.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { validateActions } from './validate'
import type { MitigationAction } from '@/types/mitigation'
import { resolveActions } from '@/data/resolveAction'
import { SUPPORTED_LEVELS } from '@/types/level'

const stub: MitigationAction = {
  id: 9101,
  name: '测试',
  icon: '/i/test.png',
  jobs: ['WHM'],
  category: ['self'],
  duration: 10,
  cooldown: 60,
}

describe('等级校验规则', () => {
  it('minLevel > maxLevel 报错', () => {
    const issues = validateActions([{ ...stub, minLevel: 96, maxLevel: 90 }])
    expect(issues.some(i => i.rule === 'level-range-inverted' && i.level === 'error')).toBe(true)
  })

  it('minLevel === maxLevel 合法', () => {
    const issues = validateActions([{ ...stub, minLevel: 90, maxLevel: 90 }])
    expect(issues.some(i => i.rule === 'level-range-inverted')).toBe(false)
  })

  it('levelOverrides 的 upTo 非升序报错', () => {
    const issues = validateActions([
      {
        ...stub,
        levelOverrides: [
          { upTo: 87, patch: { duration: 5 } },
          { upTo: 81, patch: { duration: 6 } },
        ],
      },
    ])
    expect(issues.some(i => i.rule === 'level-overrides-unsorted' && i.level === 'error')).toBe(
      true
    )
  })

  it('levelOverrides 的 upTo 重复报错', () => {
    const issues = validateActions([
      {
        ...stub,
        levelOverrides: [
          { upTo: 81, patch: { duration: 5 } },
          { upTo: 81, patch: { duration: 6 } },
        ],
      },
    ])
    expect(issues.some(i => i.rule === 'level-overrides-unsorted')).toBe(true)
  })

  it('upTo < minLevel 的死层报错', () => {
    const issues = validateActions([
      { ...stub, minLevel: 90, levelOverrides: [{ upTo: 81, patch: { duration: 5 } }] },
    ])
    expect(issues.some(i => i.rule === 'level-override-dead' && i.level === 'error')).toBe(true)
  })

  it('空 patch 的层报错', () => {
    const issues = validateActions([{ ...stub, levelOverrides: [{ upTo: 81, patch: {} }] }])
    expect(issues.some(i => i.rule === 'level-override-empty' && i.level === 'error')).toBe(true)
  })
})

describe('四档位全量校验', () => {
  // 某技能一旦声明 minLevel / maxLevel，它在部分档位会退出技能池，
  // 同 trackGroup 的其余成员的 placement 就可能不再覆盖全轴——
  // 这类 bug 只在特定等级复现，必须逐档位验。
  for (const level of SUPPORTED_LEVELS) {
    it(`${level} 级下全量技能数据无 error`, () => {
      const errors = validateActions(resolveActions(level).actions).filter(i => i.level === 'error')
      expect(errors).toEqual([])
    })
  }
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test:run validate`
Expected: FAIL —— 等级规则用例全红（`level-range-inverted` 等 rule 从未产出）

- [ ] **Step 3: 实现校验规则**

`src/utils/placement/validate.ts`：`IssueRule` 联合类型改为

```ts
export type IssueRule =
  | 'trackgroup-missing'
  | 'trackgroup-chain'
  | 'trackgroup-placement-missing'
  | 'level-range-inverted'
  | 'level-overrides-unsorted'
  | 'level-override-dead'
  | 'level-override-empty'
```

在 `validateActions` 的第一个 `for (const action of actions)` 循环体开头（`trackGroup` 判断之前）插入：

```ts
if (
  action.minLevel !== undefined &&
  action.maxLevel !== undefined &&
  action.minLevel > action.maxLevel
) {
  issues.push({
    level: 'error',
    rule: 'level-range-inverted',
    actionId: action.id,
    message: `minLevel=${action.minLevel} > maxLevel=${action.maxLevel}`,
  })
}

const overrides = action.levelOverrides
if (overrides) {
  for (let i = 1; i < overrides.length; i++) {
    if (overrides[i].upTo <= overrides[i - 1].upTo) {
      issues.push({
        level: 'error',
        rule: 'level-overrides-unsorted',
        actionId: action.id,
        message: `levelOverrides 必须按 upTo 严格升序：${overrides[i - 1].upTo} → ${overrides[i].upTo}`,
      })
      break
    }
  }
  for (const o of overrides) {
    if (action.minLevel !== undefined && o.upTo < action.minLevel) {
      issues.push({
        level: 'error',
        rule: 'level-override-dead',
        actionId: action.id,
        message: `覆盖层 upTo=${o.upTo} 低于 minLevel=${action.minLevel}，永不命中`,
      })
    }
    if (Object.keys(o.patch).length === 0) {
      issues.push({
        level: 'error',
        rule: 'level-override-empty',
        actionId: action.id,
        message: `覆盖层 upTo=${o.upTo} 的 patch 为空，无意义`,
      })
    }
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test:run validate`
Expected: PASS

- [ ] **Step 5: dev 校验块改为四档位重跑**

`src/data/mitigationActions.ts` 末尾的 dev 校验块整体替换为：

```ts
// Worker runtime 下 import.meta.env 为 undefined，用可选链避免顶层抛错
if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) {
  // 异步导入避免生产打包时保留 validate 代码路径
  void Promise.all([
    import('@/utils/placement/validate'),
    import('@/data/resolveAction'),
    import('@/types/level'),
  ]).then(([{ validateActions }, { resolveActions }, { SUPPORTED_LEVELS }]) => {
    // 逐档位验：技能退出技能池会让同轨组的 placement 覆盖性失效，
    // 这类问题只在特定等级复现。
    for (const lv of SUPPORTED_LEVELS) {
      for (const issue of validateActions(resolveActions(lv).actions)) {
        const msg = `[mitigationActions][Lv${lv}] ${issue.rule} on action ${issue.actionId}: ${issue.message}`
        if (issue.level === 'error') console.error(msg)
        else console.warn(msg)
      }
    }
  })
}
```

注意 `resolveAction.ts` import 了 `mitigationActions.ts` 的 `ACTIONS`，此处是动态 import，不构成顶层循环依赖。

- [ ] **Step 6: 跑全量测试确认无回归**

Run: `pnpm test:run`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/utils/placement/validate.ts src/utils/placement/validate.test.ts src/data/mitigationActions.ts
git commit -m "feat(level): 新增等级数据校验规则并按四档位重跑全量校验"
```

---

## Task 3: Timeline.level 的存储与持久化

**Files:**

- Modify: `src/types/timeline.ts`
- Modify: `src/types/timelineV2.ts:121-150`
- Modify: `src/utils/timelineFormat.ts:202-228`（`toV2`）、`:358-385`（`fromV2`）
- Modify: `src/collab/docSchema.ts:8-17`（`META_KEYS`）、`:318-334`（`readMeta` 返回体）
- Modify: `src/collab/migration.ts:22` 附近
- Modify: `src/collab/timelineToLocalInit.ts:18` 附近
- Test: `src/utils/timelineFormat.test.ts`

**Interfaces:**

- Consumes: `Level` / `toLevel` from `@/types/level`
- Produces: `Timeline.level?: Level`；`V2Timeline.lv?: Level`

- [ ] **Step 1: 写编解码往返的失败测试**

追加到 `src/utils/timelineFormat.test.ts`：

```ts
describe('level 字段编解码', () => {
  it('level 存在时写入 lv 短键', () => {
    const tl = { ...makeTimeline(), level: 90 as const }
    expect(toV2(tl).lv).toBe(90)
  })

  it('level 缺席时不写 lv', () => {
    const tl = makeTimeline()
    delete (tl as { level?: number }).level
    expect(toV2(tl).lv).toBeUndefined()
  })

  it('lv 往返一致', () => {
    const tl = { ...makeTimeline(), level: 70 as const }
    expect(fromV2(toV2(tl)).level).toBe(70)
  })

  it('无 lv 的存量数据解码后回退 100', () => {
    const v2 = toV2(makeTimeline())
    delete v2.lv
    expect(fromV2(v2).level).toBe(100)
  })

  it('非法 lv 值回退 100', () => {
    const v2 = { ...toV2(makeTimeline()), lv: 55 as unknown as 70 }
    expect(fromV2(v2).level).toBe(100)
  })
})
```

> `makeTimeline()` 是该测试文件中已有的时间轴构造 helper。若文件内 helper 名称不同，沿用文件内既有的构造方式，不要新建。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test:run timelineFormat`
Expected: FAIL —— `lv` 属性不存在于 `V2Timeline` 类型

- [ ] **Step 3: 加类型字段**

`src/types/timeline.ts`：`import type { Level } from './level'`，在 `Timeline` 接口的 `gameZoneId` 之后加：

```ts
  /** 副本同步等级。省略 = DEFAULT_LEVEL(100)，存量时间轴无此字段 */
  level?: Level
```

`src/types/timelineV2.ts`：`import type { Level } from './level'`，在 `gz` 之后加：

```ts
  /** level（副本同步等级）；缺席时解码回退 DEFAULT_LEVEL */
  lv?: Level
```

- [ ] **Step 4: 实现编解码**

`src/utils/timelineFormat.ts` 的 `toV2`，在 `if (timeline.gameZoneId !== undefined) out.gz = timeline.gameZoneId` 之后加：

```ts
if (timeline.level !== undefined) out.lv = timeline.level
```

`fromV2`，在 `if (v2.gz !== undefined) base.gameZoneId = v2.gz` 之后加：

```ts
base.level = toLevel(v2.lv)
```

文件顶部加 `import { toLevel } from '@/types/level'`。

注意此处**总是**写 `base.level`（走 `toLevel` 兜底），而非条件写入——解码结果需要一个确定的等级值供下游直接使用，且非法值也在此收敛。

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm test:run timelineFormat`
Expected: PASS

- [ ] **Step 6: 接入 Y.Doc meta**

`src/collab/docSchema.ts`：`META_KEYS` 数组在 `'gameZoneId'` 之后加 `'level',`。

`readMeta` 返回体在 `gameZoneId: ...` 之后加：

```ts
    level: meta.get('level') as Timeline['level'],
```

- [ ] **Step 7: 迁移与本地初始化搬运 level**

`src/collab/migration.ts` 在 `if (t.gameZoneId !== undefined) content.gameZoneId = t.gameZoneId` 之后加：

```ts
if (t.level !== undefined) content.level = t.level
```

`src/collab/timelineToLocalInit.ts` 在 `gameZoneId: timeline.gameZoneId,` 之后加：

```ts
    level: timeline.level,
```

若 `TimelineContent`（`src/collab/types.ts`）显式列出了字段，同步补 `level?: Level`。

- [ ] **Step 8: 跑相关测试**

Run: `pnpm test:run timelineFormat docSchema migration timelineToLocalInit`
Expected: PASS

- [ ] **Step 9: 类型检查并提交**

```bash
pnpm exec tsc --noEmit
git add src/types/timeline.ts src/types/timelineV2.ts src/utils/timelineFormat.ts src/utils/timelineFormat.test.ts src/collab/
git commit -m "feat(level): 时间轴等级字段接入持久化与协作文档"
```

---

## Task 4: 副本表推导默认等级

**Files:**

- Modify: `src/data/raidEncounters.ts:4-13`（`RaidEncounter`）、`:31-53`（`RAID_TIERS`）
- Modify: `src/utils/timelineStorage.ts:87-117`（`createNewTimeline`）
- Test: `src/utils/timelineStorage.test.ts`

**Interfaces:**

- Consumes: `getEncounterById` from `@/data/raidEncounters`，`DEFAULT_LEVEL` from `@/types/level`
- Produces: `RaidEncounter.level: number`（必填）；`createNewTimeline` 返回的 `Timeline` 带 `level`

- [ ] **Step 1: 写失败测试**

追加到 `src/utils/timelineStorage.test.ts`（若无此文件则新建）：

```ts
import { describe, it, expect } from 'vitest'
import { createNewTimeline } from './timelineStorage'
import { ALL_ENCOUNTERS } from '@/data/raidEncounters'

describe('createNewTimeline 等级推导', () => {
  it('从副本表推导等级', () => {
    const encounter = ALL_ENCOUNTERS[0]
    const tl = createNewTimeline(String(encounter.id), '测试')
    expect(tl.level).toBe(encounter.level)
  })

  it('未知副本 id 回退 100', () => {
    expect(createNewTimeline('999999', '测试').level).toBe(100)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test:run timelineStorage`
Expected: FAIL —— `level` 不存在于 `RaidEncounter`

- [ ] **Step 3: 给副本表加 level**

`src/data/raidEncounters.ts` 的 `RaidEncounter` 接口加：

```ts
// 副本同步等级（人工维护，用于推导时间轴默认等级）
level: number
```

`RAID_TIERS` 中现有 6 条 encounter 全部补 `level: 100`（阿卡狄亚重量级 5 条、FRU、DMU）。具体写法：

```ts
      { id: 101, name: '致命美人', shortName: 'M9S', gameZoneId: 1321, level: 100 },
```

其余条目同理逐条补。

- [ ] **Step 4: createNewTimeline 写入 level**

`src/utils/timelineStorage.ts` 顶部加 `import { toLevel } from '@/types/level'`，返回对象中 `gameZoneId: staticEncounter?.gameZoneId,` 之后加：

```ts
    level: toLevel(staticEncounter?.level),
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm test:run timelineStorage`
Expected: PASS

- [ ] **Step 6: 跑全量测试并提交**

```bash
pnpm test:run
git add src/data/raidEncounters.ts src/utils/timelineStorage.ts src/utils/timelineStorage.test.ts
git commit -m "feat(level): 副本表声明同步等级并推导新建时间轴默认值"
```

---

## Task 5: 区间门槛样例数据

本 task 前置于 Task 6/7/8——它们的测试都需要一个「90 级不可用、100 级可用」的真实技能。

**Files:**

- Modify: `src/data/mitigationActions.ts:478-501`（医养条目）
- Test: `src/data/resolveAction.test.ts`

**Interfaces:**

- Consumes: Task 1 的 `minLevel` 字段
- Produces: 医养（`37010`）带 `minLevel: 96`，作为后续 task 测试的锚点技能

- [ ] **Step 1: 写失败测试**

追加到 `src/data/resolveAction.test.ts`：

```ts
describe('真实数据：区间门槛', () => {
  const MEDICA_III_ID = 37010 // 医养，96 级习得

  it('90 级下医养不在技能表中', () => {
    expect(resolveActions(90).actionMap.has(MEDICA_III_ID)).toBe(false)
  })

  it('100 级下医养在技能表中', () => {
    expect(resolveActions(100).actionMap.has(MEDICA_III_ID)).toBe(true)
  })

  it('70 / 80 级下同样不可用', () => {
    expect(resolveActions(70).actionMap.has(MEDICA_III_ID)).toBe(false)
    expect(resolveActions(80).actionMap.has(MEDICA_III_ID)).toBe(false)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test:run resolveAction`
Expected: FAIL —— 90 级下医养仍在表中（`expected true to be false`）

- [ ] **Step 3: 给医养加 minLevel**

`src/data/mitigationActions.ts` 中 `id: 37010`（医养）的条目，在 `cooldown: 2,` 之后加一行：

```ts
      minLevel: 96,
```

**只改这一个字段**，不动该条目的其他任何内容。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test:run resolveAction`
Expected: PASS

- [ ] **Step 5: 四档位校验仍全绿**

Run: `pnpm test:run validate`
Expected: PASS —— 医养退出低等级技能池后，四档位的 trackGroup / placement 约束仍成立。若 `trackgroup-placement-missing` 报错，说明医养所在轨道组有成员的 placement 覆盖不全，需补齐区间。

- [ ] **Step 6: 跑全量测试并提交**

```bash
pnpm test:run
git add src/data/mitigationActions.ts src/data/resolveAction.test.ts
git commit -m "feat(level): 医养声明 96 级习得门槛"
```

**本 task 的范围仅限于此。** 数值 / 额外效果 / 充能三类分歧的真实历史数据，以及 `maxLevel`（技能被升级顶掉）的真实案例，本期不落——这三类的机制已由 Task 1 的 `resolveAction` 单测完整覆盖，而真实历史数值需要逐条核对游戏史料，写错比不写更有害。留作后续补数据的工作。

---

## Task 6: setLevel 与不可用 cast 的单事务清理

**Files:**

- Modify: `src/store/timelineStore.ts:154`（接口声明附近）、`:793-806`（批量删除模式参照）
- Test: `src/store/timelineStore.test.ts`

**Interfaces:**

- Consumes: `resolveAction` from `@/data/resolveAction`，`ACTIONS_BY_ID` from `@/data/mitigationActions`，`ySetMeta` / `yRemoveCastEvent` from `@/collab/docSchema`，`LOCAL_ORIGIN` from `@/collab/constants`
- Produces: `setLevel: (level: Level) => void` 在 `TimelineStore` 上

- [ ] **Step 1: 写失败测试**

追加到 `src/store/timelineStore.test.ts`（沿用文件内既有的 store 初始化 helper）：

```ts
describe('setLevel', () => {
  it('切到低等级时清理该等级不可用的 cast', () => {
    const store = setupStore() // 文件内既有 helper
    // 前置：时间轴含一个 minLevel 高于目标等级的技能 cast
    // 医养（Task 5 已落 minLevel: 96）在 90 级下不可用
    store.addCastEvent({ actionId: MEDICA_III_ID, timestamp: 10, playerId: 0 })
    expect(store.timeline!.castEvents).toHaveLength(1)

    store.setLevel(90)

    expect(store.timeline!.level).toBe(90)
    expect(store.timeline!.castEvents).toHaveLength(0)
  })

  it('保留该等级仍可用的 cast', () => {
    const store = setupStore()
    store.addCastEvent({ actionId: RAMPART_ID, timestamp: 10, playerId: 0 }) // 铁壁，无区间限制
    store.setLevel(70)
    expect(store.timeline!.castEvents).toHaveLength(1)
  })

  it('一次 undo 同时恢复等级与被清理的 cast', () => {
    const store = setupStore()
    store.addCastEvent({ actionId: MEDICA_III_ID, timestamp: 10, playerId: 0 })

    store.setLevel(90)
    expect(store.timeline!.castEvents).toHaveLength(0)

    store.undo()

    expect(store.timeline!.level).toBe(100)
    expect(store.timeline!.castEvents).toHaveLength(1)
  })

  it('等级未变化时不产生事务', () => {
    const store = setupStore()
    const before = store.canUndo
    store.setLevel(store.timeline!.level!)
    expect(store.canUndo).toBe(before)
  })
})
```

`MEDICA_III_ID` / `RAMPART_ID` 在测试文件顶部定义为 `const MEDICA_III_ID = 37010` / `const RAMPART_ID = 7531`。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test:run timelineStore`
Expected: FAIL —— `store.setLevel is not a function`

- [ ] **Step 3: 实现 setLevel**

`src/store/timelineStore.ts` 的 store 接口声明中，`setZoomLevel` 附近加：

```ts
  /** 切换副本同步等级；同事务清理该等级下不可用的 cast，可一步 undo */
  setLevel: (level: Level) => void
```

实现（放在 `removeCastEvent` 附近）：

```ts
    setLevel: level => {
      const engine = get().engine
      const timeline = get().timeline
      if (!engine || !timeline) return
      if ((timeline.level ?? DEFAULT_LEVEL) === level) return

      // 新等级下 resolve 为 null 的 action 对应的 cast 全部清理
      const removedIds = timeline.castEvents
        .filter(c => {
          const action = ACTIONS_BY_ID.get(c.actionId)
          return !action || resolveAction(action, level) === null
        })
        .map(c => c.id)

      // 写 level 与删 cast 必须同事务：UndoManager 视为一步，
      // 用户切错等级按一次 Ctrl+Z 即可完整恢复。
      engine.doc.transact(() => {
        ySetMeta(engine.doc, { level })
        for (const id of removedIds) yRemoveCastEvent(engine.doc, id)
      }, LOCAL_ORIGIN)
    },
```

顶部补 import：`import type { Level } from '@/types/level'`、`import { DEFAULT_LEVEL } from '@/types/level'`、`import { resolveAction } from '@/data/resolveAction'`、`import { ACTIONS_BY_ID } from '@/data/mitigationActions'`。`ySetMeta` 若尚未在该文件的 import 列表中，一并加入。

注意 `ySetMeta` / `yRemoveCastEvent` 内部各自有 `doc.transact`，Yjs 的嵌套事务会合并进外层事务，这与 `:799` 的批量删除是同一模式。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test:run timelineStore`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
pnpm exec tsc --noEmit
git add src/store/timelineStore.ts src/store/timelineStore.test.ts
git commit -m "feat(level): 新增 setLevel 并在同事务内清理不可用技能"
```

---

## Task 7: 计算层透传等级

**Files:**

- Modify: `src/types/calculation.ts:128-158`（`SimulateInput`）
- Modify: `src/utils/mitigationCalculator.ts:183-230`（`simulate`）
- Modify: `src/utils/simulation/timeAdvancer.ts:29`、`:213`
- Modify: `src/utils/statDataUtils.ts:81-99`、`:151-158`
- Modify: `src/utils/autoMitigation/types.ts:14-24`（`OptimizeInput`）
- Modify: `src/utils/autoMitigation/evaluate.ts:19`
- Modify: `src/web-workers/calculator/index.ts:34`
- Modify: `src/hooks/useDamageCalculation.ts:94`
- Modify: `src/hooks/useAutoMitigate.ts`
- Test: `src/utils/mitigationCalculator.test.ts`

**Interfaces:**

- Consumes: `resolveActions` from `@/data/resolveAction`，`Level` / `DEFAULT_LEVEL` from `@/types/level`
- Produces:
  - `SimulateInput.level?: Level`
  - `createTimeAdvancer` 的参数对象新增 `actionMap: Map<number, MitigationAction>`
  - `resolveStatData(statData, statistics, composition, level)` —— level 为第 4 个参数
  - `cleanupStatData(statData, composition, level)` —— level 为第 3 个参数

- [ ] **Step 1: 写失败测试**

追加到 `src/utils/mitigationCalculator.test.ts`：

```ts
describe('simulate 等级分歧', () => {
  it('低等级下不可用的技能 cast 不产生任何状态', () => {
    const out = simulate({
      castEvents: [{ id: 'c1', actionId: MEDICA_III_ID, timestamp: 5, playerId: 0 }],
      damageEvents: [],
      initialState: makeInitialState(), // 文件内既有 helper
      level: 90,
    })
    const intervals = [...out.statusTimelineByPlayer.values()].flatMap(m => [...m.values()]).flat()
    expect(intervals).toHaveLength(0)
  })

  it('等级足够时同一 cast 正常产生状态', () => {
    const out = simulate({
      castEvents: [{ id: 'c1', actionId: MEDICA_III_ID, timestamp: 5, playerId: 0 }],
      damageEvents: [],
      initialState: makeInitialState(),
      level: 100,
    })
    const intervals = [...out.statusTimelineByPlayer.values()].flatMap(m => [...m.values()]).flat()
    expect(intervals.length).toBeGreaterThan(0)
  })

  it('未传 level 时按 100 级处理（存量调用向后兼容）', () => {
    const out = simulate({
      castEvents: [{ id: 'c1', actionId: MEDICA_III_ID, timestamp: 5, playerId: 0 }],
      damageEvents: [],
      initialState: makeInitialState(),
    })
    const intervals = [...out.statusTimelineByPlayer.values()].flatMap(m => [...m.values()]).flat()
    expect(intervals.length).toBeGreaterThan(0)
  })
})
```

`MEDICA_III_ID` 在文件顶部定义为 `const MEDICA_III_ID = 37010`。医养的 `minLevel: 96` 已由 Task 5 落地，本测试直接可跑。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test:run mitigationCalculator`
Expected: FAIL —— `level` 不存在于 `SimulateInput` 类型

- [ ] **Step 3: SimulateInput 加字段**

`src/types/calculation.ts` 的 `SimulateInput` 末尾加：

```ts
  /**
   * 副本同步等级。省略 = DEFAULT_LEVEL(100)。
   * 决定 simulate 用哪一份 resolve 后的技能表：不可用技能的 cast 被跳过，
   * 命中覆盖层的技能用覆盖后的 executor / duration。
   */
  level?: Level
```

顶部加 `import type { Level } from './level'`。

- [ ] **Step 4: simulate 用 resolved 建表**

`src/utils/mitigationCalculator.ts` 的 `simulate`，解构中加 `level = DEFAULT_LEVEL,`，并把 variantMembers 的构建改为：

```ts
const { actions: resolvedActions, actionMap } = resolveActions(level)
// 预建 trackGroup 成员表：父 id → members
const variantMembers = new Map<number, MitigationAction[]>()
for (const a of resolvedActions) {
  const gid = a.trackGroup ?? a.id
  const arr = variantMembers.get(gid) ?? []
  arr.push(a)
  variantMembers.set(gid, arr)
}
```

`createTimeAdvancer` 的调用加上 `actionMap,`。

顶部 import 调整：加 `import { resolveActions } from '@/data/resolveAction'`、`import { DEFAULT_LEVEL } from '@/types/level'`。若 `MITIGATION_DATA` 在本文件的其他位置（如 `:35` 的 `ACTION_CATEGORY_BY_ID`）仍被使用则保留该 import——`category` 不可被等级覆盖，那处保持静态表是正确的。

- [ ] **Step 5: timeAdvancer 用 actionMap**

`src/utils/simulation/timeAdvancer.ts`：参数接口加 `actionMap: Map<number, MitigationAction>`，从参数对象解构出来，并把 `:213` 的

```ts
const parent = MITIGATION_DATA.actions.find(a => a.id === castEvent.actionId)
```

替换为

```ts
const parent = actionMap.get(castEvent.actionId)
```

删除该文件对 `MITIGATION_DATA` 的 import（若无其他使用点）。这同时把 O(n) 线性查找变成 O(1)。

- [ ] **Step 6: statDataUtils 加 level 参数**

`src/utils/statDataUtils.ts`：

`resolveStatData` 签名末尾加 `level: Level = DEFAULT_LEVEL`，把 `:99` 的

```ts
const actions = MITIGATION_DATA.actions.filter(
  a => a.statDataEntries && a.jobs.some(j => jobs.has(j))
)
```

替换为

```ts
const actions = resolveActions(level).actions.filter(
  a => a.statDataEntries && a.jobs.some(j => jobs.has(j))
)
```

`cleanupStatData` 签名末尾同样加 `level: Level = DEFAULT_LEVEL`，`:156` 的 `MITIGATION_DATA.actions` 替换为 `resolveActions(level).actions`。

两处都用默认参数，存量调用点无需同步改动即可编译通过。

- [ ] **Step 7: hook 层透传**

`src/hooks/useDamageCalculation.ts:94`：

```ts
const resolved = resolveStatData(
  timeline.statData,
  statistics,
  timeline.composition,
  timeline.level ?? DEFAULT_LEVEL
)
```

同文件中调用 `simulate` / worker client 的位置，把 `level: timeline.level ?? DEFAULT_LEVEL` 加进 `SimulateInput`。

`src/hooks/useAutoMitigate.ts` 中的 `resolveStatData` 调用同样补第 4 个参数。

worker 的 **simulate 路径**无需改动：`level` 是 `SimulateInput` 的普通可序列化字段，随消息自动过去，worker 内 `simulate(input)` 直接消费。**optimize 路径必须改**，见下一步。

- [ ] **Step 7b: 自动减伤（optimize）路径透传等级**

`src/web-workers/calculator/index.ts:34` 的 `runOptimize` 分支自行注入了技能池：

```ts
const actions = new Map(MITIGATION_DATA.actions.map(a => [a.id, a]))
```

`OptimizeWireInput = Omit<OptimizeInput, 'actions'>`——技能池不走线，在 worker 内注入。若不改，自动减伤会推荐当前等级根本用不了的技能。

`src/utils/autoMitigation/types.ts` 的 `OptimizeInput` 加：

```ts
  /** 副本同步等级。省略 = DEFAULT_LEVEL(100) */
  level?: Level
```

`src/web-workers/calculator/index.ts` 的注入改为：

```ts
const actions = resolveActions(toLevel(input.level)).actionMap
```

并把 `MITIGATION_DATA` 的 import 换成 `import { resolveActions } from '@/data/resolveAction'`、`import { toLevel } from '@/types/level'`。`resolveActions` 返回的 `actionMap` 类型即 `Map<number, MitigationAction>`，与 `OptimizeInput.actions` 一致，无需再建一次 Map。

`src/utils/autoMitigation/evaluate.ts:19` 的 `simulate({...})` 调用加上 `level: input.level`（若该函数签名未持有 input，从调用链上层透传；`runOptimize` 的 `input.level` 是源头）。

`src/hooks/useAutoMitigate.ts` 发起 optimize 请求时把 `level: timeline.level ?? DEFAULT_LEVEL` 放进 wire input。

- [ ] **Step 8: 运行测试确认通过**

Run: `pnpm test:run mitigationCalculator statDataUtils`
Expected: PASS

- [ ] **Step 9: 跑全量测试并提交**

```bash
pnpm test:run
pnpm exec tsc --noEmit
git add src/types/calculation.ts src/utils/mitigationCalculator.ts src/utils/mitigationCalculator.test.ts src/utils/simulation/timeAdvancer.ts src/utils/statDataUtils.ts src/utils/autoMitigation/ src/web-workers/calculator/index.ts src/hooks/useDamageCalculation.ts src/hooks/useAutoMitigate.ts
git commit -m "feat(level): 计算层与自动减伤按等级 resolve 技能表"
```

---

## Task 8: UI 消费点接入等级

**Files:**

- Create: `src/hooks/useResolvedActions.ts`
- Modify: `src/hooks/useSkillTracks.ts:7,18-19`
- Modify: `src/components/FilterMenu/EditPresetDialog.tsx:14,48`
- Modify: `src/components/ActionTooltip.tsx:202`
- Test: `src/hooks/useSkillTracks.test.ts`

**Interfaces:**

- Consumes: `resolveActions` from `@/data/resolveAction`，`useTimelineStore`
- Produces: `useResolvedActions(): ResolvedActionSet`

- [ ] **Step 1: 写失败测试**

追加到 `src/hooks/useSkillTracks.test.ts`（沿用文件内既有的 store mock 方式）：

```ts
describe('useSkillTracks 等级过滤', () => {
  it('90 级下不渲染 minLevel 96 的技能轨道', () => {
    setTimelineState({ level: 90, composition: { players: [{ id: 0, job: 'WHM' }] } })
    const tracks = renderHookResult(useSkillTracks)
    expect(tracks.some(t => t.actionId === 37010)).toBe(false)
  })

  it('100 级下渲染该技能轨道', () => {
    setTimelineState({ level: 100, composition: { players: [{ id: 0, job: 'WHM' }] } })
    const tracks = renderHookResult(useSkillTracks)
    expect(tracks.some(t => t.actionId === 37010)).toBe(true)
  })
})
```

锚点技能同 Task 7：医养（`37010`）的 `minLevel: 96` 已由 Task 5 落地，本测试直接可跑。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test:run useSkillTracks`
Expected: FAIL —— 两个等级下轨道集合相同

- [ ] **Step 3: 实现 useResolvedActions**

`src/hooks/useResolvedActions.ts`：

```ts
import { useTimelineStore } from '@/store/timelineStore'
import { resolveActions, type ResolvedActionSet } from '@/data/resolveAction'
import { DEFAULT_LEVEL } from '@/types/level'

/**
 * UI 层获取「当前时间轴等级下的有效技能表」的唯一入口。
 *
 * resolveActions 内部按等级缓存，返回引用稳定，可直接进 useMemo 依赖数组。
 */
export function useResolvedActions(): ResolvedActionSet {
  const level = useTimelineStore(s => s.timeline?.level) ?? DEFAULT_LEVEL
  return resolveActions(level)
}
```

- [ ] **Step 4: 接入 useSkillTracks**

`src/hooks/useSkillTracks.ts` 替换为：

```ts
import { useMemo } from 'react'
import { useTimelineStore } from '@/store/timelineStore'
import { useFilterStore } from '@/store/filterStore'
import { useResolvedActions } from './useResolvedActions'
import { deriveSkillTracks, type SkillTrack } from '@/utils/skillTracks'
import { matchTrack } from './useFilteredTimelineView'

export function useSkillTracks(): SkillTrack[] {
  const composition = useTimelineStore(s => s.timeline?.composition)
  const activePreset = useFilterStore(s => s.getActivePreset())
  const { actions, actionMap } = useResolvedActions()

  return useMemo(() => {
    if (!composition) return []
    const tracks = deriveSkillTracks(composition, new Set(), actions)
    return tracks.filter(t => matchTrack(t, activePreset, actionMap))
  }, [composition, activePreset, actions, actionMap])
}
```

删除对 `ACTIONS` 的 import。

- [ ] **Step 5: 接入过滤器预设编辑**

`src/components/FilterMenu/EditPresetDialog.tsx`：删除 `import { ACTIONS } from '@/data/mitigationActions'`，改为 `import { useResolvedActions } from '@/hooks/useResolvedActions'`；`:48` 的 `const allActions = ACTIONS` 改为组件内 `const { actions: allActions } = useResolvedActions()`。

**预设数据本身不做清理**：预设是跨时间轴复用的全局配置，其中不可用的 actionId 只在渲染时因不在 `allActions` 内而不显示，绝不写回预设。

- [ ] **Step 6: 接入技能 tooltip**

`src/components/ActionTooltip.tsx:202` 的

```ts
const localAction = MITIGATION_DATA.actions.find(a => a.id === displayedAction.id)
```

替换为

```ts
const { actionMap } = useResolvedActions()
const localAction = actionMap.get(displayedAction.id)
```

`useResolvedActions()` 必须在组件顶层调用（Hook 规则），若 `:202` 处于嵌套作用域，把 hook 调用提到组件顶部、此处只用 `actionMap`。删除该文件对 `MITIGATION_DATA` 的 import（若无其他使用点）。

- [ ] **Step 7: 运行测试确认通过**

Run: `pnpm test:run useSkillTracks`
Expected: PASS

- [ ] **Step 8: 跑全量测试与 lint 并提交**

```bash
pnpm test:run
pnpm lint
git add src/hooks/useResolvedActions.ts src/hooks/useSkillTracks.ts src/hooks/useSkillTracks.test.ts src/components/FilterMenu/EditPresetDialog.tsx src/components/ActionTooltip.tsx
git commit -m "feat(level): 技能轨道 / 过滤器 / 悬浮窗按等级过滤技能"
```

---

## Task 9: 设置对话框重构

**Files:**

- Create: `src/components/SettingsDialog.tsx`（由 `StatDataDialog.tsx` 迁移改造）
- Delete: `src/components/StatDataDialog.tsx`
- Modify: `src/components/EditorToolbar.tsx:64,126,494-501,656`
- Modify: `src/i18n/locales/zh-CN/editor.json`

**Interfaces:**

- Consumes: `useResolvedActions`、`useTimelineStore`（`setLevel`）、`SUPPORTED_LEVELS`、`RAID_TIERS` / `getEncounterById`
- Produces: `SettingsDialog` 默认导出，props 保持 `{ open: boolean; onClose: () => void }` 不变

- [ ] **Step 1: 加 i18n 文案**

`src/i18n/locales/zh-CN/editor.json`：把顶层 `"statData": "数值设置"`（`:170`，工具栏按钮文案）改为 `"settings": "设置"`，并新增 `settings` 文案块（与既有 `statData` 块并列）：

```json
  "settings": {
    "title": "设置",
    "navBasic": "基本",
    "navSafeHp": "安全血量",
    "navActionValues": "技能数值",
    "basicTitle": "基本",
    "encounter": "绑定副本",
    "level": "等级",
    "levelUnit": "级"
  }
```

原 `statData` 块中的 `safeHpTitle` / `actionValuesTitle` / `nonTankMinHp` / `tankMinHp` / `entry*` / `noActions` / `save` 全部保留原 key 继续使用，避免无谓的翻译作废。仅 `statData.title` 不再被引用（由 `settings.title` 取代），可保留不删。

**只改 zh-CN**，其余 6 种语言由 Crowdin 回流。

- [ ] **Step 2: 创建 SettingsDialog 骨架**

`git mv src/components/StatDataDialog.tsx src/components/SettingsDialog.tsx`，然后把组件名 `StatDataDialog` / `StatDataDialogInner` / `StatDataDialogProps` 分别改为 `SettingsDialog` / `SettingsDialogInner` / `SettingsDialogProps`。

- [ ] **Step 3: 实现左右两栏布局**

`SettingsDialogInner` 的 return 部分，把原先单栏的 `<div className="flex-1 overflow-y-auto space-y-4 px-0.5">` 改为两栏结构：

```tsx
const SECTIONS = [
  { id: 'basic', label: t('editor:settings.navBasic') },
  { id: 'safeHp', label: t('editor:settings.navSafeHp') },
  { id: 'actionValues', label: t('editor:settings.navActionValues') },
] as const
type SectionId = (typeof SECTIONS)[number]['id']

const scrollRef = useRef<HTMLDivElement>(null)
const sectionRefs = useRef<Record<SectionId, HTMLDivElement | null>>({
  basic: null,
  safeHp: null,
  actionValues: null,
})
const [activeSection, setActiveSection] = useState<SectionId>('basic')

// 右侧滚动 → 左侧高亮跟随
useEffect(() => {
  const root = scrollRef.current
  if (!root) return
  const observer = new IntersectionObserver(
    entries => {
      const visible = entries
        .filter(e => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
      if (visible) setActiveSection(visible.target.getAttribute('data-section') as SectionId)
    },
    { root, rootMargin: '0px 0px -70% 0px', threshold: 0 }
  )
  for (const el of Object.values(sectionRefs.current)) if (el) observer.observe(el)
  return () => observer.disconnect()
}, [])

const jumpTo = (id: SectionId) => {
  sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
```

return 结构：

```tsx
<>
  <div className="flex-1 flex flex-col sm:flex-row min-h-0 gap-4">
    {/* 左侧大纲：窄屏折成顶部横向 chip 条 */}
    <nav className="flex sm:flex-col gap-1 sm:w-32 shrink-0 overflow-x-auto sm:overflow-x-visible">
      {SECTIONS.map(s => (
        <button
          key={s.id}
          type="button"
          onClick={() => jumpTo(s.id)}
          className={`text-sm text-left whitespace-nowrap px-2 py-1.5 rounded-md transition-colors ${
            activeSection === s.id
              ? 'bg-accent text-accent-foreground font-medium'
              : 'text-muted-foreground hover:bg-accent/50'
          }`}
        >
          {s.label}
        </button>
      ))}
    </nav>

    {/* 右侧连续滚动容器 */}
    <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-4 px-0.5 min-h-0">
      <div ref={el => (sectionRefs.current.basic = el)} data-section="basic">
        {/* Step 4 的基本 section */}
      </div>

      <div className="h-px bg-border" />

      <div ref={el => (sectionRefs.current.safeHp = el)} data-section="safeHp">
        {/* 原「安全血量」整块原样搬入 */}
      </div>

      <div className="h-px bg-border" />

      <div ref={el => (sectionRefs.current.actionValues = el)} data-section="actionValues">
        {/* 原「盾技能数值」整块原样搬入 */}
      </div>
    </div>
  </div>

  <ModalFooter>{/* 原 footer 原样保留 */}</ModalFooter>
</>
```

`ModalContent` 的 className 由 `max-h-[80vh] flex flex-col` 改为 `max-h-[80vh] sm:max-w-2xl flex flex-col`，给两栏留出宽度。

- [ ] **Step 4: 实现「基本」section**

```tsx
          <div className="text-sm font-medium mb-1.5">{t('editor:settings.basicTitle')}</div>
          <div className="flex items-center justify-between py-1.5">
            <span className="text-sm text-muted-foreground">{t('editor:settings.encounter')}</span>
            <Select
              value={String(encounterId)}
              onValueChange={v => handleEncounterChange(Number(v))}
              disabled={isReadOnly}
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RAID_TIERS.filter(tier => !tier.comingSoon).map(tier => (
                  <SelectGroup key={tier.zone}>
                    <SelectLabel>{tier.name}</SelectLabel>
                    {tier.encounters.map(e => (
                      <SelectItem key={e.id} value={String(e.id)}>
                        {e.shortName}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between py-1.5">
            <span className="text-sm text-muted-foreground">{t('editor:settings.level')}</span>
            <Select
              value={String(level)}
              onValueChange={v => setLevel(Number(v) as Level)}
              disabled={isReadOnly}
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUPPORTED_LEVELS.map(lv => (
                  <SelectItem key={lv} value={String(lv)}>
                    {lv} {t('editor:settings.levelUnit')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
```

配套的 store 读写与改绑副本处理：

```tsx
const level = useTimelineStore(s => s.timeline?.level) ?? DEFAULT_LEVEL
const encounterId = useTimelineStore(s => s.timeline?.encounter.id) ?? 0
const setLevel = useTimelineStore(s => s.setLevel)
const updateEncounter = useTimelineStore(s => s.updateEncounter)

// 改绑副本：更新副本元信息 + gameZoneId，等级自动跳到新副本的等级
const handleEncounterChange = (nextId: number) => {
  const encounter = getEncounterById(nextId)
  if (!encounter) return
  updateEncounter(nextId)
  setLevel(toLevel(encounter.level))
}
```

等级与副本是**即时生效**（写 Y.Doc），不受 footer「保存」按钮管辖——「保存」只提交 `localStatData`。这与 §6.2 的单事务撤销语义一致。

- [ ] **Step 5: 补 updateEncounter store action**

若 `timelineStore` 尚无 `updateEncounter`，新增：

```ts
    /** 改绑副本：更新 encounter 元信息与 gameZoneId（等级由调用方随后 setLevel） */
    updateEncounter: (encounterId: number) => {
      const engine = get().engine
      const timeline = get().timeline
      if (!engine || !timeline) return
      const staticEncounter = getEncounterById(encounterId)
      if (!staticEncounter) return
      engine.doc.transact(() => {
        ySetMeta(engine.doc, {
          encounter: {
            id: encounterId,
            name: staticEncounter.shortName,
            displayName: staticEncounter.name,
            zone: '',
            damageEvents: [],
          },
          gameZoneId: staticEncounter.gameZoneId,
        })
      }, LOCAL_ORIGIN)
    },
```

接口声明中加 `updateEncounter: (encounterId: number) => void`。

改绑副本产生两个相邻事务（`updateEncounter` + `setLevel`），撤销时需按两步。若要合并为一步，把 `handleEncounterChange` 的两次调用包在 `engine.doc.transact` 内——但那需要组件持有 engine 引用，违反 store 封装。**接受两步撤销**：改副本本就是低频且显式的操作，与切等级不同。

- [ ] **Step 6: 技能数值列表叠加等级过滤**

`SettingsDialogInner` 的 `groupedActions` useMemo，把 `MITIGATION_DATA.actions` 改为 `useResolvedActions()` 的 `actions`：

```tsx
  const { actions: resolvedActions } = useResolvedActions()

  const groupedActions = useMemo(() => {
    if (!composition) return []
    const jobs = new Set(composition.players.map(p => p.job))
    const actionsWithEntries = resolvedActions.filter(
      a => a.statDataEntries && a.statDataEntries.length > 0 && a.jobs.some(j => jobs.has(j))
    )
    // 以下分组逻辑原样保留
    ...
  }, [composition, resolvedActions])
```

删除该文件对 `MITIGATION_DATA` 的 import。

- [ ] **Step 7: 更新工具栏入口**

`src/components/EditorToolbar.tsx`：

- `:64` `import StatDataDialog from './StatDataDialog'` → `import SettingsDialog from './SettingsDialog'`
- `:126` `showStatDataDialog` → `showSettingsDialog`（含 `:501` 的 setter 调用）
- `:494` 注释「数值设置：…」→「设置：…」
- 按钮文案 `t('editor:statData')` → `t('editor:settings')`（顶层 key，非 `settings.title`）
- `:656` `<StatDataDialog ... />` → `<SettingsDialog ... />`

- [ ] **Step 8: 手工验证**

Run: `pnpm build`
Expected: 构建成功

在已运行的 dev server 中打开任一时间轴 → 工具栏「设置」→ 确认：

1. 左侧三个菜单项，点击后右侧平滑滚动到对应区块
2. 右侧滚动时左侧高亮跟随
3. 「基本」里改等级 → 技能轨道数量变化 → Ctrl+Z 一次完整还原
4. 窄屏（浏览器缩到 640px 以下）左栏变为顶部横条

- [ ] **Step 9: 跑测试与 lint 并提交**

```bash
pnpm test:run
pnpm lint
pnpm exec tsc --noEmit
git add src/components/SettingsDialog.tsx src/components/EditorToolbar.tsx src/i18n/locales/zh-CN/editor.json
git rm --cached src/components/StatDataDialog.tsx 2>/dev/null || true
git commit -m "feat(level): 数值设置重构为左右布局的设置面板并纳入副本与等级"
```

---

## 完成验收

全部 task 完成后：

```bash
pnpm test:run
pnpm lint
pnpm exec tsc --noEmit
pnpm build
```

四条全绿方可宣称完成。

**遗留工作（不属于本计划）**：

- 其余 ~150 个 action 的 70/80/90 历史数据补齐，含数值 / 额外效果 / 充能三类分歧的真实案例
- `maxLevel`（技能被升级顶掉）的真实数据，如医济（`133`，当前未收录）在 96 级被医养顶掉——需要先补齐医济条目

机制与校验已就位：`resolveAction` 单测覆盖了 `minLevel` / `maxLevel` / `levelOverrides` 的全部语义，后续补数据时四档位校验会自动守住 trackGroup / placement 约束。
