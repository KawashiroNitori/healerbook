/**
 * 编辑器页面
 */

import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useTimelineStore } from '@/store/timelineStore'
import { getTimeline } from '@/utils/timelineStorage'
import EditorToolbar from '@/components/EditorToolbar'
import ActionPanel from '@/components/SkillPanel'
import PropertyPanel from '@/components/PropertyPanel'
import TimelineCanvas from '@/components/Timeline'
import { toast } from 'sonner'

export default function EditorPage() {
  const { timelineId } = useParams<{ timelineId: string }>()
  const navigate = useNavigate()
  const { timeline, setTimeline } = useTimelineStore()
  const canvasContainerRef = useRef<HTMLDivElement>(null)
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 })

  useEffect(() => {
    if (timelineId) {
      const loadedTimeline = getTimeline(timelineId)
      if (loadedTimeline) {
        setTimeline(loadedTimeline)
      } else {
        toast.error('时间轴不存在')
        navigate('/')
      }
    }

    return () => {
      setTimeline(null)
    }
  }, [timelineId, setTimeline, navigate])

  // 监听容器尺寸变化
  useEffect(() => {
    const updateSize = () => {
      if (canvasContainerRef.current) {
        setCanvasSize({
          width: canvasContainerRef.current.clientWidth,
          height: canvasContainerRef.current.clientHeight,
        })
      }
    }

    // 初始化尺寸
    updateSize()

    // 监听窗口大小变化
    window.addEventListener('resize', updateSize)

    // 使用 ResizeObserver 监听容器大小变化
    const resizeObserver = new ResizeObserver(updateSize)
    if (canvasContainerRef.current) {
      resizeObserver.observe(canvasContainerRef.current)
    }

    return () => {
      window.removeEventListener('resize', updateSize)
      resizeObserver.disconnect()
    }
  }, [])

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="border-b flex-shrink-0">
        <div className="px-4 py-3 flex items-center gap-4">
          <button
            onClick={() => navigate('/')}
            className="p-2 hover:bg-accent rounded-md transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-lg font-bold">{timeline?.name || '时间轴编辑器'}</h1>
            <p className="text-xs text-muted-foreground">ID: {timelineId}</p>
          </div>
        </div>
      </header>

      {/* Toolbar */}
      <EditorToolbar />

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧：技能面板（固定宽度，独立滚动） */}
        <ActionPanel />

        {/* 中间：时间轴区域 */}
        <div className="flex-1 overflow-hidden">
          <div ref={canvasContainerRef} className="h-full">
            {timeline ? (
              <TimelineCanvas
                width={canvasSize.width}
                height={canvasSize.height}
              />
            ) : (
              <div className="flex items-center justify-center h-full">
                <p className="text-muted-foreground">加载中...</p>
              </div>
            )}
          </div>
        </div>

        {/* 右侧：属性面板 */}
        <PropertyPanel />
      </div>
    </div>
  )
}
