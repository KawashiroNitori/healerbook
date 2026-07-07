/**
 * Placement 时间容差常量；类型定义见 @/types/placement。
 */

/**
 * 时间比较容差（秒）。
 * 用于所有涉及"紧贴""边界包含"的浮点比较：timestamp 由 FFLogs 导入（ms/1000）、
 * 拖拽 snap（x/zoom）、shadow 端点（ts + cd）等路径算出，会带 1~2 ULP（~1e-15）
 * 级的浮点偏差。裸 `<` / `<=` 比较在这种偏差下会把紧贴误判为重叠或反之。
 * 取 1e-6 远大于浮点误差、远小于时间轴语义粒度（0.01s）——两边都留足安全裕度。
 */
export const TIME_EPS = 1e-6
