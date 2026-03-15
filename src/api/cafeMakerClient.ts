/**
 * CafeMaker API 客户端
 * 用于获取 FF14 游戏数据
 */

const CAFE_MAKER_BASE_URL = 'https://cafemaker.wakingsands.com'

/**
 * CafeMaker Action 数据结构
 */
export interface CafeMakerAction {
  ID: number
  Name_chs: string
  Description_chs: string
  Icon: string
  IconHD: string
  ClassJobLevel: number
  Range: number
  EffectRange: number
  Cast100ms: number // 咏唱时间（单位：0.1秒）
  Recast100ms: number // 复唱时间（单位：0.1秒）
  PrimaryCostType: number // 主要消耗类型（3 = 魔力）
  PrimaryCostValue: number // 消耗魔力
  ClassJob: {
    Abbreviation_chs: string
  }
  ActionCategory?: {
    Name_chs: string
  }
}

const ACTION_COLUMNS = [
  'ID',
  'Name_chs',
  'Description_chs',
  'Icon',
  'IconHD',
  'ClassJobLevel',
  'Range',
  'EffectRange',
  'Cast100ms',
  'Recast100ms',
  'PrimaryCostType',
  'PrimaryCostValue',
  'ClassJob.ClassJobCategory',
  'ActionCategory',
].join(',')

/**
 * 获取技能详细信息
 * @param actionId 技能 ID
 * @returns 技能数据
 */
export async function getActionById(actionId: number): Promise<CafeMakerAction | null> {
  try {
    const url = new URL(`${CAFE_MAKER_BASE_URL}/Action/${actionId}`)
    url.searchParams.set('columns', ACTION_COLUMNS)
    const response = await fetch(url.toString())
    if (!response.ok) {
      console.error(`Failed to fetch action ${actionId}: ${response.status}`)
      return null
    }
    const data = await response.json()
    return data
  } catch (error) {
    console.error(`Error fetching action ${actionId}:`, error)
    return null
  }
}

/**
 * 批量获取技能信息
 * @param actionIds 技能 ID 列表
 * @returns 技能数据映射
 */
export async function getActionsByIds(
  actionIds: number[]
): Promise<Map<number, CafeMakerAction>> {
  const results = new Map<number, CafeMakerAction>()

  await Promise.all(
    actionIds.map(async (id) => {
      const action = await getActionById(id)
      if (action) {
        results.set(id, action)
      }
    })
  )

  return results
}
