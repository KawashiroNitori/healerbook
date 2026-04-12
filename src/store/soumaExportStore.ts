/**
 * Souma 时间轴导出对话框的持久化状态
 *
 * 持久化以下用户偏好：
 * - 上次选择的职业（lastJob）
 * - 每个职业分别保存的"技能勾选"集合（actionIdsByJob）
 * - TTS 播报开关（ttsEnabled）
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Job } from '@/data/jobs'

interface SoumaExportState {
  /** 上次选择的职业；用于下次打开对话框时回到同一职业 */
  lastJob: Job | null
  /** 每个职业最后一次的技能勾选（actionId 数组）；首次使用某职业时为 undefined，由调用方默认全选 */
  actionIdsByJob: Partial<Record<Job, number[]>>
  /** TTS 开关状态 */
  ttsEnabled: boolean

  setLastJob: (job: Job) => void
  setActionIdsForJob: (job: Job, ids: number[]) => void
  setTtsEnabled: (v: boolean) => void
}

export const useSoumaExportStore = create<SoumaExportState>()(
  persist(
    set => ({
      lastJob: null,
      actionIdsByJob: {},
      ttsEnabled: false,

      setLastJob: job => set({ lastJob: job }),
      setActionIdsForJob: (job, ids) =>
        set(state => ({
          actionIdsByJob: { ...state.actionIdsByJob, [job]: ids },
        })),
      setTtsEnabled: ttsEnabled => set({ ttsEnabled }),
    }),
    { name: 'souma-export-store' }
  )
)
