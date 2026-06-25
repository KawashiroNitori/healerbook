import { describe, it, expect, vi } from 'vitest'
import { CalculatorWorkerClient, OptimizeCancelledError } from './client'
import type { SimulateRequest, SimulateResponse, OptimizeRequest, OptimizeResponse } from './types'
import type { OptimizeWireInput, OptimizeProgressMessage } from './types'

// Worker Client 是纯逻辑（无 DOM 依赖），保持 node 环境跑得更快。
// 不用 `// @vitest-environment jsdom`（项目其他 DOM 测试的惯用做法）是为了避免引入整套
// 浏览器 globals——本文件只需要 ErrorEvent 这一个构造函数给 FakeWorker.emitError 用。
// 最小 polyfill 仅在缺失时注册；实现代码只读 e.message。
if (typeof globalThis.ErrorEvent === 'undefined') {
  class ErrorEventPolyfill extends Event {
    message: string
    constructor(type: string, init?: { message?: string }) {
      super(type)
      this.message = init?.message ?? ''
    }
  }
  ;(globalThis as unknown as { ErrorEvent: typeof ErrorEventPolyfill }).ErrorEvent =
    ErrorEventPolyfill
}

class FakeWorker implements Partial<Worker> {
  onmessage:
    | ((e: MessageEvent<SimulateResponse | OptimizeResponse | OptimizeProgressMessage>) => void)
    | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  postedMessages: (SimulateRequest | OptimizeRequest)[] = []
  terminated = 0
  postMessage(msg: SimulateRequest | OptimizeRequest) {
    this.postedMessages.push(msg)
  }
  terminate() {
    this.terminated++
  }
  /** 测试辅助：模拟 worker 回包 */
  emit(resp: SimulateResponse | OptimizeResponse | OptimizeProgressMessage) {
    this.onmessage?.(new MessageEvent('message', { data: resp }))
  }
  emitError(message: string) {
    this.onerror?.(new ErrorEvent('error', { message }))
  }
}

function makeClient() {
  const fake = new FakeWorker()
  const client = new CalculatorWorkerClient(() => fake as unknown as Worker)
  return { fake, client }
}

const MINIMAL_INPUT = {
  castEvents: [],
  damageEvents: [],
  initialState: { players: [], statuses: [] },
} as never

const MINIMAL_OPTIMIZE_INPUT: OptimizeWireInput = {
  damageEvents: [],
  lockedCastEvents: [],
  composition: { players: [] },
  initialState: { statuses: [], timestamp: 0 },
}

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

const MINIMAL_BUNDLE = {
  main: {
    damageResults: new Map(),
    statusTimelineByPlayer: new Map(),
    castEffectiveEndByCastEventId: new Map(),
    healSnapshots: [],
    hpTimeline: [],
  },
  removalTimelinesByExcludeId: new Map(),
} as never

