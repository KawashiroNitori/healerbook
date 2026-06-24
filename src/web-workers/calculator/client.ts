import { nanoid } from 'nanoid'
import type { SimulateInput } from '@/utils/mitigationCalculator'
import type { OptimizeOutput } from '@/utils/autoMitigation'
import type {
  SimulateBundle,
  SimulateRequest,
  SimulateResponse,
  OptimizeWireInput,
  OptimizeRequest,
  OptimizeResponse,
} from './types'

type Pending = {
  resolve: (bundle: SimulateBundle) => void
  reject: (err: Error) => void
}

/**
 * Worker 工厂——单独抽出来便于测试时注入 fake。
 * 默认生产路径用 vite `?worker` import。
 */
export type WorkerFactory = () => Worker

export class CalculatorWorkerClient {
  private worker: Worker | null = null
  private versionCounter = 0
  private pending = new Map<string, Pending>()
  private currentRequestId: string | null = null
  private workerFactory: WorkerFactory
  private pendingOptimize = new Map<
    string,
    { resolve: (o: OptimizeOutput) => void; reject: (e: Error) => void }
  >()

  constructor(workerFactory: WorkerFactory) {
    this.workerFactory = workerFactory
  }

  /**
   * 发起一次 simulate；返回 Promise，过期请求 silent drop（promise 永不 resolve）。
   * 调用方应自管 cancelled flag 防御 stale resolve。
   */
  simulate(input: SimulateInput, extraExcludeIds: string[]): Promise<SimulateBundle> {
    this.ensureWorker()
    const requestId = nanoid()
    const version = ++this.versionCounter
    this.currentRequestId = requestId
    const promise = new Promise<SimulateBundle>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject })
    })
    const req: SimulateRequest = { requestId, version, input, extraExcludeIds }
    this.worker!.postMessage(req)
    return promise
  }

  optimize(input: OptimizeWireInput): Promise<OptimizeOutput> {
    this.ensureWorker()
    const requestId = nanoid()
    return new Promise<OptimizeOutput>((resolve, reject) => {
      this.pendingOptimize.set(requestId, { resolve, reject })
      this.worker!.postMessage({ requestId, kind: 'optimize', input } satisfies OptimizeRequest)
    })
  }

  /** 测试用：观察 internal state。 */
  get pendingCount(): number {
    return this.pending.size
  }

  private ensureWorker() {
    if (this.worker) return
    this.worker = this.workerFactory()
    this.worker.onmessage = this.onMessage
    this.worker.onerror = this.onError
  }

  private onMessage = (e: MessageEvent<SimulateResponse | OptimizeResponse>) => {
    const data = e.data as SimulateResponse | OptimizeResponse

    // optimize 响应先于 currentRequestId 检查处理，绕开 simulate silent-drop
    if ((data as OptimizeResponse).kind === 'optimize') {
      const resp = data as OptimizeResponse
      const p = this.pendingOptimize.get(resp.requestId)
      if (!p) return
      this.pendingOptimize.delete(resp.requestId)
      if (resp.ok) p.resolve(resp.output)
      else p.reject(new Error(resp.error.message))
      return
    }

    // —— 既有 simulate 分支（currentRequestId silent-drop 原样）——
    // Spec: 过期响应（requestId 不是最新一次 simulate）silent drop——不 resolve / 不 reject，
    // 调用方 hook 用 cancelled flag 防御 stale state。
    // 但需要清理 pending Map 里的 stale entry——module-level singleton 长期运行下，
    // 不清理会让旧 entry 永久累积（Map 强引用 + Promise resolver 持有）。
    if (data.requestId !== this.currentRequestId) {
      this.pending.delete(data.requestId)
      return
    }
    const entry = this.pending.get(data.requestId)
    if (!entry) return
    this.pending.delete(data.requestId)
    const simResp = data as SimulateResponse
    if (simResp.ok) {
      entry.resolve((simResp as Extract<SimulateResponse, { ok: true }>).bundle)
    } else {
      entry.reject(new Error((simResp as Extract<SimulateResponse, { ok: false }>).error.message))
    }
  }

  private onError = (e: ErrorEvent) => {
    // Worker 进程崩溃：reject 所有 pending，关闭并丢弃，下次 simulate 重新 spawn
    for (const entry of this.pending.values()) {
      entry.reject(new Error(`calculator worker crashed: ${e.message}`))
    }
    this.pending.clear()
    for (const { reject } of this.pendingOptimize.values()) {
      reject(new Error('worker crashed'))
    }
    this.pendingOptimize.clear()
    this.currentRequestId = null
    this.worker?.terminate()
    this.worker = null
  }
}
