import { simulate } from '@/utils/mitigationCalculator'
import { deriveLethalDangerous } from '@/utils/lethalDanger'
import { isInScope } from './scope'
import type { OptimizeInput, Evaluator, PerEventEval } from './types'

/**
 * 评估器：给定 cast 集合，调 simulate(skipHpPipeline) 得每事件 finalDamage，
 * 汇总 in-scope 总伤、致死集，并透出 status 时间线供合法性查询复用（免二次 simulate）。
 * 纯函数：每次调用独立，试探可丢弃返回值回滚。
 */
export function createEvaluator(input: OptimizeInput): Evaluator {
  // simulate 是纯函数直接调用：每次调用都在内部局部初始化全部状态、不跨调用持有
  // 可变状态，天然满足"每次调用独立/纯函数"约束，无实例可复用的概念。
  const inScopeIds = new Set(input.damageEvents.filter(isInScope).map(e => e.id))
  return casts => {
    // 故意不传 tankPlayerIds：优化作用域仅 AOE 类事件（isInScope），而 tankPlayerIds 只影响
    // 坦专（tankbuster/auto，includeTankOnly）分支，对 in-scope 事件无作用，省略后评估值与
    // 编辑器实时重算一致。若将来作用域扩到坦专事件，这里必须补回 tankPlayerIds 以免静默分歧。
    const out = simulate({
      castEvents: casts,
      damageEvents: input.damageEvents,
      initialState: input.initialState,
      statistics: input.statistics,
      baseReferenceMaxHPForAoe: input.baseReferenceMaxHPForAoe,
      baseReferenceMaxHPForTank: input.baseReferenceMaxHPForTank,
      skipHpPipeline: true,
    })
    const perEvent = new Map<string, PerEventEval>()
    const lethal = new Set<string>()
    let total = 0
    for (const e of input.damageEvents) {
      const r = out.damageResults.get(e.id)
      if (!r) continue
      const inScope = inScopeIds.has(e.id)
      perEvent.set(e.id, {
        time: e.time,
        inScope,
        finalDamage: r.finalDamage,
        referenceMaxHP: r.referenceMaxHP,
      })
      if (inScope) {
        total += r.finalDamage
        // skipHpPipeline → 无 hpSim/overkill，落 refHP fallback 分支
        const { isLethal } = deriveLethalDangerous(
          undefined,
          r.finalDamage,
          r.referenceMaxHP,
          false
        )
        if (isLethal) lethal.add(e.id)
      }
    }
    return {
      total,
      perEvent,
      lethal,
      statusTimelineByPlayer: out.statusTimelineByPlayer,
      resolvedVariantByCastId: out.resolvedVariantByCastId,
    }
  }
}
