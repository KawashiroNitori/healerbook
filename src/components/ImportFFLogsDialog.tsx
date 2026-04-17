/**
 * FFLogs 导入对话框
 */

import { useState, useEffect, useMemo, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { parseFFLogsUrl } from '@/utils/fflogsParser'
import { createFFLogsClient } from '@/api/fflogsClient'
import {
  parseComposition,
  parseDamageEvents,
  parseCastEvents,
  parseSyncEvents,
  findFirstDamageTimestamp,
} from '@/utils/fflogsImporter'
import { createNewTimeline, saveTimeline, buildFFLogsSourceIndex } from '@/utils/timelineStorage'
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalFooter } from '@/components/ui/modal'
import { getEncounterWithTier } from '@/data/raidEncounters'
import { track } from '@/utils/analytics'
import { apiClient } from '@/api/apiClient'
import { parseFromAny } from '@/utils/timelineFormat'
import { generateId } from '@/utils/id'

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

  // 查找本地是否已导入相同 reportCode+fightId 的时间轴
  const duplicate = useMemo(() => {
    if (!parsed?.reportCode || parsed.isLastFight || parsed.fightId == null) {
      return null
    }
    const index = buildFFLogsSourceIndex()
    return index.get(`${parsed.reportCode}:${parsed.fightId}`) ?? null
  }, [parsed?.reportCode, parsed?.fightId, parsed?.isLastFight])

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

  const clientImport = new URLSearchParams(window.location.search).get('client_import') === '1'

  /** 服务端解析：一次请求返回完整 Timeline */
  const handleServerSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!parsed?.reportCode) return

    setError('')
    setIsLoading(true)
    setLoadingStep('正在解析战斗事件...')

    try {
      const params = new URLSearchParams({ reportCode: parsed.reportCode })
      if (!parsed.isLastFight && parsed.fightId !== null) {
        params.set('fightId', String(parsed.fightId))
      }

      const response = await apiClient.get(`fflogs/import?${params}`, {
        timeout: 120000,
        throwHttpErrors: false,
      })

      if (!response.ok) {
        const body = (await response.json()) as { error?: string }
        throw new Error(body.error || `HTTP ${response.status}`)
      }

      const raw = await response.json()
      const newTimeline = parseFromAny(raw, { id: generateId() })
      newTimeline.description = `导入自 ${url}`

      saveTimeline(newTimeline)
      track('fflogs-import', { success: true, encounterId: newTimeline.encounter?.id ?? 0 })

      window.open(`/timeline/${newTimeline.id}`, '_blank')
      onImported()
      onClose()
    } catch (err) {
      track('fflogs-import', { success: false })
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

  /** 前端解析：原有逻辑 */
  const handleClientSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!parsed?.reportCode) return

    setError('')
    setIsLoading(true)
    setLoadingStep('正在获取报告信息...')

    try {
      // 获取报告数据
      const client = createFFLogsClient()
      const report = await client.getReport(parsed.reportCode)

      // 确定战斗 ID
      let fightId = parsed.fightId
      if (parsed.isLastFight) {
        // 获取最后一个战斗
        if (!report.fights || report.fights.length === 0) {
          throw new Error('报告中没有战斗记录')
        }
        fightId = report.fights[report.fights.length - 1].id
      }

      // 查找指定的战斗
      const fight = report.fights?.find(f => f.id === fightId)
      if (!fight) {
        throw new Error(`战斗 #${fightId} 不存在`)
      }

      // 创建时间轴名称
      // 优先从 raidEncounters.ts 查询副本名称
      let timelineName = fight.name || `战斗 ${fightId}`

      if (fight.encounterID) {
        const result = getEncounterWithTier(fight.encounterID)
        if (result) {
          timelineName = `${result.tier.name} - ${result.encounter.name}`
        }
      }

      // 创建新时间轴
      const newTimeline = createNewTimeline(fight.encounterID?.toString() || '0', timelineName)

      // 更新战斗信息
      newTimeline.encounter = {
        id: fight.encounterID || 0,
        name: fight.name,
        displayName: fight.name,
        zone: report.title || '',
        damageEvents: [],
      }

      // 写入 gameZoneId（仅当 FFLogs 返回该字段时）
      if (fight.gameZoneId != null) {
        newTimeline.gameZoneId = fight.gameZoneId
      }

      // 获取伤害事件（自动分页）
      setLoadingStep('正在获取战斗事件...')

      try {
        const eventsData = await client.getAllEvents(parsed.reportCode, {
          start: fight.startTime,
          end: fight.endTime,
          lang: report.lang,
        })

        setLoadingStep(`正在解析数据...`)

        // 构建玩家 ID 映射
        const playerMap = new Map<number, { id: number; name: string; type: string }>()
        report.friendlies?.forEach(player => {
          playerMap.set(player.id, { id: player.id, name: player.name, type: player.type })
        })

        // 构建技能元数据映射（V2 API 提供）
        const abilityMap = new Map<
          number,
          { gameID: number; name: string; type: string | number }
        >()
        report.abilities?.forEach(ability => {
          abilityMap.set(ability.gameID, ability)
        })

        // 从事件中提取实际参与战斗的玩家 ID
        const participantIds = new Set<number>()
        for (const event of eventsData.events || []) {
          if (event.sourceID && playerMap.has(event.sourceID)) participantIds.add(event.sourceID)
          if (event.targetID && playerMap.has(event.targetID)) participantIds.add(event.targetID)
        }

        // 重新解析阵容（用参与者过滤）
        const composition = parseComposition(report, fightId!, participantIds)
        newTimeline.composition = composition

        // 战斗零时间：第一个 damage 事件的时间戳
        const fightStartTime = findFirstDamageTimestamp(eventsData.events || [], fight.startTime)

        // 解析伤害事件
        const damageEvents = parseDamageEvents(
          eventsData.events || [],
          fightStartTime,
          playerMap,
          abilityMap
        )
        newTimeline.damageEvents = damageEvents

        // 解析技能使用事件
        const castEvents = parseCastEvents(eventsData.events || [], fightStartTime, playerMap)

        // 解析 sync 事件（boss 关键技能锚点，用于 Souma 导出）
        newTimeline.syncEvents = parseSyncEvents(
          eventsData.events || [],
          fightStartTime,
          playerMap,
          abilityMap
        )

        // 设置为回放模式
        newTimeline.isReplayMode = true

        // 预填 description：记录导入来源
        newTimeline.description = `导入自 ${url}`

        // 记录 FFLogs 来源（parsed.reportCode 已在 handleSubmit 开头验证非 null）
        newTimeline.fflogsSource = {
          reportCode: parsed.reportCode!,
          fightId: fightId!,
        }

        newTimeline.castEvents = castEvents
      } catch (eventError) {
        console.error('Failed to fetch events:', eventError)
        throw eventError
      }

      // 保存时间轴
      saveTimeline(newTimeline)
      track('fflogs-import', { success: true, encounterId: fight.encounterID ?? 0 })

      // 跳转到编辑器
      window.open(`/timeline/${newTimeline.id}`, '_blank')
      onImported()
      onClose()
    } catch (err) {
      track('fflogs-import', { success: false })
      if (err instanceof Error) {
        // 友好的错误提示
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

  const handleSubmit = clientImport ? handleClientSubmit : handleServerSubmit

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

            {duplicate && (
              <div className="flex items-center gap-2 text-xs mt-1">
                <span className="text-muted-foreground">该战斗记录已经导入过</span>
                <button
                  type="button"
                  onClick={() => window.open(`/timeline/${duplicate.id}`, '_blank')}
                  className="text-primary hover:underline"
                >
                  查看
                </button>
              </div>
            )}
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
