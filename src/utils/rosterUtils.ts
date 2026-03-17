import { JOB_MAP } from '../data/jobMap'
import { sortJobsByOrder } from '../data/jobs'
import type { Job } from '../types/timeline'
import { MITIGATION_DATA } from '../data/mitigationActions'

// 从 MITIGATION_DATA.actions 动态生成职业到技能 ID 的映射
function buildJobMitigationIds(): Record<string, number[]> {
  const map: Record<string, number[]> = {}

  for (const action of MITIGATION_DATA.actions) {
    for (const job of action.jobs) {
      if (!map[job]) {
        map[job] = []
      }
      map[job].push(action.id)
    }
  }

  return map
}

const JOB_MITIGATION_IDS = buildJobMitigationIds()

// 将 allCharacters 的 spec 列表转为按标准职业顺序排列的职业代码列表
export function buildComposition(specs: string[]): string[] {
  const jobs = specs.map(spec => JOB_MAP[spec] ?? spec) as Job[]
  return sortJobsByOrder(jobs)
}

// 计算减伤技能组：阵容内所有技能 ID 升序排列（不去重）
export function buildMitigationKey(composition: string[]): number[] {
  const allIds: number[] = []
  for (const job of composition) {
    for (const id of JOB_MITIGATION_IDS[job] ?? []) {
      allIds.push(id)
    }
  }
  return allIds.sort((a, b) => a - b)
}
