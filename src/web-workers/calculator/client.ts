import { nanoid } from 'nanoid'
import type { SimulateInput } from '@/utils/mitigationCalculator'
import type { SimulateBundle, SimulateRequest, SimulateResponse } from './types'

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

  private onMessage = (e: MessageEvent<SimulateResponse>) => {
    // Spec: 过期响应（requestId 不是最新一次 simulate）silent drop——不 resolve / 不 reject，
    // 调用方 hook 用 cancelled flag 防御 stale state。pending 里的 stale entry 不立即清理，
    // 留待 onError 崩溃路径或自然 GC（调用方释放 Promise 时整条链一起回收）。
    if (e.data.requestId !== this.currentRequestId) return
    const entry = this.pending.get(e.data.requestId)
    if (!entry) return
    this.pending.delete(e.data.requestId)
    if (e.data.ok) {
      entry.resolve(e.data.bundle)
    } else {
      entry.reject(new Error(e.data.error.message))
    }
  }

  private onError = (e: ErrorEvent) => {
    // Worker 进程崩溃：reject 所有 pending，关闭并丢弃，下次 simulate 重新 spawn
    for (const entry of this.pending.values()) {
      entry.reject(new Error(`calculator worker crashed: ${e.message}`))
    }
    this.pending.clear()
    this.currentRequestId = null
    this.worker?.terminate()
    this.worker = null
  }
}
