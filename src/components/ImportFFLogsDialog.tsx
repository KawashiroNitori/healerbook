/**
 * FFLogs 导入对话框
 */

import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { parseFFLogsUrl } from '@/utils/fflogsParser'
import { createFFLogsClient } from '@/api/fflogsClient'
import { parseComposition, parseDamageEvents, parseCastEventsFromFFLogs, parseStatusEvents } from '@/utils/fflogsImporter'
import { createNewTimeline, saveTimeline } from '@/utils/timelineStorage'
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalFooter } from '@/components/ui/modal'

interface ImportFFLogsDialogProps {
  open: boolean
  onClose: () => void
  onImported: () => void
}

export default function ImportFFLogsDialog({ open, onClose }: ImportFFLogsDialogProps) {
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [loadingStep, setLoadingStep] = useState('')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [parsedInfo, setParsedInfo] = useState<{
    reportCode: string | null
    fightId: number | null
    isLastFight: boolean
  } | null>(null)

  // 自动聚焦输入框并检测剪贴板
  useEffect(() => {
    inputRef.current?.focus()

    // 尝试读取剪贴板
    const readClipboard = async () => {
      try {
        const text = await navigator.clipboard.readText()
        if (text) {
          // 检查是否为合法的 FFLogs 链接（必须同时包含 reportCode 和 fightId）
          const parsed = parseFFLogsUrl(text)
          if (parsed.reportCode && (parsed.fightId || parsed.isLastFight)) {
            setUrl(text)
          }
        }
      } catch (err) {
        // 剪贴板读取失败（权限问题或不支持），静默忽略
        console.debug('无法读取剪贴板:', err)
      }
    }

    readClipboard()
  }, [])

  // 实时解析 URL
  useEffect(() => {
    if (url) {
      const parsed = parseFFLogsUrl(url)
      setParsedInfo(parsed)
      setError('')
    } else {
      setParsedInfo(null)
    }
  }, [url])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!url) {
      setError('请输入 FFLogs URL')
      return
    }

    const parsed = parseFFLogsUrl(url)

    if (!parsed.reportCode) {
      setError('无法解析报告代码，请检查 URL 格式')
      return
    }

    if (!parsed.fightId && !parsed.isLastFight) {
      setError('无法从 URL 中提取战斗 ID，请确保 URL 包含 #fight=N 或 #fight=last')
      return
    }

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
      const fight = report.fights?.find((f) => f.id === fightId)
      if (!fight) {
        throw new Error(`战斗 #${fightId} 不存在`)
      }

      // 创建时间轴名称
      const timelineName = `${report.title || '未命名报告'} - ${fight.name || `战斗 ${fightId}`}`

      // 创建新时间轴
      const newTimeline = createNewTimeline(
        fight.encounterID?.toString() || '0',
        timelineName
      )

      // 更新战斗信息
      newTimeline.encounter = {
        id: fight.encounterID || 0,
        name: fight.name,
        displayName: fight.name,
        zone: report.title || '',
        damageEvents: [],
      }

      // 解析阵容
      const composition = parseComposition(report, fightId)
      newTimeline.composition = composition

      // 计算战斗时长（秒）
      const duration = Math.floor((fight.endTime - fight.startTime) / 1000)

      // 获取伤害事件（自动分页）
      setLoadingStep('正在获取战斗事件...')
      setProgress(0)

      try {
        const eventsData = await client.getAllEvents(
          parsed.reportCode,
          {
            start: fight.startTime,
            end: fight.endTime,
            lang: report.lang,
          },
          (progressInfo) => {
            setProgress(progressInfo.percentage)
            setLoadingStep('正在获取战斗事件')
          }
        )

        setLoadingStep(`已获取 ${eventsData.totalPages} 页数据，正在解析...`)
        setProgress(100)

        // 构建玩家 ID 映射
        const playerMap = new Map<number, any>()
        report.friendlies?.forEach((player) => {
          playerMap.set(player.id, player)
        })

        // 解析伤害事件
        const damageEvents = parseDamageEvents(eventsData.events || [], fight.startTime, playerMap)
        newTimeline.damageEvents = damageEvents

        // 解析技能使用事件
        const castEvents = parseCastEventsFromFFLogs(
          eventsData.events || [],
          fight.startTime,
          playerMap,
          damageEvents
        )

        // 解析状态事件
        const statusEvents = parseStatusEvents(
          eventsData.events || [],
          fight.startTime
        )

        // 设置为回放模式
        newTimeline.isReplayMode = true
        newTimeline.castEvents = castEvents
        newTimeline.statusEvents = statusEvents

        toast.success(
          `已导入：${timelineName}（${duration}秒，${damageEvents.length} 个伤害事件，${castEvents.length} 个技能使用，${composition.players.length} 名玩家）`
        )
      } catch (eventError) {
        console.error('Failed to fetch events:', eventError)
        // 即使获取事件失败，也创建时间轴
        toast.warning('无法获取伤害事件，已创建空时间轴')
      }

      // 保存时间轴
      saveTimeline(newTimeline)

      // 跳转到编辑器
      navigate(`/editor/${newTimeline.id}`)
      onClose()
    } catch (err) {
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

  return (
    <Modal open={open} onClose={onClose} disableBackdropClick={isLoading}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>从 FFLogs 导入</ModalTitle>
        </ModalHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                FFLogs 战斗链接
              </label>
              <input
                ref={inputRef}
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.fflogs.com/reports/ABC123#fight=5"
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                disabled={isLoading}
              />
              <p className="text-xs text-muted-foreground mt-1">
                在 FFLogs 选择具体战斗后，复制浏览器地址栏的完整链接
              </p>

              {/* 实时解析结果 */}
              {parsedInfo && (
                <div className="mt-2 p-3 bg-muted rounded-md text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">报告:</span>
                    <span className="font-mono">
                      {parsedInfo.reportCode || '未识别'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">战斗:</span>
                    <span className="font-mono">
                      {parsedInfo.fightId !== null
                        ? `#${parsedInfo.fightId}`
                        : parsedInfo.isLastFight
                          ? 'last'
                          : '未识别'}
                    </span>
                  </div>
                  {parsedInfo.fightId === null && !parsedInfo.isLastFight && (
                    <p className="text-xs text-destructive mt-1">
                      ⚠️ 链接中未包含战斗编号，请在 FFLogs 选择具体战斗后再复制链接
                    </p>
                  )}
                </div>
              )}
            </div>

            {error && (
              <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                {error}
              </div>
            )}

            {/* 加载状态 */}
            {isLoading && (
              <div className="space-y-3 p-3 bg-muted rounded-md">
                <div className="flex items-center gap-3">
                  <Loader2 className="w-5 h-5 animate-spin text-primary" />
                  <span className="text-sm text-muted-foreground">{loadingStep}</span>
                </div>
                {/* 进度条 - 始终显示 */}
                <div className="space-y-1">
                  <div className="w-full bg-muted-foreground/20 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-primary h-full transition-all duration-500 ease-out"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <div className="text-xs text-muted-foreground text-right">
                    {progress}%
                  </div>
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
                disabled={isLoading}
              >
                {isLoading ? '导入中...' : '导入'}
              </button>
            </ModalFooter>
          </form>
      </ModalContent>
    </Modal>
  )
}
