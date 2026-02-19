/**
 * FF14 职业元数据
 * 包含所有职业的完整信息
 */

import type { Job } from '@/types/timeline'

/**
 * 职业角色类型
 */
export type JobRole = 'tank' | 'healer' | 'melee' | 'ranged' | 'caster'

/**
 * 职业元数据接口
 */
export interface JobMetadata {
  /** 职业简称（英文） */
  code: Job
  /** 职业中文名称 */
  name: string
  /** 职业英文全称 */
  nameEn: string
  /** 职业角色 */
  role: JobRole
  /** 职业图标字体类名（xivapi/classjob-icons） */
  icon: string
  /** 排序权重（用于显示顺序） */
  order: number
}

/**
 * 所有职业的元数据
 */
export const JOB_METADATA: Record<Job, JobMetadata> = {
  // ========== 坦克 ==========
  PLD: {
    code: 'PLD',
    name: '骑士',
    nameEn: 'Paladin',
    role: 'tank',
    icon: 'xiv-class_job_019',
    order: 1,
  },
  WAR: {
    code: 'WAR',
    name: '战士',
    nameEn: 'Warrior',
    role: 'tank',
    icon: 'xiv-class_job_021',
    order: 2,
  },
  DRK: {
    code: 'DRK',
    name: '暗黑骑士',
    nameEn: 'Dark Knight',
    role: 'tank',
    icon: 'xiv-class_job_032',
    order: 3,
  },
  GNB: {
    code: 'GNB',
    name: '绝枪战士',
    nameEn: 'Gunbreaker',
    role: 'tank',
    icon: 'xiv-class_job_037',
    order: 4,
  },

  // ========== 治疗 ==========
  WHM: {
    code: 'WHM',
    name: '白魔法师',
    nameEn: 'White Mage',
    role: 'healer',
    icon: 'xiv-class_job_024',
    order: 5,
  },
  SCH: {
    code: 'SCH',
    name: '学者',
    nameEn: 'Scholar',
    role: 'healer',
    icon: 'xiv-class_job_028',
    order: 6,
  },
  AST: {
    code: 'AST',
    name: '占星术士',
    nameEn: 'Astrologian',
    role: 'healer',
    icon: 'xiv-class_job_033',
    order: 7,
  },
  SGE: {
    code: 'SGE',
    name: '贤者',
    nameEn: 'Sage',
    role: 'healer',
    icon: 'xiv-class_job_040',
    order: 8,
  },

  // ========== 近战DPS ==========
  MNK: {
    code: 'MNK',
    name: '武僧',
    nameEn: 'Monk',
    role: 'melee',
    icon: 'xiv-class_job_020',
    order: 9,
  },
  DRG: {
    code: 'DRG',
    name: '龙骑士',
    nameEn: 'Dragoon',
    role: 'melee',
    icon: 'xiv-class_job_022',
    order: 10,
  },
  NIN: {
    code: 'NIN',
    name: '忍者',
    nameEn: 'Ninja',
    role: 'melee',
    icon: 'xiv-class_job_030',
    order: 11,
  },
  SAM: {
    code: 'SAM',
    name: '武士',
    nameEn: 'Samurai',
    role: 'melee',
    icon: 'xiv-class_job_034',
    order: 12,
  },
  RPR: {
    code: 'RPR',
    name: '钐镰客',
    nameEn: 'Reaper',
    role: 'melee',
    icon: 'xiv-class_job_039',
    order: 13,
  },
  VPR: {
    code: 'VPR',
    name: '蝰蛇剑士',
    nameEn: 'Viper',
    role: 'melee',
    icon: 'xiv-class_job_041',
    order: 14,
  },

  // ========== 远程物理DPS ==========
  BRD: {
    code: 'BRD',
    name: '吟游诗人',
    nameEn: 'Bard',
    role: 'ranged',
    icon: 'xiv-class_job_023',
    order: 15,
  },
  MCH: {
    code: 'MCH',
    name: '机工士',
    nameEn: 'Machinist',
    role: 'ranged',
    icon: 'xiv-class_job_031',
    order: 16,
  },
  DNC: {
    code: 'DNC',
    name: '舞者',
    nameEn: 'Dancer',
    role: 'ranged',
    icon: 'xiv-class_job_038',
    order: 17,
  },

  // ========== 远程魔法DPS ==========
  BLM: {
    code: 'BLM',
    name: '黑魔法师',
    nameEn: 'Black Mage',
    role: 'caster',
    icon: 'xiv-class_job_025',
    order: 18,
  },
  SMN: {
    code: 'SMN',
    name: '召唤师',
    nameEn: 'Summoner',
    role: 'caster',
    icon: 'xiv-class_job_027',
    order: 19,
  },
  RDM: {
    code: 'RDM',
    name: '赤魔法师',
    nameEn: 'Red Mage',
    role: 'caster',
    icon: 'xiv-class_job_035',
    order: 20,
  },
  PCT: {
    code: 'PCT',
    name: '绘灵法师',
    nameEn: 'Pictomancer',
    role: 'caster',
    icon: 'xiv-class_job_042',
    order: 21,
  },
}

