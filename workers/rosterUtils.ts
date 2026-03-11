import { JOB_MAP } from '../src/data/jobMap'
import { sortJobsByOrder } from '../src/data/jobs'
import type { Job } from '../src/types/timeline'

// 与 src/data/mitigationActions.new.ts 保持一致
const JOB_MITIGATION_IDS: Record<string, number[]> = {
  PLD: [7535, 3540, 7385],
  WAR: [7535, 7388],
  DRK: [7535, 3638],
  GNB: [7535, 16160],
  WHM: [16536, 7433, 37011],
  SCH: [185, 3585, 16542, 37013, 188, 16538, 25868],
  AST: [16559, 3613, 37031],
  SGE: [24311, 24310, 24298, 37034],
  MNK: [7549], DRG: [7549], NIN: [7549], SAM: [7549], RPR: [7549], VPR: [7549],
  BRD: [7405],
  MCH: [16889],
  DNC: [16012],
  BLM: [7560], SMN: [7560],
  RDM: [7560, 25857],
  PCT: [7560, 34686],
}

// 将 allCharacters 的 spec 列表转为按标准职业顺序排列的职业代码列表
export function buildComposition(specs: string[]): string[] {
  const jobs = specs.map((spec) => JOB_MAP[spec] ?? spec) as Job[]
  return sortJobsByOrder(jobs)
}

// 计算减伤技能组 key：阵容内所有技能 ID 去重后升序，用 - 连接
export function buildMitigationKey(composition: string[]): string {
  const allIds = new Set<number>()
  for (const job of composition) {
    for (const id of JOB_MITIGATION_IDS[job] ?? []) {
      allIds.add(id)
    }
  }
  return [...allIds].sort((a, b) => a - b).join('-')
}
