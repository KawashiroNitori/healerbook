# 回滚 healMath getMeta 注入,恢复静态 getStatusById 直调

## 背景与动机

第四期 Task 4(commit `b289682`)为"消除 `statusRegistry → statusExtras → healMath → statusRegistry` 静态 import 环",把 healMath 对 `getStatusById` 的直接 import 改成参数注入(`GetStatusMeta`),并级联穿过 `applyDirectHeal` + 三工厂 + `statusExtras`(5 处)+ `mitigationActions`(5 处)+ calculator/hpPipeline,共约 10 个调用点。

复盘发现这笔交易不划算:

- **注入不是真 DI**:`getMeta` 在全部调用点的值**永远是同一个 `getStatusById`**,无第二实现,读起来像假 DI。
- **被消的环本就无害**:Task 4 前的环是良性懒环——`getStatusById` 懒初始化、`STATUS_EXTRAS` 仅在 build 时读,模块求值期无跨环调用,ESM 完全支持,运行时从未出问题。
- **Task 4 净效果**:把一个良性懒环(经 healMath 的 3+4 节点)换成**另一个良性懒环**(`statusRegistry ↔ statusExtras` 2 节点,因 statusExtras 为注入新 import 了 getStatusById),外加 10 处注入噪声。环条数 -1,可读性明显变差。

**本改动**:撤销 Task 4 的注入,healMath / applyDirectHeal 恢复静态 `import { getStatusById }` 直调,删除 `getMeta` 全部穿参与 `GetStatusMeta` 类型。**接受回归后的良性懒环**(与 Task 4 前同形,零运行时影响)。

## 核心契约:零行为变更

`getStatusById` 就是此前被注入到每一处的那个函数,静态直调与注入调用**逐字节等价**。全部黑盒锚测试(`mitigationCalculator.test.ts` 2926 行 / `fflogsImporter.test.ts` / executor 系测试)断言**一行不许改**,期望值全部原样通过。唯一允许的测试改动是**注入机制的机械回退**(见 Task 3),即 healMath.test 从"传 `getMeta` 实参"退回"`vi.mock('@/utils/statusRegistry')`",以及其它测试删除它们传的 `getStatusById` 实参——assertion 数值不动。

## getStatusById 用法分类(决定 import 去留)

回滚时对每个文件:**删注入实参**;`import { getStatusById }` 是否一并删,取决于该文件是否另有真实用途。

| 文件                      | getStatusById 现状                          | 回滚处置                                                                 |
| ------------------------- | ------------------------------------------- | ------------------------------------------------------------------------ |
| `statusExtras.ts`         | 仅注入(:113/140/392/559/610),:32 import     | 删 5 处实参 + **删 import :32**(顺带撤掉 statusExtras→statusRegistry 边) |
| `mitigationActions.ts`    | 仅注入(453/622/672/732/799),:2 import       | 删 5 处实参 + **删 import :2**                                           |
| `createHealExecutor.ts`   | 仅注入(:42),:11 import                      | 删实参 + **删 import**                                                   |
| `createShieldExecutor.ts` | 仅注入(:45),:6 import                       | 删实参 + **删 import**                                                   |
| `createRegenExecutor.ts`  | 仅注入(:38),:12 import                      | 删实参 + **删 import**                                                   |
| `hpPipeline.ts`           | 注入(:31)+ **真调用(:232)**                 | 删 :31 实参,**保留 import**(:232 仍用)                                   |
| `mitigationCalculator.ts` | 注入(:442)+ **真调用(363/494/525/553/678)** | 删 :442 实参,**保留 import**                                             |

---

## Task 1: healMath 恢复静态直调,删 GetStatusMeta

**Files:** `src/executors/healMath.ts`

- 恢复 `import { getStatusById } from '@/utils/statusRegistry'`。
- `computeFinalHeal`:删末位 `getMeta: GetStatusMeta` 形参,函数体内 `getMeta(status.statusId)` → `getStatusById(status.statusId)`。
- `computeMaxHpMultiplierFiltered`:删 `getMeta` 形参,体内 `getMeta(s.statusId)` → `getStatusById(s.statusId)`。
- `computeMaxHpMultiplier`:删 `getMeta` 形参;对 `computeMaxHpMultiplierFiltered` 的调用去掉 getMeta 实参。
- **删除 `export type GetStatusMeta`**(:25)及其 3 处形参标注;文件头注释里关于"叶子调用方注入 getStatusById 避免 import 环"的段落改回"直接查 statusRegistry"。

