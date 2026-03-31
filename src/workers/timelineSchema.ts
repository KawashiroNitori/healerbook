/**
 * 时间轴数据校验 schema（Valibot）
 *
 * 用于 POST/PUT 接口，校验并剥离不在正常时间轴中出现的字段和不正确的类型。
 */

import * as v from 'valibot'
import { JOB_METADATA } from '@/data/jobs'
import { DAMAGE_TYPES, DAMAGE_EVENT_TYPES } from '@/types/timeline'
import {
  TIMELINE_NAME_MAX_LENGTH,
  TIMELINE_DESCRIPTION_MAX_LENGTH,
  DAMAGE_EVENT_NAME_MAX_LENGTH,
  ANNOTATION_TEXT_MAX_LENGTH,
} from '@/constants/limits'

const JobSchema = v.picklist(Object.keys(JOB_METADATA) as [string, ...string[]])

const DamageTypeSchema = v.picklist(DAMAGE_TYPES)

const StatusSnapshotSchema = v.object({
  statusId: v.number(),
  targetPlayerId: v.optional(v.number()),
  absorb: v.optional(v.number()),
})

const PlayerDamageDetailSchema = v.object({
  timestamp: v.number(),
  packetId: v.number(),
  sourceId: v.number(),
  playerId: v.number(),
  job: JobSchema,
  abilityId: v.number(),
  skillName: v.string(),
  unmitigatedDamage: v.number(),
  finalDamage: v.number(),
  overkill: v.optional(v.number()),
  multiplier: v.optional(v.number()),
  statuses: v.array(StatusSnapshotSchema),
  hitPoints: v.optional(v.number()),
  maxHitPoints: v.optional(v.number()),
})

const DamageEventSchema = v.object({
  id: v.string(),
  name: v.pipe(v.string(), v.maxLength(DAMAGE_EVENT_NAME_MAX_LENGTH)),
  time: v.number(),
  damage: v.number(),
  type: v.picklist(DAMAGE_EVENT_TYPES),
  damageType: DamageTypeSchema,
  targetPlayerId: v.optional(v.number()),
  playerDamageDetails: v.optional(v.array(PlayerDamageDetailSchema)),
  packetId: v.optional(v.number()),
})

const CastEventSchema = v.object({
  id: v.string(),
  actionId: v.number(),
  timestamp: v.number(),
  playerId: v.number(),
  job: JobSchema,
  targetPlayerId: v.optional(v.number()),
})

const CompositionSchema = v.object({
  players: v.array(
    v.object({
      id: v.number(),
      job: JobSchema,
    })
  ),
})

const EncounterSchema = v.object({
  id: v.number(),
  name: v.string(),
  displayName: v.string(),
  zone: v.string(),
  damageEvents: v.array(DamageEventSchema),
})

const FFLogsSourceSchema = v.object({
  reportCode: v.string(),
  fightId: v.number(),
})

const AnnotationAnchorSchema = v.variant('type', [
  v.object({ type: v.literal('damageTrack') }),
  v.object({
    type: v.literal('skillTrack'),
    playerId: v.number(),
    actionId: v.number(),
  }),
])

const AnnotationSchema = v.object({
  id: v.string(),
  text: v.pipe(v.string(), v.maxLength(ANNOTATION_TEXT_MAX_LENGTH)),
  time: v.number(),
  anchor: AnnotationAnchorSchema,
})

/**
 * 时间轴数据 schema
 */
const TimelineSchema = v.object({
  name: v.pipe(v.string(), v.maxLength(TIMELINE_NAME_MAX_LENGTH)),
  description: v.optional(v.pipe(v.string(), v.maxLength(TIMELINE_DESCRIPTION_MAX_LENGTH))),
  fflogsSource: v.optional(FFLogsSourceSchema),
  encounter: EncounterSchema,
  composition: CompositionSchema,
  damageEvents: v.array(DamageEventSchema),
  castEvents: v.array(CastEventSchema),
  annotations: v.optional(v.array(AnnotationSchema)),
  isReplayMode: v.optional(v.boolean()),
  createdAt: v.number(),
  updatedAt: v.number(),
})

/**
 * POST /api/timelines 请求体 schema
 */
export const CreateTimelineRequestSchema = v.object({
  timeline: TimelineSchema,
})

/**
 * PUT /api/timelines/:id 请求体 schema
 */
export const UpdateTimelineRequestSchema = v.object({
  timeline: TimelineSchema,
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
