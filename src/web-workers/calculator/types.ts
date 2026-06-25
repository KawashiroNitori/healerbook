/**
 * Calculator Worker 通信协议
 */

import type { SimulateInput, SimulateOutput } from '@/utils/mitigationCalculator'
import type { StatusInterval } from '@/types/status'
import type { OptimizeInput, OptimizeOutput, OptimizeProgress } from '@/utils/autoMitigation'

export type StatusTimelineByPlayer = Map<number, Map<number, StatusInterval[]>>

export interface SimulateRequest {
  requestId: string
  kind?: 'simulate'
  /** 主线程单调递增，用于 worker 决定缓存失效。 */
  version: number
  input: SimulateInput
  /** 额外按 excludeId 派生的 timeline 集合（去重）。 */
  extraExcludeIds: string[]
}

export interface SimulateBundle {
  /** 完整主路径 simulate 输出（含 hpTimeline、healSnapshots 等） */
  main: SimulateOutput
  /** 每个 excludeId 对应的 statusTimelineByPlayer */
  removalTimelinesByExcludeId: Map<string, StatusTimelineByPlayer>
}

export type SimulateResponse =
  | { requestId: string; kind?: 'simulate'; ok: true; bundle: SimulateBundle }
  | { requestId: string; kind?: 'simulate'; ok: false; error: { message: string; stack?: string } }

/** actions 含 executor 等函数，不可 structured-clone，故 worker 消息剔除它，worker 内自建。 */
export type OptimizeWireInput = Omit<OptimizeInput, 'actions'>

export interface OptimizeRequest {
  requestId: string
  kind: 'optimize'
  input: OptimizeWireInput
}

export type OptimizeResponse =
  | { requestId: string; kind: 'optimize'; ok: true; output: OptimizeOutput }
  | { requestId: string; kind: 'optimize'; ok: false; error: { message: string; stack?: string } }

/** 优化过程中的实时进度（worker 流式回传，不 resolve promise）。 */
export interface OptimizeProgressMessage {
  requestId: string
  kind: 'optimize-progress'
  progress: OptimizeProgress
}
