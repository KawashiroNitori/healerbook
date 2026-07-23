/**
 * XIV API V2 客户端
 * 用于获取 FF14 游戏数据
 */

import { requestWithFallback, onApiSuccess } from './providers/apiProvider'
import type { AppLanguage } from '@/types/i18n'

/**
 * app 语言 → XIVAPI `language` 查询参数。
 *
 * XIVAPI v2 官方数据只有 en/ja/de/fr 四种；国服镜像(xivcdn)在**不带** language
 * 参数时返回简体中文。FF14 没有独立的繁体中文文本，故 zh-CN / zh-TW 都取简体，
 * 即返回 null（不带 language，靠 xivcdn 默认）。带非法 language 时两源均 400，
 * 会被 requestWithFallback 当失败跳过——因此中文必须走「不带参数」这条路。
 */
export function toApiLanguage(locale: AppLanguage): 'en' | 'ja' | 'de' | 'fr' | null {
  switch (locale) {
    case 'en':
    case 'ja':
    case 'de':
    case 'fr':
      return locale
    default: // zh-CN / zh-TW → 简体中文（xivcdn 默认）
      return null
  }
}

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
  // 返回原始路径，交由下游 normalizeIcon 归一 + provider 拼 URL
  return path
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
    ActionCategory: f.ActionCategory?.fields ? { Name: f.ActionCategory.fields.Name } : undefined,
  }
}

/**
 * 获取技能详细信息
 * @param actionId 技能 ID
 * @param locale 界面语言，决定返回文案语言（省略则取源默认：xivcdn 简体中文）
 * @returns 技能数据
 */
export async function getActionById(
  actionId: number,
  locale?: AppLanguage
): Promise<CafeMakerAction | null> {
  try {
    const search = new URLSearchParams({
      fields: ACTION_FIELDS,
      transient: 'Description@as(html)',
    })
    const lang = locale ? toApiLanguage(locale) : null
    if (lang) search.set('language', lang)
    const path = `/sheet/Action/${actionId}?${search.toString()}`
    const { data, provider } = await requestWithFallback<XIVAPIResponse>(path)
    onApiSuccess(provider)
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
export async function getActionsByIds(
  actionIds: number[],
  locale?: AppLanguage
): Promise<Map<number, CafeMakerAction>> {
  const results = new Map<number, CafeMakerAction>()

  await Promise.all(
    actionIds.map(async id => {
      const action = await getActionById(id, locale)
      if (action) {
        results.set(id, action)
      }
    })
  )

  return results
}
