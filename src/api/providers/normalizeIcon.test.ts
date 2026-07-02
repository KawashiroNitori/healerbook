import { describe, it, expect } from 'vitest'
import { normalizeIcon } from './normalizeIcon'

describe('normalizeIcon', () => {
  it('数字原样返回', () => expect(normalizeIcon(3253)).toBe(3253))
  it('/i/ 路径', () => expect(normalizeIcon('/i/003000/003253.png')).toBe(3253))
  it('xivapi .tex 路径', () => expect(normalizeIcon('ui/icon/003000/003253.tex')).toBe(3253))
  it('高清 _hr1 后缀不被误当作 iconId', () =>
    expect(normalizeIcon('ui/icon/002000/002645_hr1.tex')).toBe(2645))
  it('FFLogs HHHHHH-FFFFFF.png 取尾段', () => expect(normalizeIcon('003000-003253.png')).toBe(3253))
  it('无数字 → 0', () => expect(normalizeIcon('abc')).toBe(0))
  it('空串 → 0', () => expect(normalizeIcon('')).toBe(0))
  it('非有限数 → 0', () => expect(normalizeIcon(NaN)).toBe(0))
})
