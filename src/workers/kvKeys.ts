// KV key 构造单源：避免 'top100:encounter:' 等前缀魔法字符串散落

/** 获取 TOP100 数据的 KV 键名 */
export function getTop100KVKey(encounterId: number): string {
  return `top100:encounter:${encounterId}`
}

/** 获取统计数据的 KV 键名 */
export function getStatisticsKVKey(encounterId: number): string {
  return `statistics:encounter:${encounterId}`
}

/** 获取样本数据的 KV 键名 */
export function getSamplesKVKey(encounterId: number): string {
  return `statistics-samples:encounter:${encounterId}`
}

/** 获取 encounter template 的 KV 键名 */
export function getEncounterTemplateKVKey(encounterId: number): string {
  return `encounter-template:${encounterId}`
}

/** 时间轴 KV 快照键 */
export function getTimelineSnapshotKVKey(id: string): string {
  return `tl-snapshot:${id}`
}
