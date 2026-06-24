/// <reference lib="webworker" />

import { MitigationCalculator } from '@/utils/mitigationCalculator'
import type { SimulateOutput } from '@/utils/mitigationCalculator'
import { runOptimize } from '@/utils/autoMitigation'
import { MITIGATION_DATA } from '@/data/mitigationActions'
import type {
  SimulateBundle,
  SimulateRequest,
  SimulateResponse,
  StatusTimelineByPlayer,
  OptimizeRequest,
} from './types'

/**
 * 按 (version, excludeId) 缓存 simulate 输出。
 * 版本号由主线程单调递增——任意 input 变化都视为新 version，
 * worker 收到比 lastVersion 大的请求时清空缓存。
 * 同一 version 内 extraExcludeIds 切换命中缓存（主路径只跑一次）。
 */
let lastVersion = -1
const cache: {
  main: SimulateOutput | null
  byExcludeId: Map<string, SimulateOutput>
} = {
  main: null,
  byExcludeId: new Map(),
}

self.onmessage = (e: MessageEvent<SimulateRequest | OptimizeRequest>) => {
  if ((e.data as OptimizeRequest).kind === 'optimize') {
    const { requestId, input } = e.data as OptimizeRequest
    try {
      const actions = new Map(MITIGATION_DATA.actions.map(a => [a.id, a]))
      const output = runOptimize({ ...input, actions })
      self.postMessage({ requestId, kind: 'optimize', ok: true, output })
    } catch (err) {
      self.postMessage({
        requestId,
        kind: 'optimize',
        ok: false,
        error: {
          message: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        },
      })
    }
    return
  }

  // —— 既有 simulate 路径 ——
  const { requestId, version, input, extraExcludeIds } = e.data as SimulateRequest

  if (version > lastVersion) {
    cache.main = null
    cache.byExcludeId.clear()
    lastVersion = version
  }

  try {
    const calculator = new MitigationCalculator()

    if (!cache.main) {
      cache.main = calculator.simulate(input)
    }

    const removalTimelinesByExcludeId: Map<string, StatusTimelineByPlayer> = new Map()
    for (const id of extraExcludeIds) {
      let out = cache.byExcludeId.get(id)
      if (!out) {
        out = calculator.simulate({
          ...input,
          castEvents: input.castEvents.filter(ev => ev.id !== id),
          skipHpPipeline: true,
        })
        cache.byExcludeId.set(id, out)
      }
      removalTimelinesByExcludeId.set(id, out.statusTimelineByPlayer)
    }

    const bundle: SimulateBundle = {
      main: cache.main,
      removalTimelinesByExcludeId,
    }
    const resp: SimulateResponse = { requestId, kind: 'simulate', ok: true, bundle }
    self.postMessage(resp)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    const resp: SimulateResponse = {
      requestId,
      kind: 'simulate',
      ok: false,
      error: { message, stack },
    }
    self.postMessage(resp)
  }
}