**验证点**:`grep -n GetStatusMeta src/executors/healMath.ts` 零命中;`grep -n getStatusById` 出现 import + 2 处直调。

## Task 2: applyDirectHeal 删 getMeta 透传

**Files:** `src/executors/applyDirectHeal.ts`

- 删 `getMeta: GetStatusMeta` 形参(现在 recordHeal 前那个)与 `import { ..., type GetStatusMeta }`(改回只 import `computeFinalHeal`)。
- `computeFinalHeal(...)` 调用去掉 getMeta 实参。
- JSDoc 删掉 `@param getMeta` 行。
- 最终签名回到:`applyDirectHeal(partyState, baseAmount, meta, recordHeal?)`。

## Task 3: 调用方删注入实参 + 按分类表删 import

**Files:** `createHealExecutor.ts` / `createShieldExecutor.ts` / `createRegenExecutor.ts` / `data/mitigationActions.ts` / `data/statusExtras.ts` / `utils/simulation/hpPipeline.ts` / `utils/mitigationCalculator.ts`

- 逐处删掉传给 `computeFinalHeal` / `computeMaxHpMultiplier(Filtered)` / `applyDirectHeal` 的 `getStatusById` 实参。
- 按上方分类表:纯注入文件(statusExtras / mitigationActions / 三工厂)**连 import 一起删**;hpPipeline / mitigationCalculator **保留 import**(另有真调用)。
- `mitigationCalculator.ts` 的 `computeReferenceMaxHP`:对 `computeMaxHpMultiplierFiltered` 的调用删 getStatusById 实参,`'closed'` boundary + 调用方 filter 保持不变。

## Task 4: 测试机制回退(assertion 不动)

**Files:** 受影响的 `*.test.ts`(以 grep 为准:healMath / createHealExecutor / createRegenExecutor / mitigationCalculator / hpPipeline / statusRegistry 等)

- **healMath.test.ts**:删 `metaAlways` helper 与 `type GetStatusMeta` import;改为 `vi.mock('@/utils/statusRegistry')`(pre-Task-4 形态)控制 `getStatusById` 返回;所有 `computeFinalHeal(..., getMeta)` / `computeMaxHpMultiplierFiltered(..., getMeta, filter)` 调用去掉 getMeta 实参。**expect 数值(12000/13000/15600/…)逐一保持。**
- 其它测试:凡向 executor 工厂 / applyDirectHeal / computeMaxHpMultiplier 传 `getStatusById` 实参的,删掉该实参;若测试原本靠真实 registry 跑(未 mock),回滚后依旧靠真实 registry,通常无需改。
- **纪律**:任何 assertion 期望值 / fixture 数值的改动都是缺陷;只允许删注入实参、healMath.test 的 mock 机制回退。

## Task 5(可选,顺带):清期末 review 标记的漏网死代码

若此次一并处理,纳入本包(否则留独立小任务):

- `mitigationCalculator.ts` 过渡 re-export 块(Task 2 遗留,全仓零消费者)删除。
- `computeReferenceMaxHP` / `runSingleBranch` 的 `export` + `@internal` JSDoc 降为模块私有(7-9 落地后已无跨模块消费者)。

> 注:此二为纯清理、与 getMeta 回滚无耦合;如想让回滚 commit 保持单一主题,建议拆成本包内独立 commit 或另开任务。

---

## 验证门(每个 commit 前)

`pnpm test:run && pnpm test:workers && pnpm exec tsc -b --noEmit && pnpm lint && pnpm build`

全绿;lint 允许既有 1 warning(`scripts/inspect-ydoc.cjs`),不允许新增。

## 验收

- `grep -rn "GetStatusMeta" src/` 零命中;`grep -rn "getMeta" src/executors src/utils/simulation` 零命中(healMath / applyDirectHeal / hpPipeline 不再有 getMeta 概念)。
- `healMath.ts` 与 `applyDirectHeal.ts` 恢复静态 `getStatusById` 直调路径。
- `mitigationCalculator.test.ts` / `fflogsImporter.test.ts` assertion diff 为零。
- 良性懒环回归属预期,非缺陷;`statusExtras → statusRegistry` 边随 import 删除而消失。
- 零行为变更:无任何声明的行为变更条目。

## 提交约定

- 提交信息用中文,禁止出现 "claude" 字样(commit-msg hook 拒绝,大小写不敏感)。
- 禁止跳过 gpg 签名;1Password 报 `failed to fill whole buffer` 时把改动 staged 好停下,不绕过。
- 未经授权不做 push / 其它 git 操作。
