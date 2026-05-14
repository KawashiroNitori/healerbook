import { describe, it, expect, vi } from 'vitest'
import { CalculatorWorkerClient } from './client'
import type { SimulateRequest, SimulateResponse } from './types'

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
  onmessage: ((e: MessageEvent<SimulateResponse>) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  postedMessages: SimulateRequest[] = []
  postMessage(msg: SimulateRequest) {
    this.postedMessages.push(msg)
  }
  terminate() {}
  /** 测试辅助：模拟 worker 回包 */
  emit(resp: SimulateResponse) {
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
    const versions = fake.postedMessages.map(m => m.version)
    expect(versions).toEqual([1, 2, 3])
  })
})
