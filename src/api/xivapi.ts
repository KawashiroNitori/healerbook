/**
 * XIV API V2 客户端
 * 用于获取 FF14 游戏数据
 */

const XIVAPI_BASE_URL = 'https://xivapi-v2.xivcdn.com/api'

/**
 * CafeMaker Action 数据结构（保持原有字段格式）
 */
export interface CafeMakerAction {
  ID: number
  Name: string
  Description: string
  Icon: string
  IconHD: string
  ClassJobLevel: number
  Range: number
  EffectRange: number
  Cast100ms: number
  Recast100ms: number
  PrimaryCostType: number
  PrimaryCostValue: number
  ActionCategory?: {
    Name: string
  }
}

const ACTION_FIELDS = [
  'Name',
  'Icon',
  'ClassJobLevel',
  'Range',
  'EffectRange',
  'Cast100ms',
  'Recast100ms',
  'PrimaryCostType',
  'PrimaryCostValue',
  'ClassJob.Abbreviation',
  'ActionCategory.Name',
].join(',')

interface XIVAPIResponse {
  row_id: number
  fields: {
    Name: string
    Icon: { path: string; path_hr1: string }
    ClassJobLevel: number
    Range: number
    EffectRange: number
    Cast100ms: number
    Recast100ms: number
    PrimaryCostType: number
    PrimaryCostValue: number
    ClassJob: { value: number; fields?: { Abbreviation: string } }
    ActionCategory?: { value: number; fields?: { Name: string } }
  }
  transient: { 'Description@as(html)': string }
}

function toIconPath(path: string): string {
  return `https://v2.xivapi.com/api/asset?path=${path}&format=png`
}

function convertResponse(id: number, data: XIVAPIResponse): CafeMakerAction {
  const f = data.fields
  return {
    ID: id,
    Name: f.Name,
    Description: data.transient['Description@as(html)'],
    Icon: toIconPath(f.Icon.path),
    IconHD: toIconPath(f.Icon.path_hr1),
    ClassJobLevel: f.ClassJobLevel,
    Range: f.Range,
    EffectRange: f.EffectRange,
    Cast100ms: f.Cast100ms,
    Recast100ms: f.Recast100ms,
    PrimaryCostType: f.PrimaryCostType,
    PrimaryCostValue: f.PrimaryCostValue,
    ActionCategory: f.ActionCategory?.fields
      ? { Name: f.ActionCategory.fields.Name }
      : undefined,
  }
}

/**
 * 获取技能详细信息
 * @param actionId 技能 ID
 * @returns 技能数据
 */
export async function getActionById(actionId: number): Promise<CafeMakerAction | null> {
  try {
    const url = new URL(`${XIVAPI_BASE_URL}/sheet/Action/${actionId}`)
    url.searchParams.set('fields', ACTION_FIELDS)
    url.searchParams.set('transient', 'Description@as(html)')
    const response = await fetch(url.toString())
    if (!response.ok) {
      console.error(`Failed to fetch action ${actionId}: ${response.status}`)
      return null
    }
    const data: XIVAPIResponse = await response.json()
    return convertResponse(actionId, data)
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
export async function getActionsByIds(actionIds: number[]): Promise<Map<number, CafeMakerAction>> {
  const results = new Map<number, CafeMakerAction>()

  await Promise.all(
    actionIds.map(async id => {
      const action = await getActionById(id)
      if (action) {
        results.set(id, action)
      }
    })
  )

  return results
}
