/**
 * Workers FFLogs 类型定义
 */

export interface FFLogsV2Fight {
  id: number
  name: string
  difficulty: number
  kill?: boolean
  startTime: number
  endTime: number
  encounterID: number
}

export interface FFLogsV2Actor {
  id: number
  name: string
  subType?: string
  type: string
  server: string
}

export interface FFLogsV2Ability {
  gameID: number
  name: string
  type: string
  icon: string
}
