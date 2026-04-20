/**
 * 状态元数据本地补充表
 *
 * 3rd party `keigenns` 提供基础数据（id / name / type / performance / isFriendly 等），
 * 本表按 statusId 提供本地扩展字段的覆盖值。未在此表中的状态走 statusRegistry 里的默认值。
 */

import type { StatusExecutor } from '@/types/status'

/** 单个状态的本地补充字段 */
export interface StatusExtras {
  /** 是否仅对坦克生效；缺省为 false */
  isTankOnly?: boolean
  /** performance.heal 倍率（1 = 无影响，> 1 增疗）；缺省为 1 */
  heal?: number
  /** performance.maxHP 倍率（1 = 无影响，> 1 增加最大 HP）；缺省为 1 */
  maxHP?: number
  /** 状态自身的副作用钩子（可选） */
  executor?: StatusExecutor
}

/** statusId → 本地补充字段 */
export const STATUS_EXTRAS: Record<number, StatusExtras> = {
  // T 通用

  1191: { isTankOnly: true, heal: 1.15 }, // 铁壁

  // 骑士
  17: { isTankOnly: true }, // 预警
  1856: { isTankOnly: true }, // 盾阵
  2674: { isTankOnly: true }, // 圣盾阵
  82: { isTankOnly: true }, // 神圣领域
  77: { isTankOnly: true }, // 壁垒
  1174: { isTankOnly: true }, // 干预
  2675: { isTankOnly: true }, // 骑士的坚守
  3829: { isTankOnly: true }, // 极致防御

  // 战士
  87: { isTankOnly: true, heal: 1.2, maxHP: 1.2 }, // 战栗
  89: { isTankOnly: true }, // 复仇
  3832: { isTankOnly: true }, // 戮罪
  409: { isTankOnly: true }, // 死斗
  735: { isTankOnly: true }, // 原初的直觉
  1858: { isTankOnly: true }, // 原初的武猛
  2678: { isTankOnly: true }, // 原初的血气
  2679: { isTankOnly: true }, // 原初的血潮
  2680: { isTankOnly: true }, // 原初的血烟

  // 暗骑
  747: { isTankOnly: true }, // 暗影墙
  3835: { isTankOnly: true }, // 暗影卫
  746: { isTankOnly: true }, // 弃明投暗
  810: { isTankOnly: true }, // 行尸走肉
  811: { isTankOnly: true }, // 死而不僵
  3255: { isTankOnly: true }, // 出死入生
  1178: { isTankOnly: true }, // 至黑之夜
  2682: { isTankOnly: true }, // 献奉

  // 绝枪
  1832: { isTankOnly: true }, // 伪装
  1834: { isTankOnly: true }, // 星云
  3838: { isTankOnly: true }, // 大星云
  1836: { isTankOnly: true }, // 超火流星
  1840: { isTankOnly: true }, // 石之心
  2683: { isTankOnly: true }, // 刚玉之心
  2684: { isTankOnly: true }, // 刚玉之清
}
