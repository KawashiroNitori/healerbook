/**
 * 主页
 */

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Upload, FileText, Trash2 } from 'lucide-react'
import {
  getAllTimelineMetadata,
  createNewTimeline,
  saveTimeline,
  deleteTimeline,
  type TimelineMetadata,
} from '@/utils/timelineStorage'
import { format } from 'date-fns'
import ConfirmDialog from '@/components/ConfirmDialog'
import { toast } from 'sonner'

export default function HomePage() {
  const navigate = useNavigate()
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [timelines, setTimelines] = useState<TimelineMetadata[]>([])
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [timelineToDelete, setTimelineToDelete] = useState<string | null>(null)

  useEffect(() => {
    loadTimelines()
  }, [])

  const loadTimelines = () => {
    const data = getAllTimelineMetadata()
    setTimelines(data.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
  }

  const handleCreateNew = () => {
    setShowCreateDialog(true)
  }

  const handleImportFromFFLogs = () => {
    setShowImportDialog(true)
  }

  const handleDeleteTimeline = (id: string) => {
    setTimelineToDelete(id)
    setDeleteConfirmOpen(true)
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b">
        <div className="container mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold">Healerbook</h1>
          <p className="text-sm text-muted-foreground">FF14 减伤规划工具</p>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <button
            onClick={handleCreateNew}
            className="flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-lg hover:border-primary hover:bg-accent transition-colors"
          >
            <Plus className="w-12 h-12 mb-2 text-muted-foreground" />
            <span className="font-medium">新建时间轴</span>
            <span className="text-sm text-muted-foreground">从空白开始</span>
          </button>

          <button
            onClick={handleImportFromFFLogs}
            className="flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-lg hover:border-primary hover:bg-accent transition-colors"
          >
            <Upload className="w-12 h-12 mb-2 text-muted-foreground" />
            <span className="font-medium">从 FFLogs 导入</span>
            <span className="text-sm text-muted-foreground">导入战斗记录</span>
          </button>

          <button
            className="flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-lg hover:border-primary hover:bg-accent transition-colors"
            disabled
          >
            <FileText className="w-12 h-12 mb-2 text-muted-foreground" />
            <span className="font-medium">导入 JSON</span>
            <span className="text-sm text-muted-foreground">从文件导入</span>
          </button>
        </div>

        {/* Recent Timelines */}
        <section>
          <h2 className="text-xl font-semibold mb-4">最近的时间轴</h2>
          {timelines.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <p>暂无时间轴</p>
              <p className="text-sm mt-2">创建或导入一个时间轴开始使用</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {timelines.map((timeline) => (
                <div
                  key={timeline.id}
                  className="border rounded-lg p-4 hover:border-primary transition-colors cursor-pointer group"
                  onClick={() => navigate(`/editor/${timeline.id}`)}
                >
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="font-medium group-hover:text-primary">{timeline.name}</h3>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDeleteTimeline(timeline.id)
                      }}
                      className="p-1 hover:bg-destructive/10 hover:text-destructive rounded transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-sm text-muted-foreground mb-2">
                    副本: {timeline.encounterId}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    更新于 {format(new Date(timeline.updatedAt), 'yyyy-MM-dd HH:mm')}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      {/* Dialogs */}
      {showCreateDialog && (
        <CreateDialog
          onClose={() => setShowCreateDialog(false)}
          onCreated={loadTimelines}
        />
      )}
      {showImportDialog && (
        <ImportDialog
          onClose={() => setShowImportDialog(false)}
          onImported={loadTimelines}
        />
      )}

      {/* 删除确认对话框 */}
      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="删除时间轴"
        description="确定要删除这个时间轴吗？"
        onConfirm={() => {
          if (timelineToDelete) {
            deleteTimeline(timelineToDelete)
            loadTimelines()
            setTimelineToDelete(null)
            toast.success('时间轴已删除')
          }
          setDeleteConfirmOpen(false)
        }}
      />
    </div>
  )
}

/**
 * 创建时间轴对话框
 */
function CreateDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [encounterId, setEncounterId] = useState('p9s')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!name.trim()) {
      toast.error('请输入时间轴名称')
      return
    }

    const timeline = createNewTimeline(encounterId, name.trim())
    saveTimeline(timeline)
    onCreated()
    navigate(`/editor/${timeline.id}`)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background rounded-lg shadow-lg max-w-md w-full mx-4">
        <div className="p-6">
          <h2 className="text-xl font-semibold mb-4">新建时间轴</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">
                时间轴名称 <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如: P9S 减伤规划"
                className="w-full px-3 py-2 border rounded-md"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">副本</label>
              <select
                value={encounterId}
                onChange={(e) => setEncounterId(e.target.value)}
                className="w-full px-3 py-2 border rounded-md"
              >
                <option value="p9s">P9S - Kokytos</option>
                <option value="p10s">P10S - Pandæmonium</option>
                <option value="p11s">P11S - Themis</option>
                <option value="p12s_p1">P12S Phase 1 - Athena</option>
                <option value="p12s_p2">P12S Phase 2 - Pallas Athena</option>
                <option value="top">TOP - The Omega Protocol</option>
                <option value="dsr">DSR - Dragonsong's Reprise</option>
                <option value="tea">TEA - The Epic of Alexander</option>
                <option value="uwu">UWU - The Weapon's Refrain</option>
                <option value="ucob">UCOB - The Unending Coil of Bahamut</option>
              </select>
            </div>

            <div className="flex gap-2 justify-end pt-4">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 border rounded-md hover:bg-accent transition-colors"
              >
                取消
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
              >
                创建
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

/**
 * FFLogs 导入对话框
 */
function ImportDialog({
  onClose,
  onImported,
}: {
  onClose: () => void
  onImported: () => void
}) {
  const navigate = useNavigate()
  const [reportUrl, setReportUrl] = useState('')
  const [fightId, setFightId] = useState('')
  const [apiToken, setApiToken] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      // TODO: 实现 FFLogs 导入逻辑
      // 1. 验证输入
      if (!reportUrl || !fightId || !apiToken) {
        throw new Error('请填写所有必填字段')
      }

      // 2. 调用 API 导入数据
      // const result = await importTimelineFromFFLogs(reportUrl, parseInt(fightId), apiToken)

      // 3. 创建时间轴并跳转
      const newTimelineId = `timeline-${Date.now()}`
      navigate(`/editor/${newTimelineId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入失败')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background rounded-lg shadow-lg max-w-md w-full mx-4">
        <div className="p-6">
          <h2 className="text-xl font-semibold mb-4">从 FFLogs 导入</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">
                报告 URL <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                value={reportUrl}
                onChange={(e) => setReportUrl(e.target.value)}
                placeholder="https://www.fflogs.com/reports/..."
                className="w-full px-3 py-2 border rounded-md"
                disabled={isLoading}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                战斗 ID <span className="text-destructive">*</span>
              </label>
              <input
                type="number"
                value={fightId}
                onChange={(e) => setFightId(e.target.value)}
                placeholder="1"
                className="w-full px-3 py-2 border rounded-md"
                disabled={isLoading}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                API Token <span className="text-destructive">*</span>
              </label>
              <input
                type="password"
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
                placeholder="your-api-token"
                className="w-full px-3 py-2 border rounded-md"
                disabled={isLoading}
              />
              <p className="text-xs text-muted-foreground mt-1">
                在{' '}
                <a
                  href="https://www.fflogs.com/api/clients/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  FFLogs API
                </a>{' '}
                获取
              </p>
            </div>

            {error && (
              <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                {error}
              </div>
            )}

            <div className="flex gap-2 justify-end">
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
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
