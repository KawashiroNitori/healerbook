/// <reference types="@cloudflare/workers-types" />
import { DurableObject } from 'cloudflare:workers'
import type { Env } from '../env'

/** 占位骨架 —— Task A5 扩充为完整的 WebSocket 同步房间。 */
export class TimelineDoc extends DurableObject<Env> {}
