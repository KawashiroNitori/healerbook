import { describe, it, expect } from 'vitest'
import { CLIPBOARD_MIME, buildClipboardPayload, parseClipboardPayload } from './timelineClipboard'
import type { Timeline } from '@/types/timeline'

const timeline = {
  id: 't1',
  name: 'TL',
  encounter: { id: 1, name: 'E', displayName: 'E', zone: 'Z', damageEvents: [] },
  composition: {
    players: [
      { id: 1, job: 'PLD' },
      { id: 2, job: 'WHM' },
    ],
  },
  damageEvents: [
    { id: 'd1', name: 'AA', time: 10, damage: 1, type: 'aoe', damageType: 'magical' },
    { id: 'd2', name: 'BB', time: 20, damage: 2, type: 'aoe', damageType: 'magical' },
  ],
  castEvents: [{ id: 'c1', actionId: 16536, timestamp: 12, playerId: 2 }],
  annotations: [{ id: 'a1', text: 'n', time: 14, anchor: { type: 'damageTrack' } }],
  statusEvents: [],
  createdAt: 1,
  updatedAt: 1,
} as unknown as Timeline

describe('timelineClipboard 构造/解析', () => {
  it('buildClipboardPayload 仅含选中子集', () => {
    const p = buildClipboardPayload(timeline, {
      eventIds: ['d1'],
      castEventIds: ['c1'],
      annotationIds: ['a1'],
    })
    expect(p.__healerbook__).toBe('timeline-clipboard')
    expect(p.version).toBe(1)
    expect(p.v2.de).toHaveLength(1) // 只有 d1
  })

  it('CLIPBOARD_MIME 是 web 自定义格式', () => {
    expect(CLIPBOARD_MIME.startsWith('web ')).toBe(true)
  })

  it('parseClipboardPayload 校验标识', () => {
    const p = buildClipboardPayload(timeline, {
      eventIds: ['d1'],
      castEventIds: [],
      annotationIds: [],
    })
    expect(parseClipboardPayload(JSON.stringify(p))).not.toBeNull()
    expect(parseClipboardPayload('hello world')).toBeNull()
    expect(parseClipboardPayload(JSON.stringify({ foo: 1 }))).toBeNull()
  })
})
