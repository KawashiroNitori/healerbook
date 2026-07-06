import type { AppEnv } from '../env'
import type { TimelineDoc } from './TimelineDoc'

/**
 * 取该 timeline 的 DO stub。
 * DurableObjectNamespace binding 在 env.ts 中无具体类型，故 cast 为 TimelineDoc
 * 以调用其 RPC 方法（getSnapshotJson）及 fetch。
 */
export function docStub(env: AppEnv['Bindings'], id: string): TimelineDoc {
  return env.TIMELINE_DOC.get(env.TIMELINE_DOC.idFromName(id)) as unknown as TimelineDoc
}
