/**
 * 过滤预设的展示名：内置走 i18n 键，自定义直接用用户输入的名字。
 */
import type { TFunction } from 'i18next'
import type { FilterPreset } from '@/types/filter'

export function presetLabel(preset: FilterPreset, t: TFunction): string {
  return preset.kind === 'builtin' ? t(preset.nameKey) : preset.name
}
