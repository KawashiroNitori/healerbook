// @vitest-environment jsdom
/**
 * worker 的 optimize 分支：技能池按 (level) 注入 —— `resolveActions(toLevel(input.level))`。
 *
 * 这条是 worker 内联逻辑（`self.onmessage` 顶层副作用赋值），不像 `client.ts` 那样导出成
 * 可单独调用的纯函数。用 jsdom 环境让 `self` 等价于 window，导入模块触发赋值后手动派发
 * MessageEvent 驱动它；mock `runOptimize` 只捕获传入的 `actions` Map，不跑真实优化器。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { OptimizeRequest } from './types'

const FAKE_OPTIMIZE_OUTPUT = {
  addedCastEvents: [],
  infeasibleEvents: [],
  summary: {
    totalDamageBefore: 0,
    totalDamageAfter: 0,
    castsAdded: 0,
    elapsedMs: 0,
    inScopeEventCount: 0,
    candidateCount: 0,
    simulateCalls: 0,
    rounds: 0,
  },
}

const runOptimizeMock = vi.fn(() => FAKE_OPTIMIZE_OUTPUT)

vi.mock('@/utils/autoMitigation', () => ({
  runOptimize: (...args: unknown[]) => runOptimizeMock(...args),
}))

const MEDICATED_ACTION_ID = 37010 // 医养，minLevel 96

describe('calculator worker optimize 技能池按等级注入', () => {
  beforeEach(() => {
    runOptimizeMock.mockClear()
    // jsdom 的 self.postMessage 是 window.postMessage（要求 2 个参数），
    // 与真实 Worker 的 postMessage(message) 签名不同；stub 成 no-op 避免测试因此报错，
    // 我们只关心传给 runOptimize 的 actions，不关心 postMessage 出去的响应内容。
    vi.spyOn(self, 'postMessage').mockImplementation(() => {})
  })

  const baseInput = {
    damageEvents: [],
    lockedCastEvents: [],
    composition: { players: [] },
    initialState: { statuses: [], timestamp: 0 },
  }

  it('level=90 时注入的 actions 不含医养（37010，minLevel 96）', async () => {
    await import('./index')

    const req: OptimizeRequest = {
      requestId: 'r-90',
      kind: 'optimize',
      input: { ...baseInput, level: 90 },
    }
    self.onmessage!(new MessageEvent('message', { data: req }))

    expect(runOptimizeMock).toHaveBeenCalledTimes(1)
    const actions = (runOptimizeMock.mock.calls[0][0] as { actions: Map<number, unknown> }).actions
    expect(actions.has(MEDICATED_ACTION_ID)).toBe(false)
  })

  it('level 省略时回退 100 级，注入的 actions 含医养（37010）', async () => {
    await import('./index')

    const req: OptimizeRequest = {
      requestId: 'r-default',
      kind: 'optimize',
      input: baseInput,
    }
    self.onmessage!(new MessageEvent('message', { data: req }))

    expect(runOptimizeMock).toHaveBeenCalledTimes(1)
    const actions = (runOptimizeMock.mock.calls[0][0] as { actions: Map<number, unknown> }).actions
    expect(actions.has(MEDICATED_ACTION_ID)).toBe(true)
  })
})
