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
