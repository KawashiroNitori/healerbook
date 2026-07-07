/**
 * 合成 CD 资源池的 `__cd__:` 前缀协议 —— 单一定义点。
 * 无显式消费者（resourceEffects 不含 delta<0）的 action，compute 层
 * 合成一个 id 为 `__cd__:${actionId}` 的单充能池，强制走 cooldown 语义。
 */
export const SYNTH_CD_PREFIX = '__cd__:'

/** 构造合成 CD 资源 id */
export function synthCdResourceId(actionId: number): string {
  return `${SYNTH_CD_PREFIX}${actionId}`
}

/** 判断 resourceId 是否属于合成 CD 命名空间 */
export function isSynthCdResource(resourceId: string): boolean {
  return resourceId.startsWith(SYNTH_CD_PREFIX)
}

/** 从合成 CD 资源 id 剥出 actionId；非本命名空间或非数字返回 undefined */
export function synthCdActionId(resourceId: string): number | undefined {
  if (!isSynthCdResource(resourceId)) return undefined
  const n = Number(resourceId.slice(SYNTH_CD_PREFIX.length))
  return Number.isFinite(n) ? n : undefined
}
