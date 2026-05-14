/// <reference lib="webworker" />

import { MitigationCalculator } from '@/utils/mitigationCalculator'
import type { SimulateOutput } from '@/utils/mitigationCalculator'
import type {
  SimulateBundle,
  SimulateRequest,
  SimulateResponse,
  StatusTimelineByPlayer,
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

self.onmessage = (e: MessageEvent<SimulateRequest>) => {
  const { requestId, version, input, extraExcludeIds } = e.data

  if (version !== lastVersion) {
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
    const resp: SimulateResponse = { requestId, ok: true, bundle }
    self.postMessage(resp)
  } catch (err) {
    const error = err as Error
    const resp: SimulateResponse = {
      requestId,
      ok: false,
      error: { message: error.message, stack: error.stack },
    }
    self.postMessage(resp)
  }
}
