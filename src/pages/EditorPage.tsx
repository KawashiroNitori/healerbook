/**
 * 编辑器页面
 */

import { useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useTimelineStore } from '@/store/timelineStore'
import { getTimeline } from '@/utils/timelineStorage'
import EditorToolbar from '@/components/EditorToolbar'
import SkillPanel from '@/components/SkillPanel'
import PropertyPanel from '@/components/PropertyPanel'
import TimelineCanvas from '@/components/TimelineCanvas'

export default function EditorPage() {
  const { timelineId } = useParams<{ timelineId: string }>()
  const navigate = useNavigate()
  const { timeline, setTimeline } = useTimelineStore()
  const canvasContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (timelineId) {
      const loadedTimeline = getTimeline(timelineId)
      if (loadedTimeline) {
        setTimeline(loadedTimeline)
      } else {
        alert('时间轴不存在')
        navigate('/')
      }
    }

    return () => {
      setTimeline(null)
    }
  }, [timelineId, setTimeline, navigate])

  const canvasWidth = canvasContainerRef.current?.clientWidth || 800
  const canvasHeight = canvasContainerRef.current?.clientHeight || 600

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
        {/* Skill Panel */}
        <SkillPanel />

        {/* Canvas Area */}
        <div ref={canvasContainerRef} className="flex-1 overflow-hidden">
          {timeline ? (
            <TimelineCanvas width={canvasWidth} height={canvasHeight} />
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-muted-foreground">加载中...</p>
            </div>
          )}
        </div>

        {/* Property Panel */}
        <PropertyPanel />
      </div>
    </div>
  )
}