/**
 * 职业排序顺序（按 order 字段排序）
 */
export const JOB_ORDER: Job[] = (Object.values(JOB_METADATA) as JobMetadata[])
  .sort((a, b) => a.order - b.order)
  .map((meta) => meta.code)

/**
 * 按照标准职业顺序排序
 */
export function sortJobsByOrder(jobs: Job[]): Job[] {
  return [...jobs].sort((a, b) => {
    const orderA = JOB_METADATA[a]?.order ?? 999
    const orderB = JOB_METADATA[b]?.order ?? 999
    return orderA - orderB
  })
}

/**
 * 获取职业的中文名称
 */
export function getJobName(job: Job): string {
  return JOB_METADATA[job]?.name || job
}

/**
 * 获取职业的英文名称
 */
export function getJobNameEn(job: Job): string {
  return JOB_METADATA[job]?.nameEn || job
}

/**
 * 获取职业的角色类型
 */
export function getJobRole(job: Job): JobRole | undefined {
  return JOB_METADATA[job]?.role
}

/**
 * 获取职业的图标字体类名
 */
export function getJobIcon(job: Job): string {
  return JOB_METADATA[job]?.icon || ''
}

/**
 * 获取职业的图标字体类名（别名，用于更清晰的语义）
 */
export function getJobIconClass(job: Job): string {
  return getJobIcon(job)
}

/**
 * 按角色分组职业
 */
export function groupJobsByRole(jobs: Job[]): Record<JobRole, Job[]> {
  const grouped: Record<JobRole, Job[]> = {
    tank: [],
    healer: [],
    melee: [],
    ranged: [],
    caster: [],
  }

  jobs.forEach((job) => {
    const role = getJobRole(job)
    if (role) {
      grouped[role].push(job)
    }
  })

  return grouped
}

/**
 * 获取所有坦克职业
 */
export function getTankJobs(): Job[] {
  return JOB_ORDER.filter((job) => getJobRole(job) === 'tank')
}

/**
 * 获取所有治疗职业
 */
export function getHealerJobs(): Job[] {
  return JOB_ORDER.filter((job) => getJobRole(job) === 'healer')
}

/**
 * 获取所有DPS职业
 */
export function getDPSJobs(): Job[] {
  return JOB_ORDER.filter((job) => {
    const role = getJobRole(job)
    return role === 'melee' || role === 'ranged' || role === 'caster'
  })
}

/**
 * 角色中文名称
 */
export const ROLE_LABELS: Record<JobRole, string> = {
  tank: '坦克',
  healer: '治疗',
  melee: '近战DPS',
  ranged: '远程物理DPS',
  caster: '远程魔法DPS',
}

/**
 * 获取角色的中文名称
 */
export function getRoleLabel(role: JobRole): string {
  return ROLE_LABELS[role] || role
}

/**
 * 职业角色显示顺序
 */
export const ROLE_ORDER: JobRole[] = ['tank', 'healer', 'melee', 'ranged', 'caster']
