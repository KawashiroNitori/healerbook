// FFXIV 副本遭遇战数据，用于 TOP100 数据源集成
// 遭遇战 ID 参考：https://www.fflogs.com/zone/statistics/52

export interface RaidEncounter {
  // FFLogs 遭遇战 ID
  id: number
  // 完整名称
  name: string
  // 简称（用于显示）
  shortName: string
}

export interface RaidTier {
  // 名称
  name: string
  // 区域 ID
  zone: number
  // 补丁版本
  patch: string
  // 副本列表
  encounters: RaidEncounter[]
}

export const RAID_TIERS: RaidTier[] = [
  {
    name: '阿卡狄亚零式登天斗技场 重量级',
    zone: 73,
    patch: '7.4',
    encounters: [
      { id: 101, name: '致命美人', shortName: 'M9S' },
      { id: 102, name: '极限兄弟', shortName: 'M10S' },
      { id: 103, name: '霸王', shortName: 'M11S' },
      { id: 104, name: '林德布鲁姆', shortName: 'M12S' },
      { id: 105, name: '林德布鲁姆 II', shortName: 'M12S' },
    ],
  },
  {
    name: '光暗未来绝境战',
    zone: 65,
    patch: '7.1',
    encounters: [
      { id: 1079, name: '光暗未来绝境战', shortName: 'FRU'},
    ],
  },
]

// 所有遭遇战的扁平列表
export const ALL_ENCOUNTERS: RaidEncounter[] = RAID_TIERS.flatMap((tier) => tier.encounters)

// 通过 ID 获取遭遇战信息
export function getEncounterById(id: number): RaidEncounter | undefined {
  return ALL_ENCOUNTERS.find((e) => e.id === id)
}
