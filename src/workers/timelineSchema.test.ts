/**
 * V2 Timeline Schema 校验测试
 */

import { describe, it, expect } from 'vitest'
import { validateCreateRequest } from './timelineSchema'

/** 最小合法 V2 payload */
const MINIMAL_V2 = {
  v: 2 as const,
  n: '最小时间轴',
  e: 101,
  c: [],
  de: [],
  ce: { a: [], t: [], p: [] },
  ca: 1000,
  ua: 1000,
}

describe('timelineSchema V2', () => {
  it('合法 V2 payload 通过校验且 roundtrip 等值', () => {
    const result = validateCreateRequest({ timeline: MINIMAL_V2 })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.output.timeline).toEqual(MINIMAL_V2)
  })

  it('缺少 v 字段 → 校验失败', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { v: _, ...noVersion } = MINIMAL_V2
    const result = validateCreateRequest({ timeline: noVersion })
    expect(result.success).toBe(false)
  })

  it('v !== 2 → 校验失败', () => {
    const result = validateCreateRequest({ timeline: { ...MINIMAL_V2, v: 1 } })
    expect(result.success).toBe(false)
  })

  it('name 超过最大长度 → 校验失败', () => {
    const result = validateCreateRequest({
      timeline: { ...MINIMAL_V2, n: 'x'.repeat(51) },
    })
    expect(result.success).toBe(false)
  })

  it('gameZoneId 在 roundtrip 后等值保留', () => {
    const result = validateCreateRequest({
      timeline: { ...MINIMAL_V2, gz: 1321 },
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect((result.output.timeline as { gz?: number }).gz).toBe(1321)
  })

  it('无效 job code → 校验失败', () => {
    const result = validateCreateRequest({
      timeline: { ...MINIMAL_V2, c: ['INVALID_JOB'] },
    })
    expect(result.success).toBe(false)
  })

  it('合法 job code 和空字符串混合 → 通过', () => {
    const result = validateCreateRequest({
      timeline: { ...MINIMAL_V2, c: ['WHM', '', 'SCH', ''] },
    })
    expect(result.success).toBe(true)
  })

  it('DE 包含完整字段和可选 pdd → 通过', () => {
    const fullDE = {
      ...MINIMAL_V2,
      de: [
        {
          n: '天辉',
          t: 10.5,
          d: 120000,
          ty: 0,
          dt: 1,
          st: 8.2,
          pdd: [
            {
              ts: 10500,
              p: 1,
              u: 120000,
              f: 85000,
              o: 5000,
              m: 1.2,
              hp: 90000,
              mhp: 100000,
              ss: [{ s: 1001, ab: 30000 }],
            },
          ],
        },
      ],
    }
    const result = validateCreateRequest({ timeline: fullDE })
    expect(result.success).toBe(true)
  })

  it('CE 各数组长度不同仍通过（schema 不校验等长）', () => {
    const result = validateCreateRequest({
      timeline: {
        ...MINIMAL_V2,
        ce: { a: [1, 2], t: [100], p: [1, 2, 3] },
      },
    })
    expect(result.success).toBe(true)
  })

  it('annotation anchor 为 0（damageTrack）→ 通过', () => {
    const result = validateCreateRequest({
      timeline: {
        ...MINIMAL_V2,
        an: [{ x: '注意', t: 5.0, k: 0 }],
      },
    })
    expect(result.success).toBe(true)
  })

  it('annotation anchor 为 [playerId, actionId]（skillTrack）→ 通过', () => {
    const result = validateCreateRequest({
      timeline: {
        ...MINIMAL_V2,
        an: [{ x: '注意', t: 5.0, k: [1, 7432] }],
      },
    })
    expect(result.success).toBe(true)
  })

  it('syncEvents roundtrip 保留', () => {
    const se = [
      {
        t: 24.3,
        ty: 0 as const,
        a: 0xa3da,
        nm: '空间斩',
        w: [10, 10] as [number, number],
        so: 1 as const,
      },
    ]
    const result = validateCreateRequest({
      timeline: { ...MINIMAL_V2, se },
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect((result.output.timeline as { se?: unknown[] }).se).toEqual(se)
  })

  it('description 可选且保留', () => {
    const result = validateCreateRequest({
      timeline: { ...MINIMAL_V2, desc: '一段描述' },
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect((result.output.timeline as { desc?: string }).desc).toBe('一段描述')
  })

  it('fflogsSource 可选且保留', () => {
    const result = validateCreateRequest({
      timeline: { ...MINIMAL_V2, fs: { rc: 'abc123', fi: 5 } },
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect((result.output.timeline as { fs?: { rc: string; fi: number } }).fs).toEqual({
      rc: 'abc123',
      fi: 5,
    })
  })

  it('isReplayMode (r) 可选，接受 1', () => {
    const result = validateCreateRequest({
      timeline: { ...MINIMAL_V2, r: 1 },
    })
    expect(result.success).toBe(true)
  })

  it('isReplayMode (r) 拒绝非 1 的值', () => {
    const result = validateCreateRequest({
      timeline: { ...MINIMAL_V2, r: true },
    })
    expect(result.success).toBe(false)
  })

  it('statData (sd) 可选且保留', () => {
    const sd = {
      referenceMaxHP: 80000,
      shieldByAbility: { '1001': 5000 },
      critShieldByAbility: {},
      healByAbility: { '2001': 12000 },
      critHealByAbility: {},
    }
    const result = validateCreateRequest({
      timeline: { ...MINIMAL_V2, sd },
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect((result.output.timeline as { sd?: unknown }).sd).toEqual(sd)
  })

  it('statData (sd) 字段类型错误 → 校验失败', () => {
    const result = validateCreateRequest({
      timeline: { ...MINIMAL_V2, sd: { shieldByAbility: 'invalid' } },
    })
    expect(result.success).toBe(false)
  })
})
