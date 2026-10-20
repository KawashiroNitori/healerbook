/**
 * 阶段名翻译：导入 / 建轴那一刻按导入者语言查表，结果作为普通文本存入时间轴，
 * 之后不随查看者语言变化。
 *
 * 对照表是 Crowdin 维护的 encounter 命名空间（key: phase.e{encounterId}.p{fflogsPhaseId}）。
 * 不走 i18next：它会把空值回退到 zh-CN，而这里要求查不到 / 空串时保留 FFLogs 原文。
 * 前端（模板建轴）与 Worker（FFLogs 导入）共用本模块，保证两条路径结果一致。
 */

import type { AppLanguage } from '@/types/i18n'
import type { RawPhase, TimelinePhase } from '@/types/timeline'
import zhCN from '@/i18n/locales/zh-CN/encounter.json'
import zhTW from '@/i18n/locales/zh-TW/encounter.json'
import ja from '@/i18n/locales/ja/encounter.json'
import en from '@/i18n/locales/en/encounter.json'
import de from '@/i18n/locales/de/encounter.json'
import fr from '@/i18n/locales/fr/encounter.json'

export interface EncounterTable {
  phase?: Record<string, Record<string, string> | undefined>
}

const TABLES: Record<AppLanguage, EncounterTable> = {
  'zh-CN': zhCN as EncounterTable,
  'zh-TW': zhTW as EncounterTable,
  ja: ja as EncounterTable,
  en: en as EncounterTable,
  de: de as EncounterTable,
  fr: fr as EncounterTable,
}

/** 按表查阶段名；tables 参数仅供测试注入 */
export function translatePhaseName(
  encounterId: number,
  fflogsPhaseId: number,
  rawName: string,
  lang: AppLanguage,
  tables: Record<AppLanguage, EncounterTable> = TABLES
): string {
  const value = tables[lang]?.phase?.[`e${encounterId}`]?.[`p${fflogsPhaseId}`]
  return typeof value === 'string' && value.trim() !== '' ? value : rawName
}

export function rawPhasesToTimelinePhases(
  raw: readonly RawPhase[],
  encounterId: number,
  lang: AppLanguage,
  genId: () => string,
  tables: Record<AppLanguage, EncounterTable> = TABLES
): TimelinePhase[] {
  return raw.map(p => ({
    id: genId(),
    name: translatePhaseName(encounterId, p.fflogsPhaseId, p.name, lang, tables),
    time: p.time,
  }))
}
