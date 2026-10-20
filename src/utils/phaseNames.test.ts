import { describe, it, expect } from 'vitest'
import type { AppLanguage } from '@/types/i18n'
import { rawPhasesToTimelinePhases, translatePhaseName, type EncounterTable } from './phaseNames'

// 占位译名：测试只验证查表机制，不使用真实游戏译名
const tables: Record<AppLanguage, EncounterTable> = {
  'zh-CN': { phase: { e1085: { p3: '占位-中文', p4: '' } } },
  'zh-TW': {},
  ja: { phase: { e1085: { p3: '   ' } } },
  en: {},
  de: {},
  fr: {},
}

describe('translatePhaseName', () => {
  it('命中时返回译名', () => {
    expect(translatePhaseName(1085, 3, 'P3: Raw', 'zh-CN', tables)).toBe('占位-中文')
  })

  it('查不到 key 时保留原文', () => {
    expect(translatePhaseName(1085, 9, 'P9: Raw', 'zh-CN', tables)).toBe('P9: Raw')
    expect(translatePhaseName(9999, 3, 'P3: Raw', 'zh-CN', tables)).toBe('P3: Raw')
  })

  it('空串或纯空白时保留原文', () => {
    expect(translatePhaseName(1085, 4, 'P4: Raw', 'zh-CN', tables)).toBe('P4: Raw')
    expect(translatePhaseName(1085, 3, 'P3: Raw', 'ja', tables)).toBe('P3: Raw')
  })

  it('当前语言缺失时不回退到 zh-CN', () => {
    expect(translatePhaseName(1085, 3, 'P3: Raw', 'en', tables)).toBe('P3: Raw')
  })

  it('默认表（当前全空）返回原文', () => {
    expect(translatePhaseName(1085, 3, 'P3: Raw', 'zh-CN')).toBe('P3: Raw')
  })
})

describe('rawPhasesToTimelinePhases', () => {
  it('逐个翻译、生成 id、保持顺序与时间', () => {
    let n = 0
    const out = rawPhasesToTimelinePhases(
      [
        { fflogsPhaseId: 3, name: 'P3: Raw', time: 10 },
        { fflogsPhaseId: 5, name: 'P5: Raw', time: 20 },
      ],
      1085,
      'zh-CN',
      () => `id${++n}`,
      tables
    )
    expect(out).toEqual([
      { id: 'id1', name: '占位-中文', time: 10 },
      { id: 'id2', name: 'P5: Raw', time: 20 },
    ])
  })
})
