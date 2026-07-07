import { describe, it, expect } from 'vitest'
import { createStatusIntervalRecorder } from './statusIntervalRecorder'
import type { PartyState } from '@/types/partyState'
import type { MitigationStatus } from '@/types/status'

/**
 * recorder 的独立保护层。simulate 的 2926 行黑盒锚继续兜底端到端行为，
 * 这里锁定 recorder 自身的 attach / persist / consume 三态、跨 capture 的 open 维护、
 * 与 finish 落表排序。
 */

/** 最小 status 夹具：只填 recorder 关心的字段。statusId 用未注册 id → statusTier 兜底 'other'。 */
function makeStatus(overrides: Partial<MitigationStatus>): MitigationStatus {
  return {
    instanceId: 'i-default',
    statusId: 900001,
    startTime: 0,
    endTime: 100,
    ...overrides,
  }
}

/** 最小 PartyState 夹具：只有 statuses / timestamp 参与 recorder。 */
function makeState(statuses: MitigationStatus[], timestamp = 0): PartyState {
  return { statuses, timestamp }
}

const EMPTY = makeState([])

describe('statusIntervalRecorder', () => {
  it('attach：新增 instance 只 open，不落区间；仍 open 时 finish 才以 endTime 落表', () => {
    const rec = createStatusIntervalRecorder()
    const s = makeStatus({ instanceId: 'a', statusId: 111, endTime: 30, sourcePlayerId: 7 })

    rec.captureTransition(EMPTY, makeState([s]), 10, 'cast-1', 7)

    // attach 尚未产生任何已闭区间
    const mid = rec.finish()
    const intervals = mid.statusTimelineByPlayer.get(7)?.get(111)
    expect(intervals).toHaveLength(1)
    // 仍 open 到 finish → 以 endTime(30) 落表，from = attach 时刻(10)
    expect(intervals![0]).toMatchObject({ from: 10, to: 30, sourceCastEventId: 'cast-1' })
  })

  it('persist：instance 跨 capture 保留 → 只刷新 endTime，不落多段区间', () => {
    const rec = createStatusIntervalRecorder()
    const s1 = makeStatus({ instanceId: 'b', statusId: 222, endTime: 30, sourcePlayerId: 3 })
    const s2 = makeStatus({ instanceId: 'b', statusId: 222, endTime: 45, sourcePlayerId: 3 }) // 延长

    rec.captureTransition(EMPTY, makeState([s1]), 5, 'cast-2', 3)
    rec.captureTransition(makeState([s1]), makeState([s2]), 20) // 同 instanceId → persist

    const out = rec.finish()
    const intervals = out.statusTimelineByPlayer.get(3)?.get(222)
    // persist 不断条：仍是单段，to 用刷新后的 endTime(45)
    expect(intervals).toHaveLength(1)
    expect(intervals![0]).toMatchObject({ from: 5, to: 45 })
  })

  it('consume：instance 消失且 rec.endTime >= at → 以 at 收束（提前引爆）', () => {
    const rec = createStatusIntervalRecorder()
    const s = makeStatus({ instanceId: 'c', statusId: 333, endTime: 100, sourcePlayerId: 1 })

    rec.captureTransition(EMPTY, makeState([s]), 10, 'cast-3', 1)
    // 40s 时 instance 消失，rec.endTime(100) >= at(40) → to = min(40,100) = 40
    rec.captureTransition(makeState([s]), EMPTY, 40)

    const out = rec.finish()
    const intervals = out.statusTimelineByPlayer.get(1)?.get(333)
    expect(intervals).toHaveLength(1)
    expect(intervals![0]).toMatchObject({ from: 10, to: 40 })
  })

  it('自然过期：instance 消失且 rec.endTime < at → 以 endTime 收束', () => {
    const rec = createStatusIntervalRecorder()
    const s = makeStatus({ instanceId: 'd', statusId: 444, endTime: 25, sourcePlayerId: 2 })

    rec.captureTransition(EMPTY, makeState([s]), 10, 'cast-4', 2)
    // advanceToTime 已剔除过期 status；at(50) > endTime(25) → to = min(50,25) = 25
    rec.captureTransition(makeState([s]), EMPTY, 50)

    const out = rec.finish()
    const intervals = out.statusTimelineByPlayer.get(2)?.get(444)
    expect(intervals![0]).toMatchObject({ from: 10, to: 25 })
  })

  it('open 维护：同 statusId 两次 attach/consume → 两段独立区间', () => {
    const rec = createStatusIntervalRecorder()
    const first = makeStatus({ instanceId: 'e1', statusId: 555, endTime: 100, sourcePlayerId: 4 })
    const second = makeStatus({ instanceId: 'e2', statusId: 555, endTime: 100, sourcePlayerId: 4 })

    rec.captureTransition(EMPTY, makeState([first]), 10, 'cast-a', 4)
    rec.captureTransition(makeState([first]), EMPTY, 20) // 第一段收束 20
    rec.captureTransition(EMPTY, makeState([second]), 30, 'cast-b', 4)
    rec.captureTransition(makeState([second]), EMPTY, 40) // 第二段收束 40

    const out = rec.finish()
    const intervals = out.statusTimelineByPlayer.get(4)?.get(555)
    expect(intervals).toHaveLength(2)
    expect(intervals!.map(i => [i.from, i.to])).toEqual([
      [10, 20],
      [30, 40],
    ])
  })

  it('finish 落表排序：乱序 attach 的区间按 from 升序', () => {
    const rec = createStatusIntervalRecorder()
    const late = makeStatus({ instanceId: 'f1', statusId: 666, endTime: 100, sourcePlayerId: 5 })
    const early = makeStatus({ instanceId: 'f2', statusId: 666, endTime: 100, sourcePlayerId: 5 })

    // 先 attach 晚区间(from=50) 并收束，再 attach 早区间(from=10) 并收束 → 落表顺序乱
    rec.captureTransition(EMPTY, makeState([late]), 50, 'cast-late', 5)
    rec.captureTransition(makeState([late]), EMPTY, 60)
    rec.captureTransition(EMPTY, makeState([early]), 10, 'cast-early', 5)
    rec.captureTransition(makeState([early]), EMPTY, 20)

    const out = rec.finish()
    const intervals = out.statusTimelineByPlayer.get(5)?.get(666)
    expect(intervals!.map(i => i.from)).toEqual([10, 50])
  })

  it('castEndEntries：seeded buff（sourceCastEventId 为空）跳过，带 castId 的产出条目', () => {
    const rec = createStatusIntervalRecorder()
    const seeded = makeStatus({ instanceId: 'g1', statusId: 777, endTime: 30, sourcePlayerId: 6 })
    const fromCast = makeStatus({ instanceId: 'g2', statusId: 888, endTime: 40, sourcePlayerId: 6 })

    // seeded：不带 castEventIdHint → sourceCastEventId = ''
    rec.captureTransition(EMPTY, makeState([seeded]), 0)
    // cast 触发：带 hint
    rec.captureTransition(makeState([seeded]), makeState([seeded, fromCast]), 5, 'cast-x', 6)
    rec.captureTransition(makeState([seeded, fromCast]), makeState([seeded]), 15) // fromCast 收束

    const out = rec.finish()
    // seeded 区间落表但不进 castEndEntries；fromCast 进 castEndEntries
    expect(out.castEndEntries).toEqual([{ castId: 'cast-x', to: 15, tier: 'other' }])
  })

  it('tier：带 barrier 的 status → primary 层进 castEndEntries', () => {
    const rec = createStatusIntervalRecorder()
    const shield = makeStatus({
      instanceId: 'h',
      statusId: 999,
      endTime: 40,
      sourcePlayerId: 8,
      remainingBarrier: 5000,
    })

    rec.captureTransition(EMPTY, makeState([shield]), 10, 'cast-shield', 8)
    rec.captureTransition(makeState([shield]), EMPTY, 20)

    const out = rec.finish()
    expect(out.castEndEntries).toEqual([{ castId: 'cast-shield', to: 20, tier: 'primary' }])
  })

  it('targetPlayerId 回退：status 无 sourcePlayerId → 用 castPlayerIdHint', () => {
    const rec = createStatusIntervalRecorder()
    const s = makeStatus({
      instanceId: 'k',
      statusId: 1234,
      endTime: 30,
      sourcePlayerId: undefined,
    })

    rec.captureTransition(EMPTY, makeState([s]), 10, 'cast-k', 99)

    const out = rec.finish()
    // sourcePlayerId 缺省 → target = castPlayerIdHint(99)
    expect(out.statusTimelineByPlayer.get(99)?.get(1234)).toHaveLength(1)
  })
})
