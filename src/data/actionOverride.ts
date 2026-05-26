/**
 * 导入期技能分类硬覆盖表
 *
 * FFLogs 自动判别（detectDamageType + refine 启发式 + classifyPartialAOE）对个别技能
 * 会误判。本表按 ability gameID 提供**权威覆盖**：parseDamageEvents 在所有启发式跑完后，
 * 最后据本表强制改写 DamageEvent.type，绕过一切启发式。
 *
 * 键为 FFLogs 的 ability gameID（即 PlayerDamageDetail.abilityId）。
 */

/**
 * 命中即强制判为死刑(tankbuster)的 ability gameID 集合。
 *
 * 用于补救"伤害量级够不上死刑阈值、或命中目标启发式失效"导致被误判为 aoe/partial 的死刑技能。
 * 按需补充，例如：`new Set<number>([12345, 23456])`。
 */
export const TANK_BUSTER_ACTION_IDS: ReadonlySet<number> = new Set<number>([
  40285, // 真夜舞蹈
  40182, // 暗夜舞蹈
  40192, // 四剑斩
  40168, // 连锁爆印铭刻
  40169, // 爆印
  40315, // 光与暗的孤翼
  40314, // 光与暗的孤翼
  39879, // 光与暗的孤翼
])

/**
 * 命中即强制判为普通攻击(auto)的 ability gameID 集合。
 *
 * 用于补救命名不规范、被 refineAutoAttackClassification 启发式漏判的 boss 自动攻击。
 * 按需补充，例如：`new Set<number>([12345, 23456])`。
 */
export const AUTO_ATTACK_ACTION_IDS: ReadonlySet<number> = new Set<number>([
  27946, // 真龙爪击
])