describe('CalculatorWorkerClient', () => {
  it('lazy spawns worker on first simulate', () => {
    const factory = vi.fn(() => new FakeWorker() as unknown as Worker)
    const client = new CalculatorWorkerClient(factory)
    expect(factory).not.toHaveBeenCalled()
    client.simulate(MINIMAL_INPUT, [])
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('reuses worker across calls', () => {
    const factory = vi.fn(() => new FakeWorker() as unknown as Worker)
    const client = new CalculatorWorkerClient(factory)
    client.simulate(MINIMAL_INPUT, [])
    client.simulate(MINIMAL_INPUT, [])
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('matches response to request by requestId', async () => {
    const { fake, client } = makeClient()
    const p = client.simulate(MINIMAL_INPUT, [])
    const requestId = fake.postedMessages[0].requestId
    fake.emit({ requestId, ok: true, bundle: MINIMAL_BUNDLE })
    await expect(p).resolves.toBe(MINIMAL_BUNDLE)
  })

  it('drops stale response (older requestId after newer one issued)', async () => {
    const { fake, client } = makeClient()
    const p1 = client.simulate(MINIMAL_INPUT, [])
    const id1 = fake.postedMessages[0].requestId
    const p2 = client.simulate(MINIMAL_INPUT, [])
    const id2 = fake.postedMessages[1].requestId
    // 旧请求先回包 → 应被 drop（promise 永不 resolve）
    fake.emit({ requestId: id1, ok: true, bundle: MINIMAL_BUNDLE })
    // 新请求回包 → 应 resolve
    fake.emit({ requestId: id2, ok: true, bundle: MINIMAL_BUNDLE })
    await expect(p2).resolves.toBe(MINIMAL_BUNDLE)
    // p1 应仍未 resolve/reject
    let p1Settled = false
    p1.then(
      () => (p1Settled = true),
      () => (p1Settled = true)
    )
    await new Promise(r => setTimeout(r, 0))
    expect(p1Settled).toBe(false)
  })

  it('cleans up pending Map on stale response (no Map growth)', async () => {
    const { fake, client } = makeClient()
    client.simulate(MINIMAL_INPUT, [])
    const id1 = fake.postedMessages[0].requestId
    client.simulate(MINIMAL_INPUT, [])
    const id2 = fake.postedMessages[1].requestId
    expect(client.pendingCount).toBe(2)
    fake.emit({ requestId: id1, ok: true, bundle: MINIMAL_BUNDLE }) // stale
    expect(client.pendingCount).toBe(1) // stale entry removed
    fake.emit({ requestId: id2, ok: true, bundle: MINIMAL_BUNDLE }) // current
    expect(client.pendingCount).toBe(0)
  })

  it('rejects on error response', async () => {
    const { fake, client } = makeClient()
    const p = client.simulate(MINIMAL_INPUT, [])
    const requestId = fake.postedMessages[0].requestId
    fake.emit({
      requestId,
      ok: false,
      error: { message: 'boom', stack: 'fake-stack' },
    })
    await expect(p).rejects.toThrow('boom')
  })

  it('rejects all pending and recreates worker on crash', async () => {
    const fake1 = new FakeWorker()
    const fake2 = new FakeWorker()
    const factory = vi
      .fn<[], Worker>()
      .mockReturnValueOnce(fake1 as unknown as Worker)
      .mockReturnValueOnce(fake2 as unknown as Worker)
    const client = new CalculatorWorkerClient(factory)
    const p = client.simulate(MINIMAL_INPUT, [])
    fake1.emitError('segfault')
    await expect(p).rejects.toThrow(/segfault/)
    expect(client.pendingCount).toBe(0)
    // 再次 simulate 应重新 spawn
    client.simulate(MINIMAL_INPUT, [])
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it('sends extraExcludeIds in request payload', () => {
    const { fake, client } = makeClient()
    client.simulate(MINIMAL_INPUT, ['a', 'b'])
    expect(fake.postedMessages[0].extraExcludeIds).toEqual(['a', 'b'])
  })

  it('monotonic version per call', () => {
    const { fake, client } = makeClient()
    client.simulate(MINIMAL_INPUT, [])
    client.simulate(MINIMAL_INPUT, [])
    client.simulate(MINIMAL_INPUT, [])
    const versions = fake.postedMessages.map(m => (m as SimulateRequest).version)
    expect(versions).toEqual([1, 2, 3])
  })
})

describe('CalculatorWorkerClient - optimize', () => {
  it('optimize 按 requestId resolve，且不被后续 simulate 抢占（不 silent-drop）', async () => {
    const { fake, client } = makeClient()
    const p = client.optimize(MINIMAL_OPTIMIZE_INPUT)

    // 获取 optimize 请求的 requestId
    const optimizeMsg = fake.postedMessages[0] as OptimizeRequest
    expect(optimizeMsg.kind).toBe('optimize')
    const optimizeRequestId = optimizeMsg.requestId

    // 模拟用户在 optimize 飞行中又触发 simulate（改写 currentRequestId）
    client.simulate(MINIMAL_INPUT, [])

    // worker 回 optimize 响应
    fake.emit({
      requestId: optimizeRequestId,
      kind: 'optimize',
      ok: true,
      output: FAKE_OPTIMIZE_OUTPUT,
    })
    await expect(p).resolves.toEqual(FAKE_OPTIMIZE_OUTPUT)
  })

  it('worker 崩溃时 reject 飞行中的 optimize', async () => {
    const { fake, client } = makeClient()
    const p = client.optimize(MINIMAL_OPTIMIZE_INPUT)
    fake.emitError('segfault')
    await expect(p).rejects.toThrow()
  })

  it('optimize error 响应时 reject promise', async () => {
    const { fake, client } = makeClient()
    const p = client.optimize(MINIMAL_OPTIMIZE_INPUT)
    const optimizeMsg = fake.postedMessages[0] as OptimizeRequest
    fake.emit({
      requestId: optimizeMsg.requestId,
      kind: 'optimize',
      ok: false,
      error: { message: 'optimize failed' },
    })
    await expect(p).rejects.toThrow('optimize failed')
  })

  it('optimize-progress 消息转给 onProgress，不 resolve', async () => {
    const { fake, client } = makeClient()
    const seen: number[] = []
    const p = client.optimize(MINIMAL_OPTIMIZE_INPUT, prog => seen.push(prog.simulateCalls))
    const reqId = (fake.postedMessages[0] as OptimizeRequest).requestId
    const progress: OptimizeProgressMessage = {
      requestId: reqId,
      kind: 'optimize-progress',
      progress: {
        phase: 'minimize',
        round: 1,
        inScopeEventCount: 3,
        candidateCount: 10,
        simulateCalls: 42,
        castsPlaced: 2,
        elapsedMs: 5,
      },
    }
    fake.emit(progress)
    expect(seen).toEqual([42])
    // 进度消息不应 resolve；随后真正结果才 resolve
    fake.emit({ requestId: reqId, kind: 'optimize', ok: true, output: FAKE_OPTIMIZE_OUTPUT })
    await expect(p).resolves.toEqual(FAKE_OPTIMIZE_OUTPUT)
  })

  it('cancelOptimize 用 OptimizeCancelledError reject 并 terminate worker', async () => {
    const { fake, client } = makeClient()
    const p = client.optimize(MINIMAL_OPTIMIZE_INPUT)
    client.cancelOptimize()
    await expect(p).rejects.toBeInstanceOf(OptimizeCancelledError)
    expect(fake.terminated).toBe(1)
  })

  it('optimize lazy spawns worker on first call', () => {
    const factory = vi.fn(() => new FakeWorker() as unknown as Worker)
    const client = new CalculatorWorkerClient(factory)
    expect(factory).not.toHaveBeenCalled()
    client.optimize(MINIMAL_OPTIMIZE_INPUT)
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('optimize reuses same worker as simulate', () => {
    const factory = vi.fn(() => new FakeWorker() as unknown as Worker)
    const client = new CalculatorWorkerClient(factory)
    client.simulate(MINIMAL_INPUT, [])
    client.optimize(MINIMAL_OPTIMIZE_INPUT)
    expect(factory).toHaveBeenCalledTimes(1)
  })
})
