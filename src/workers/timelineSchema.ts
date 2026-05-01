/**
 * 时间轴数据校验 schema（Valibot）— V2 短键格式
 *
 * 用于 POST/PUT 接口，校验并剥离不在正常时间轴中出现的字段和不正确的类型。
 */

import * as v from 'valibot'
import { JOB_METADATA } from '@/data/jobs'
import {
  TIMELINE_NAME_MAX_LENGTH,
  TIMELINE_DESCRIPTION_MAX_LENGTH,
  DAMAGE_EVENT_NAME_MAX_LENGTH,
  ANNOTATION_TEXT_MAX_LENGTH,
} from '@/constants/limits'

const JobOrEmptySchema = v.union([
  v.picklist(Object.keys(JOB_METADATA) as [string, ...string[]]),
  v.literal(''),
])

const V2StatusSnapshotSchema = v.object({
  s: v.number(),
  ab: v.optional(v.number()),
})

const V2PlayerDamageDetailSchema = v.object({
  ts: v.number(),
  p: v.number(),
  u: v.number(),
  f: v.number(),
  o: v.optional(v.number()),
  m: v.optional(v.number()),
  hp: v.optional(v.number()),
  mhp: v.optional(v.number()),
  ss: v.array(V2StatusSnapshotSchema),
})

const V2DamageEventSchema = v.object({
  n: v.pipe(v.string(), v.maxLength(DAMAGE_EVENT_NAME_MAX_LENGTH)),
  t: v.number(),
  d: v.number(),
  ty: v.union([v.literal(0), v.literal(1), v.literal(2), v.literal(3), v.literal(4)]),
  dt: v.union([v.literal(0), v.literal(1), v.literal(2)]),
  st: v.optional(v.number()),
  pdd: v.optional(v.array(V2PlayerDamageDetailSchema)),
})

const V2CastEventsSchema = v.object({
  a: v.array(v.number()),
  t: v.array(v.number()),
  p: v.array(v.number()),
})

const V2AnnotationSchema = v.object({
  x: v.pipe(v.string(), v.maxLength(ANNOTATION_TEXT_MAX_LENGTH)),
  t: v.number(),
  k: v.union([v.literal(0), v.tuple([v.number(), v.number()])]),
})

const V2SyncEventSchema = v.object({
  t: v.number(),
  ty: v.union([v.literal(0), v.literal(1)]),
  a: v.number(),
  nm: v.optional(v.string()),
  w: v.tuple([v.number(), v.number()]),
  so: v.optional(v.literal(1)),
})

const V2FFLogsSourceSchema = v.object({
  rc: v.string(),
  fi: v.number(),
})

const NumberRecordSchema = v.record(v.string(), v.number())

const V2StatDataSchema = v.object({
  referenceMaxHP: v.optional(v.number()),
  tankReferenceMaxHP: v.optional(v.number()),
  shieldByAbility: NumberRecordSchema,
  critShieldByAbility: NumberRecordSchema,
  healByAbility: NumberRecordSchema,
  critHealByAbility: NumberRecordSchema,
})

/**
 * V2 时间轴数据 schema
 */
export const V2TimelineSchema = v.object({
  v: v.literal(2),
  n: v.pipe(v.string(), v.maxLength(TIMELINE_NAME_MAX_LENGTH)),
  desc: v.optional(v.pipe(v.string(), v.maxLength(TIMELINE_DESCRIPTION_MAX_LENGTH))),
  fs: v.optional(V2FFLogsSourceSchema),
  gz: v.optional(v.number()),
  e: v.number(),
  c: v.array(JobOrEmptySchema),
  de: v.array(V2DamageEventSchema),
  ce: V2CastEventsSchema,
  an: v.optional(v.array(V2AnnotationSchema)),
  se: v.optional(v.array(V2SyncEventSchema)),
  sd: v.optional(V2StatDataSchema),
  r: v.optional(v.literal(1)),
  ca: v.number(),
  ua: v.number(),
})

/**
 * POST /api/timelines 请求体 schema
 */
export const CreateTimelineRequestSchema = v.object({
  timeline: V2TimelineSchema,
})

/**
 * PUT /api/timelines/:id 请求体 schema
 */
export const UpdateTimelineRequestSchema = v.object({
  timeline: V2TimelineSchema,
  expectedVersion: v.optional(v.number()),
})

/**
 * 校验并清洗时间轴数据
 */
export function validateCreateRequest(
  input: unknown
): v.SafeParseResult<typeof CreateTimelineRequestSchema> {
  return v.safeParse(CreateTimelineRequestSchema, input)
}

export function validateUpdateRequest(
  input: unknown
): v.SafeParseResult<typeof UpdateTimelineRequestSchema> {
  return v.safeParse(UpdateTimelineRequestSchema, input)
}
