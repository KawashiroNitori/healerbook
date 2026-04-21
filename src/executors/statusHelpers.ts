/**
 * 状态不可变更新工具
 *
 * 供 StatusExecutor 使用；调用方只描述“要做什么”，由 helpers 负责
 * instanceId 生成、startTime/endTime 计算、initialBarrier 默认值。
 */

import type { PartyState } from '@/types/partyState'
import type { MitigationStatus, PerformanceType } from '@/types/status'
import { generateId } from './utils'

/**
 * addStatus 入参
 * 框架根据 eventTime + duration 填 startTime/endTime，生成 instanceId。
 */
export interface AddStatusInput {
  statusId: number
  /** 事件发生时刻（作为 startTime） */
  eventTime: number
  /** 持续时间（秒），endTime = eventTime + duration */
  duration: number
  remainingBarrier?: number
  /** 不填默认等于 remainingBarrier */
  initialBarrier?: number
  stack?: number
  sourceActionId?: number
  sourcePlayerId?: number
  /** 条件性减伤值覆盖（不填走 metadata 默认） */
  performance?: PerformanceType
  /** executor 自定义数据初值 */
  data?: Record<string, unknown>
  /** barrier 归 0 时是否由 calculator 自动移除本实例；默认 undefined = 保留 */
  removeOnBarrierBreak?: boolean
}

/**
 * 添加一个新状态到 PartyState
 */
export function addStatus(state: PartyState, input: AddStatusInput): PartyState {
  const { eventTime, duration, statusId, remainingBarrier, initialBarrier, ...rest } = input

  const newStatus: MitigationStatus = {
    instanceId: generateId(),
    statusId,
    startTime: eventTime,
    endTime: eventTime + duration,
    ...rest,
  }

  if (remainingBarrier !== undefined) {
    newStatus.remainingBarrier = remainingBarrier
    newStatus.initialBarrier = initialBarrier ?? remainingBarrier
  }

  return {
    ...state,
    statuses: [...state.statuses, newStatus],
  }
}

/**
 * 按 instanceId 移除状态
 */
export function removeStatus(state: PartyState, instanceId: string): PartyState {
  return {
    ...state,
    statuses: state.statuses.filter(s => s.instanceId !== instanceId),
  }
}

/**
 * 按 statusId 移除所有匹配状态
 */
export function removeStatusesByStatusId(state: PartyState, statusId: number): PartyState {
  return {
    ...state,
    statuses: state.statuses.filter(s => s.statusId !== statusId),
  }
}

/**
 * 按 instanceId 合并更新指定状态字段
 */
export function updateStatus(
  state: PartyState,
  instanceId: string,
  patch: Partial<Omit<MitigationStatus, 'instanceId' | 'statusId'>>
): PartyState {
  return {
    ...state,
    statuses: state.statuses.map(s => (s.instanceId === instanceId ? { ...s, ...patch } : s)),
  }
}

/**
 * 按 instanceId 浅合并更新指定状态的 `data` 字段
 * 方便 executor 只写增量字段，不用每次手动 `{ ...s.data, ... }`
 */
export function updateStatusData(
  state: PartyState,
  instanceId: string,
  patch: Record<string, unknown>
): PartyState {
  return {
    ...state,
    statuses: state.statuses.map(s =>
      s.instanceId === instanceId ? { ...s, data: { ...s.data, ...patch } } : s
    ),
  }
}
