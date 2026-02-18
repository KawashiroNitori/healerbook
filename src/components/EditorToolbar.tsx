/**
 * 编辑器工具栏组件
 */

import { useState } from 'react'
import { Play, Pause, ZoomIn, ZoomOut, Grid3x3, Ruler, Save, Plus } from 'lucide-react'
import { useTimelineStore } from '@/store/timelineStore'
import { useUIStore } from '@/store/uiStore'
import { saveTimeline } from '@/utils/timelineStorage'
import AddEventDialog from './AddEventDialog'

export default function EditorToolbar() {
  const {
    timeline,
    isPlaying,
    togglePlay,
    currentTime,
    setCurrentTime,
    zoomLevel,
    setZoomLevel,
  } = useTimelineStore()
  const { showGrid, toggleGrid, showTimeRuler, toggleTimeRuler } = useUIStore()
  const [showAddEventDialog, setShowAddEventDialog] = useState(false)

  const handleSave = () => {
    if (timeline) {
      saveTimeline(timeline)
      alert('保存成功')
    }
  }

  const handleZoomIn = () => {
    setZoomLevel(zoomLevel + 10)
  }

  const handleZoomOut = () => {
    setZoomLevel(zoomLevel - 10)
  }

  return (
    <div className="h-12 border-b bg-background flex items-center px-4 gap-4">
      {/* Playback Controls */}
      <div className="flex items-center gap-2">
        <button
          onClick={togglePlay}
          className="p-2 hover:bg-accent rounded transition-colors"
          title={isPlaying ? '暂停' : '播放'}
        >
          {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        </button>

        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">时间:</span>
          <input
            type="number"
            value={currentTime.toFixed(1)}
            onChange={(e) => setCurrentTime(parseFloat(e.target.value) || 0)}
            className="w-20 px-2 py-1 border rounded text-sm"
            step="0.1"
          />
          <span className="text-sm text-muted-foreground">秒</span>
        </div>
      </div>

      <div className="w-px h-6 bg-border" />

      {/* Zoom Controls */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleZoomOut}
          className="p-2 hover:bg-accent rounded transition-colors"
          title="缩小"
        >
          <ZoomOut className="w-4 h-4" />
        </button>

        <span className="text-sm text-muted-foreground min-w-[60px] text-center">
          {zoomLevel}px/s
        </span>

        <button
          onClick={handleZoomIn}
          className="p-2 hover:bg-accent rounded transition-colors"
          title="放大"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
      </div>

      <div className="w-px h-6 bg-border" />

      {/* View Controls */}
      <div className="flex items-center gap-2">
        <button
          onClick={toggleGrid}
          className={`p-2 rounded transition-colors ${
            showGrid ? 'bg-accent' : 'hover:bg-accent'
          }`}
          title="显示网格"
        >
          <Grid3x3 className="w-4 h-4" />
        </button>

        <button
          onClick={toggleTimeRuler}
          className={`p-2 rounded transition-colors ${
            showTimeRuler ? 'bg-accent' : 'hover:bg-accent'
          }`}
          title="显示时间标尺"
        >
          <Ruler className="w-4 h-4" />
        </button>
      </div>

      <div className="w-px h-6 bg-border" />

      {/* Add Event Button */}
      <button
        onClick={() => setShowAddEventDialog(true)}
        className="flex items-center gap-2 px-3 py-2 border rounded hover:bg-accent transition-colors"
      >
        <Plus className="w-4 h-4" />
        <span className="text-sm">添加事件</span>
      </button>

      <div className="flex-1" />

      {/* Save Button */}
      <button
        onClick={handleSave}
        className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors"
      >
        <Save className="w-4 h-4" />
        <span className="text-sm">保存</span>
      </button>

      {/* Add Event Dialog */}
      {showAddEventDialog && (
        <AddEventDialog onClose={() => setShowAddEventDialog(false)} />
      )}
    </div>
  )
}
