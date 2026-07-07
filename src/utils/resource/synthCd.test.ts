import { describe, it, expect } from 'vitest'
import { SYNTH_CD_PREFIX, synthCdResourceId, isSynthCdResource, synthCdActionId } from './synthCd'

describe('synthCd 协议 helper', () => {
  it('构造与判断', () => {
    expect(synthCdResourceId(7405)).toBe('__cd__:7405')
    expect(isSynthCdResource('__cd__:7405')).toBe(true)
    expect(isSynthCdResource('sch:consolation')).toBe(false)
  })
  it('剥前缀取 actionId，非法输入返回 undefined', () => {
    expect(synthCdActionId('__cd__:7405')).toBe(7405)
    expect(synthCdActionId('sch:consolation')).toBeUndefined()
    expect(synthCdActionId('__cd__:abc')).toBeUndefined()
  })
  it('前缀常量与协议一致', () => {
    expect(SYNTH_CD_PREFIX).toBe('__cd__:')
  })
})
