/**
 * Schema 漂移保护测试
 *
 * 当 Timeline 接口新增字段时：
 *   1. FULL_TIMELINE 的类型注解会让 TypeScript 编译失败（因为不再满足 Required<...>）
 *   2. 开发者必须在 fixture 里补上新字段
 *   3. 再决定该字段是"持久"还是"临时"：
 *      - 持久 → 把字段加到 timelineSchema.ts 的 TimelineSchema 中
 *      - 临时 → 把字段 key 加入本文件的 EPHEMERAL_KEYS
 *   4. 任何一项没做，测试都会失败
 */

import { describe, it, expect } from 'vitest'
import type { Timeline } from '@/types/timeline'
import { validateCreateRequest } from './timelineSchema'

/** 这些字段是客户端临时/派生状态，故意不参与服务端持久化 */
const EPHEMERAL_KEYS: Array<keyof Timeline> = [
  'id', // 服务端另行分配
  'statusEvents', // 编辑模式运行时派生
  'statData', // 客户端计算结果
  'isShared', // 客户端状态
  'everPublished', // 客户端状态
  'hasLocalChanges', // 客户端状态
  'serverVersion', // 服务端下发
]

/**
 * 穷举 Timeline 的所有字段。
 * 使用 `Required<Omit<Timeline, 所有可选字段>> & Pick<Timeline, 所有可选字段>` 的模式
 * 强制 fixture 包含接口里的每一个属性——无论是必填还是可选。
 * 当 Timeline 新增字段时，TypeScript 会报错要求补齐。
 */
const FULL_TIMELINE: Required<
  Omit<
    Timeline,
    | 'description'
    | 'fflogsSource'
    | 'isReplayMode'
    | 'statData'
    | 'gameZoneId'
    | 'syncEvents'
    | 'isShared'
    | 'everPublished'
    | 'hasLocalChanges'
    | 'serverVersion'
  >
> &
  Pick<
    Timeline,
    | 'description'
    | 'fflogsSource'
    | 'isReplayMode'
    | 'statData'
    | 'gameZoneId'
    | 'syncEvents'
    | 'isShared'
    | 'everPublished'
    | 'hasLocalChanges'
    | 'serverVersion'
  > = {
  id: 'local-1',
  name: '测试',
  description: 'desc',
  fflogsSource: { reportCode: 'abc', fightId: 1 },
  gameZoneId: 1321,
  syncEvents: [
    {
      time: 24.3,
      type: 'begincast',
      actionId: 0xa3da,
      actionName: '空间斩',
      window: [10, 10],
      syncOnce: false,
    },
  ],
  encounter: { id: 101, name: 'M9S', displayName: 'M9S', zone: '', damageEvents: [] },
  composition: { players: [{ id: 1, job: 'WHM' }] },
  damageEvents: [],
  castEvents: [],
  statusEvents: [],
  annotations: [],
  statData: undefined,
  isReplayMode: false,
  isShared: true,
  everPublished: true,
  hasLocalChanges: false,
  serverVersion: 1,
  createdAt: 0,
  updatedAt: 0,
}

describe('timelineSchema 漂移保护', () => {
  it('schema 保留所有非临时的 Timeline 字段', () => {
    const result = validateCreateRequest({ timeline: FULL_TIMELINE })
    expect(result.success).toBe(true)
    if (!result.success) return
    const output = result.output.timeline as Record<string, unknown>

    const allKeys = Object.keys(FULL_TIMELINE) as Array<keyof Timeline>
    const persistentKeys = allKeys.filter(k => !EPHEMERAL_KEYS.includes(k))

    const missing = persistentKeys.filter(k => !(k in output))
    expect(missing).toEqual([])
  })

  it('schema 剥离所有临时字段', () => {
    const result = validateCreateRequest({ timeline: FULL_TIMELINE })
    if (!result.success) throw new Error('schema rejected full fixture')
    const output = result.output.timeline as Record<string, unknown>

    const leaked = EPHEMERAL_KEYS.filter(k => k in output)
    expect(leaked).toEqual([])
  })

  it('gameZoneId 在 roundtrip 后等值保留', () => {
    const result = validateCreateRequest({ timeline: FULL_TIMELINE })
    if (!result.success) throw new Error('schema rejected full fixture')
    expect((result.output.timeline as { gameZoneId?: number }).gameZoneId).toBe(1321)
  })

  it('syncEvents 在 roundtrip 后等值保留', () => {
    const result = validateCreateRequest({ timeline: FULL_TIMELINE })
    if (!result.success) throw new Error('schema rejected full fixture')
    const output = result.output.timeline as { syncEvents?: Array<Record<string, unknown>> }
    expect(output.syncEvents).toHaveLength(1)
    expect(output.syncEvents?.[0]).toEqual({
      time: 24.3,
      type: 'begincast',
      actionId: 0xa3da,
      actionName: '空间斩',
      window: [10, 10],
      syncOnce: false,
    })
  })
})
