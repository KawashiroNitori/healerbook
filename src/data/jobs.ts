/**
 * FF14 职业元数据
 * 包含所有职业的完整信息
 */

/**
 * 职业角色类型
 */
export type JobRole = 'tank' | 'healer' | 'melee' | 'ranged' | 'caster'

/**
 * 职业元数据接口
 */
export interface JobMetadata {
  /** 职业简称（英文） */
  code: string
  /** 职业中文名称 */
  name: string
  /** 职业英文全称 */
  nameEn: string
  /** 两字简写（用于导出表格等空间有限场景） */
  shortName: string
  /** 单字简写 */
  initial: string
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
export const JOB_METADATA = {
  // ========== 坦克 ==========
  PLD: {
    code: 'PLD',
    name: '骑士',
    nameEn: 'Paladin',
    shortName: '骑士',
    initial: '骑',
    role: 'tank',
    icon: 'xiv-class_job_019',
    order: 1,
  },
  WAR: {
    code: 'WAR',
    name: '战士',
    nameEn: 'Warrior',
    shortName: '战士',
    initial: '战',
    role: 'tank',
    icon: 'xiv-class_job_021',
    order: 2,
  },
  DRK: {
    code: 'DRK',
    name: '暗黑骑士',
    nameEn: 'Dark Knight',
    shortName: '暗骑',
    initial: '暗',
    role: 'tank',
    icon: 'xiv-class_job_032',
    order: 3,
  },
  GNB: {
    code: 'GNB',
    name: '绝枪战士',
    nameEn: 'Gunbreaker',
    shortName: '枪刃',
    initial: '枪',
    role: 'tank',
    icon: 'xiv-class_job_037',
    order: 4,
  },

  // ========== 治疗 ==========
  WHM: {
    code: 'WHM',
    name: '白魔法师',
    nameEn: 'White Mage',
    shortName: '白魔',
    initial: '白',
    role: 'healer',
    icon: 'xiv-class_job_024',
    order: 5,
  },
  SCH: {
    code: 'SCH',
    name: '学者',
    nameEn: 'Scholar',
    shortName: '学者',
    initial: '学',
    role: 'healer',
    icon: 'xiv-class_job_028',
    order: 6,
  },
  AST: {
    code: 'AST',
    name: '占星术士',
    nameEn: 'Astrologian',
    shortName: '占星',
    initial: '占',
    role: 'healer',
    icon: 'xiv-class_job_033',
    order: 7,
  },
  SGE: {
    code: 'SGE',
    name: '贤者',
    nameEn: 'Sage',
    shortName: '贤者',
    initial: '贤',
    role: 'healer',
    icon: 'xiv-class_job_040',
    order: 8,
  },

  // ========== 近战DPS ==========
  MNK: {
    code: 'MNK',
    name: '武僧',
    nameEn: 'Monk',
    shortName: '武僧',
    initial: '僧',
    role: 'melee',
    icon: 'xiv-class_job_020',
    order: 9,
  },
  DRG: {
    code: 'DRG',
    name: '龙骑士',
    nameEn: 'Dragoon',
    shortName: '龙骑',
    initial: '龙',
    role: 'melee',
    icon: 'xiv-class_job_022',
    order: 10,
  },
  NIN: {
    code: 'NIN',
    name: '忍者',
    nameEn: 'Ninja',
    shortName: '忍者',
    initial: '忍',
    role: 'melee',
    icon: 'xiv-class_job_030',
    order: 11,
  },
  SAM: {
    code: 'SAM',
    name: '武士',
    nameEn: 'Samurai',
    shortName: '武士',
    initial: '侍',
    role: 'melee',
    icon: 'xiv-class_job_034',
    order: 12,
  },
  RPR: {
    code: 'RPR',
    name: '钐镰客',
    nameEn: 'Reaper',
    shortName: '镰刀',
    initial: '镰',
    role: 'melee',
    icon: 'xiv-class_job_039',
    order: 13,
  },
  VPR: {
    code: 'VPR',
    name: '蝰蛇剑士',
    nameEn: 'Viper',
    shortName: '蝰蛇',
    initial: '蛇',
    role: 'melee',
    icon: 'xiv-class_job_041',
    order: 14,
  },

  // ========== 远程物理DPS ==========
  BRD: {
    code: 'BRD',
    name: '吟游诗人',
    nameEn: 'Bard',
    shortName: '诗人',
    initial: '诗',
    role: 'ranged',
    icon: 'xiv-class_job_023',
    order: 15,
  },
  MCH: {
    code: 'MCH',
    name: '机工士',
    nameEn: 'Machinist',
    shortName: '机工',
    initial: '机',
    role: 'ranged',
    icon: 'xiv-class_job_031',
    order: 16,
  },
  DNC: {
    code: 'DNC',
    name: '舞者',
    nameEn: 'Dancer',
    shortName: '舞者',
    initial: '舞',
    role: 'ranged',
    icon: 'xiv-class_job_038',
    order: 17,
  },

  // ========== 远程魔法DPS ==========
  BLM: {
    code: 'BLM',
    name: '黑魔法师',
    nameEn: 'Black Mage',
    shortName: '黑魔',
    initial: '黑',
    role: 'caster',
    icon: 'xiv-class_job_025',
    order: 18,
  },
  SMN: {
    code: 'SMN',
    name: '召唤师',
    nameEn: 'Summoner',
    shortName: '召唤',
    initial: '召',
    role: 'caster',
    icon: 'xiv-class_job_027',
    order: 19,
  },
  RDM: {
    code: 'RDM',
    name: '赤魔法师',
    nameEn: 'Red Mage',
    shortName: '赤魔',
    initial: '赤',
    role: 'caster',
    icon: 'xiv-class_job_035',
    order: 20,
  },
  PCT: {
    code: 'PCT',
    name: '绘灵法师',
    nameEn: 'Pictomancer',
    shortName: '画师',
    initial: '画',
    role: 'caster',
    icon: 'xiv-class_job_042',
    order: 21,
  },
} satisfies Record<string, JobMetadata>

/**
 * FF14 职业（从 JOB_METADATA 键推导）
 */
export type Job = keyof typeof JOB_METADATA

/**
 * 按照标准职业顺序排序
 * @param items - 要排序的数组
 * @param keySelector - 可选的键选择器函数，用于从数组元素中提取 Job
 */
export function sortJobsByOrder<T>(items: T[], keySelector?: (item: T) => Job): T[]
export function sortJobsByOrder(items: Job[]): Job[]
export function sortJobsByOrder<T>(items: T[], keySelector?: (item: T) => Job): T[] {
  return [...items].sort((a, b) => {
    const jobA = keySelector ? keySelector(a) : (a as unknown as Job)
    const jobB = keySelector ? keySelector(b) : (b as unknown as Job)
    const orderA = JOB_METADATA[jobA]?.order ?? 999
    const orderB = JOB_METADATA[jobB]?.order ?? 999
    return orderA - orderB
  })
}

/**
 * 职业排序顺序（按 order 字段排序）
 */
export const JOB_ORDER: Job[] = sortJobsByOrder(Object.keys(JOB_METADATA) as Job[])

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
 * 获取职业的两字简写
 */
export function getJobShortName(job: Job): string {
  return JOB_METADATA[job]?.shortName || job
}

/**
 * 获取职业的单字简写
 */
export function getJobInitial(job: Job): string {
  return JOB_METADATA[job]?.initial || job
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

  jobs.forEach(job => {
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
  return JOB_ORDER.filter(job => getJobRole(job) === 'tank')
}

/**
 * 获取所有治疗职业
 */
export function getHealerJobs(): Job[] {
  return JOB_ORDER.filter(job => getJobRole(job) === 'healer')
}

/**
 * 获取所有DPS职业
 */
export function getDPSJobs(): Job[] {
  return JOB_ORDER.filter(job => {
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
