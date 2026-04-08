/**
 * FFLogs 导入对话框
 */

import { useState, useEffect, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { parseFFLogsUrl } from '@/utils/fflogsParser'
import { createFFLogsClient } from '@/api/fflogsClient'
import {
  parseComposition,
  parseDamageEvents,
  parseCastEvents,
  findFirstDamageTimestamp,
} from '@/utils/fflogsImporter'
import { createNewTimeline, saveTimeline } from '@/utils/timelineStorage'
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalFooter } from '@/components/ui/modal'
import { getEncounterWithTier } from '@/data/raidEncounters'
import { track } from '@/utils/analytics'
import { apiClient } from '@/api/apiClient'
import type { Timeline } from '@/types/timeline'

const useServerImport = () =>
  new URLSearchParams(window.location.search).get('server_import') === '1'

interface ImportFFLogsDialogProps {
  open: boolean
  onClose: () => void
  onImported: () => void
  /** 预填的 FFLogs URL（来自 TOP100 等外部来源） */
  initialUrl?: string
}

export default function ImportFFLogsDialog({
  open,
  onClose,
  onImported,
  initialUrl,
}: ImportFFLogsDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState(initialUrl ?? '')
  const [isLoading, setIsLoading] = useState(false)
  const [loadingStep, setLoadingStep] = useState('')
  const [error, setError] = useState('')

  // 实时解析 URL，判断是否合法
  const parsed = url ? parseFFLogsUrl(url) : null
  const isValid = !!parsed?.reportCode
  const validationError = url && !isValid ? '无法识别 FFLogs 链接，请检查 URL 格式' : ''

  // 自动聚焦输入框并检测剪贴板
  useEffect(() => {
    inputRef.current?.focus()

    // 如果已有预填 URL，则跳过剪贴板检测
    if (initialUrl) return

    // 尝试读取剪贴板
    const readClipboard = async () => {
      try {
        const text = await navigator.clipboard.readText()
        if (text && /fflogs\.com\/reports\//.test(text)) {
          setUrl(text)
        }
      } catch (err) {
        // 剪贴板读取失败（权限问题或不支持），静默忽略
        console.debug('无法读取剪贴板:', err)
      }
    }

    readClipboard()
  }, [initialUrl])

  const serverImport = useServerImport()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!parsed?.reportCode) return

    setError('')
    setIsLoading(true)

    try {
      let newTimeline: Timeline

      if (serverImport) {
        newTimeline = await handleServerImport(
          parsed.reportCode,
          parsed.fightId,
          parsed.isLastFight
        )
      } else {
        newTimeline = await handleClientImport(
          parsed.reportCode,
          parsed.fightId,
          parsed.isLastFight
        )
      }

      newTimeline.description = `导入自 ${url}`

      // 保存时间轴
      saveTimeline(newTimeline)
      track('fflogs-import', {
        success: true,
        encounterId: newTimeline.encounter?.id ?? 0,
        serverImport,
      })

      // 跳转到编辑器
      window.open(`/timeline/${newTimeline.id}`, '_blank')
      onImported()
      onClose()
    } catch (err) {
      track('fflogs-import', { success: false, serverImport })
      if (err instanceof Error) {
        if (err.message.includes('API Token') || err.message.includes('API Key')) {
          setError('FFLogs 连接配置错误，请联系开发者')
        } else {
          setError(err.message)
        }
      } else {
        setError('导入失败，请稍后重试')
      }
    } finally {
      setIsLoading(false)
    }
  }

  /** 服务端解析：一次请求返回完整 Timeline */
  const handleServerImport = async (
    reportCode: string,
    fightId: number | null,
    isLastFight: boolean
  ): Promise<Timeline> => {
    setLoadingStep('正在服务端解析...')

    const params = new URLSearchParams({ reportCode })
    if (!isLastFight && fightId !== null) {
      params.set('fightId', String(fightId))
    }

    const response = await apiClient.get(`fflogs/import?${params}`, {
      timeout: 120000,
      throwHttpErrors: false,
    })

    if (!response.ok) {
      const body = (await response.json()) as { error?: string }
      throw new Error(body.error || `HTTP ${response.status}`)
    }

    return (await response.json()) as Timeline
  }

  /** 前端解析：原有逻辑 */
  const handleClientImport = async (
    reportCode: string,
    fightId: number | null,
    isLastFight: boolean
  ): Promise<Timeline> => {
    setLoadingStep('正在获取报告信息...')

    const client = createFFLogsClient()
    const report = await client.getReport(reportCode)

    // 确定战斗 ID
    let resolvedFightId = fightId
    if (isLastFight) {
      if (!report.fights || report.fights.length === 0) {
        throw new Error('报告中没有战斗记录')
      }
      resolvedFightId = report.fights[report.fights.length - 1].id
    }

    const fight = report.fights?.find(f => f.id === resolvedFightId)
    if (!fight) {
      throw new Error(`战斗 #${resolvedFightId} 不存在`)
    }

    // 创建时间轴名称
    let timelineName = fight.name || `战斗 ${resolvedFightId}`
    if (fight.encounterID) {
      const result = getEncounterWithTier(fight.encounterID)
      if (result) {
        timelineName = `${result.tier.name} - ${result.encounter.name}`
      }
    }

    const newTimeline = createNewTimeline(fight.encounterID?.toString() || '0', timelineName)

    newTimeline.encounter = {
      id: fight.encounterID || 0,
      name: fight.name,
      displayName: fight.name,
      zone: report.title || '',
      damageEvents: [],
    }

    setLoadingStep('正在获取战斗事件...')

    const eventsData = await client.getAllEvents(reportCode, {
      start: fight.startTime,
      end: fight.endTime,
      lang: report.lang,
    })

    setLoadingStep('正在解析数据...')

    const playerMap = new Map<number, { id: number; name: string; type: string }>()
    report.friendlies?.forEach(player => {
      playerMap.set(player.id, { id: player.id, name: player.name, type: player.type })
    })

    const abilityMap = new Map<number, { gameID: number; name: string; type: string | number }>()
    report.abilities?.forEach(ability => {
      abilityMap.set(ability.gameID, ability)
    })

    const participantIds = new Set<number>()
    for (const event of eventsData.events || []) {
      if (event.sourceID && playerMap.has(event.sourceID)) participantIds.add(event.sourceID)
      if (event.targetID && playerMap.has(event.targetID)) participantIds.add(event.targetID)
    }

    const composition = parseComposition(report, resolvedFightId!, participantIds)
    newTimeline.composition = composition

    const fightStartTime = findFirstDamageTimestamp(eventsData.events || [], fight.startTime)

    newTimeline.damageEvents = parseDamageEvents(
      eventsData.events || [],
      fightStartTime,
      playerMap,
      abilityMap
    )

    newTimeline.castEvents = parseCastEvents(eventsData.events || [], fightStartTime, playerMap)

    newTimeline.isReplayMode = true
    newTimeline.fflogsSource = {
      reportCode,
      fightId: resolvedFightId!,
    }

    return newTimeline
  }

  return (
    <Modal open={open} onClose={onClose} disableBackdropClick={isLoading}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>从 FFLogs 导入</ModalTitle>
        </ModalHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">FFLogs 战斗链接</label>
            <input
              ref={inputRef}
              type="text"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://www.fflogs.com/reports/ABC123#fight=5"
              className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              disabled={isLoading}
            />
            <p className="text-xs text-muted-foreground mt-1">粘贴 FFLogs 战斗链接或报告代码</p>

            {validationError && <p className="text-xs text-destructive mt-1">{validationError}</p>}
          </div>

          {error && (
            <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">{error}</div>
          )}

          {/* 加载状态 */}
          {isLoading && (
            <div className="p-3 bg-muted rounded-md">
              <div className="flex items-center gap-3">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">{loadingStep}</span>
              </div>
            </div>
          )}

          <ModalFooter>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border rounded-md hover:bg-accent"
              disabled={isLoading}
            >
              取消
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
              disabled={isLoading || !isValid}
            >
              {isLoading ? '导入中...' : '导入'}
            </button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  )
}
