/**
 * Souma 时间轴 sync 规则表
 *
 * 定义导出 Souma 时间轴时，各副本关键 Boss 机制对应的 sync 锚点规则。
 * parseSyncEvents 依据此表从 FFLogs 事件流中筛选出会成为时间轴锚点的 cast/begincast
 * 事件，并据此生成 `sync` 行与 window。
 *
 * 种子数据最初取自 `3rdparty/ff14-overlay-vue/src/resources/timelineSpecialRules.ts`,
 * 但本文件即日起作为 Healerbook 的权威数据来源独立演进：可以新增副本机制、调整
 * window、引入 Healerbook 专属规则，不必与 submodule 保持同步。
 *
 * 语义：
 * - 按 `(actionId, type)` 匹配事件；`type` 对应 FFLogs 事件类型
 *   （`begincast` 或 `cast`）。
 * - `window: [before, after]` 传递到输出的 `sync` 行上，作为 Souma 时间轴的
 *   允许漂移窗口。
 * - `battleOnce: true` 表示导入阶段对该技能全局去重，仅保留第一次命中。
 * - `syncOnce: true` 表示输出的 sync 行追加 `once` 关键字，Souma 运行时只会触发
 *   一次匹配。
 *
 * 消费者：`src/utils/fflogsImporter.ts` 的 `parseSyncEvents`。
 */

export interface SoumaSyncRule {
  type: 'begincast' | 'cast'
  window: [number, number]
  syncOnce?: boolean
  battleOnce?: boolean
}

export const SOUMA_SYNC_RULES: ReadonlyMap<number, SoumaSyncRule> = new Map<number, SoumaSyncRule>([
  // 海德林转场 众生离绝
  [26155, { type: 'cast', window: [999, 999], battleOnce: true }],
  // 佐迪亚克转场 悼念
  [28027, { type: 'cast', window: [999, 999], battleOnce: true }],
  // P3S 转场 黑暗不死鸟
  [26340, { type: 'cast', window: [999, 999], battleOnce: true }],
  // 绝龙诗 万物终结
  [25533, { type: 'begincast', window: [60, 60] }],
  // 绝龙诗 灭绝之诗
  [26376, { type: 'cast', window: [999, 999], battleOnce: true }],
  // 绝龙诗 邪龙爪牙
  [26814, { type: 'begincast', window: [999, 999], battleOnce: true }],
  // 绝龙诗 空间牢狱
  [25313, { type: 'begincast', window: [200, 200] }],
  // 绝龙诗 圣徒化
  [27526, { type: 'begincast', window: [999, 999], battleOnce: true }],
  // 绝龙诗 P6 Nidhogg v2
  [26215, { type: 'cast', window: [500, 30], battleOnce: true }],
  // 绝龙诗 P6.5 Eyes v2
  [29050, { type: 'begincast', window: [200, 30], battleOnce: true }],
  // 绝龙诗 冲击波
  [29156, { type: 'cast', window: [20, 20] }],
  // 绝龙诗 邪念之火
  [27973, { type: 'cast', window: [20, 20] }],
  // 绝龙诗 绝命怒嚎
  [27937, { type: 'begincast', window: [20, 20] }],
  // 绝龙诗 骑龙剑百京核爆
  [28059, { type: 'begincast', window: [20, 20] }],
  [28060, { type: 'begincast', window: [20, 20] }],
  [28061, { type: 'begincast', window: [20, 20] }],
  // 绝龙诗 圣龙吐息
  [27956, { type: 'begincast', window: [20, 20] }],
  [27957, { type: 'begincast', window: [20, 20] }],
  // 绝龙诗 灭杀的誓言
  [27952, { type: 'begincast', window: [30, 30] }],
  // 绝龙诗 无尽轮回
  [27969, { type: 'begincast', window: [20, 20] }],
  [27971, { type: 'begincast', window: [20, 20] }],
  // 绝龙诗 神圣之翼
  [27939, { type: 'begincast', window: [20, 20] }],
  // 绝龙诗 邪炎俯冲
  [27966, { type: 'begincast', window: [20, 20] }],
  // 绝龙诗 纯洁心灵
  [25316, { type: 'begincast', window: [999, 999], battleOnce: true }],
  // 绝龙诗 阿斯卡隆之仁·隐秘
  [25544, { type: 'begincast', window: [10, 10] }],
  // 绝龙诗 腾龙枪
  [26379, { type: 'begincast', window: [10, 10] }],
  // 绝欧米茄 防御程序
  [31552, { type: 'begincast', window: [30, 30] }],
  // 绝欧米茄 你好，世界
  [31573, { type: 'begincast', window: [30, 30] }],
  // 绝欧米茄 波动炮
  [31617, { type: 'begincast', window: [8, 8] }],
  // 绝欧米茄 代号：*能*·德尔塔
  [31624, { type: 'begincast', window: [30, 30] }],
  // 绝欧米茄 宇宙记忆
  [31649, { type: 'begincast', window: [30, 30] }],
  // 绝亚 流体摆动
  [0x49b0, { type: 'cast', window: [10, 2.5], syncOnce: true }],
  // 绝亚 鹰式破坏炮
  [0x4830, { type: 'cast', window: [200, 60], syncOnce: true, battleOnce: true }],
  // 绝亚 正义飞踢
  [0x4854, { type: 'cast', window: [250, 65], syncOnce: true, battleOnce: true }],
  // 绝亚 时间停止
  [0x485a, { type: 'begincast', window: [500, 500], syncOnce: true, battleOnce: true }],
  // 绝亚 神圣审判
  [0x4878, { type: 'begincast', window: [67, 67], syncOnce: true }],
  [0x4879, { type: 'cast', window: [67, 67], syncOnce: true }],
  // 绝亚 unknown
  [0x4a8b, { type: 'cast', window: [900, 200], syncOnce: true, battleOnce: true }],
  // 绝伊甸 P2 四重强击
  [0x9cff, { type: 'begincast', window: [200, 20], syncOnce: true }],
  // 绝伊甸 P3 地狱审判
  [0x9d49, { type: 'begincast', window: [500, 20], syncOnce: true, battleOnce: true }],
  // 绝伊甸 P4 具象化
  [0x9d36, { type: 'begincast', window: [999, 30], syncOnce: true, battleOnce: true }],
  // 绝伊甸 P5 光尘之剑
  [0x9d72, { type: 'begincast', window: [30, 30], syncOnce: true }],
  // 绝神兵 P2 深红旋风
  [0x2b5f, { type: 'begincast', window: [310, 30], syncOnce: true, battleOnce: true }],
  // 绝神兵 P3 大地粉碎
  [0x2cfd, { type: 'begincast', window: [600, 30], syncOnce: true, battleOnce: true }],
  // 绝神兵 P4 雾散爆发
  [0x2b72, { type: 'begincast', window: [100, 30], syncOnce: true, battleOnce: true }],
  // 绝神兵 魔导核爆
  [0x2b87, { type: 'begincast', window: [60, 60], syncOnce: true }],
  // 绝神兵 追击之究极幻想
  [0x2b76, { type: 'begincast', window: [100, 100], syncOnce: true, battleOnce: true }],
  // 绝神兵 爆击之究极幻想
  [0x2d4c, { type: 'begincast', window: [100, 100], syncOnce: true, battleOnce: true }],
  // 绝神兵 乱击之究极幻想
  [0x2d4d, { type: 'begincast', window: [100, 100], syncOnce: true, battleOnce: true }],
  // M5S 经典铭心
  [0xa721, { type: 'begincast', window: [9.6, 2], syncOnce: true }],
  // M5S 激热跳舞街
  [0xa756, { type: 'cast', window: [77.2, 30], syncOnce: true, battleOnce: true }],
  // M5S 在这停顿！
  [0xa76f, { type: 'cast', window: [30, 30], syncOnce: false }],
  // M5S 欢庆时刻
  [0xa723, { type: 'cast', window: [30, 30], syncOnce: false }],
  // M5S 在这停顿！
  [0xa770, { type: 'cast', window: [30, 30], syncOnce: false }],
  // M8S 空间斩
  [0xa3da, { type: 'begincast', window: [10, 10], syncOnce: false }],
  // M8S 风之狼吼
  [0xa3d0, { type: 'begincast', window: [20, 30], syncOnce: true }],
  // M8S 土之狼吼
  [0xa3d3, { type: 'begincast', window: [20, 20], syncOnce: true }],
  // M8S 风尘光狼斩
  [0xa749, { type: 'begincast', window: [60, 60], syncOnce: true, battleOnce: true }],
  // M8S 空间灭斩
  [0xa3f1, { type: 'begincast', window: [20, 20], syncOnce: true }],
  // M8S --middle--
  [0xa38f, { type: 'cast', window: [60, 60], syncOnce: true, battleOnce: true }],
  // M8S --sync--
  [0xa82d, { type: 'cast', window: [60, 60], syncOnce: true, battleOnce: true }],
  // 极火车 无尽狂奔
  [0xb24d, { type: 'cast', window: [60, 60], syncOnce: true, battleOnce: true }],
])
