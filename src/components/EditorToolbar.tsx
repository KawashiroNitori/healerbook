/**
 * 编辑器工具栏组件
 */

import { useState } from 'react'
import { ZoomIn, ZoomOut, Plus } from 'lucide-react'
import { useTimelineStore } from '@/store/timelineStore'
import AddEventDialog from './AddEventDialog'

export default function EditorToolbar() {
  const { zoomLevel, setZoomLevel } = useTimelineStore()
  const [showAddEventDialog, setShowAddEventDialog] = useState(false)

  const handleZoomIn = () => {
    setZoomLevel(zoomLevel + 10)
  }

  const handleZoomOut = () => {
    setZoomLevel(zoomLevel - 10)
  }

  return (
    <div className="h-12 border-b bg-background flex items-center px-4 gap-4">
      {/* Zoom Controls */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleZoomOut}
          className="p-2 hover:bg-accent rounded transition-colors"
          title="缩小"
        >
          <ZoomOut className="w-4 h-4" />
        </button>

        <button
          onClick={handleZoomIn}
          className="p-2 hover:bg-accent rounded transition-colors"
          title="放大"
        >
          <ZoomIn className="w-4 h-4" />
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

      {/* Add Event Dialog */}
      {showAddEventDialog && (
        <AddEventDialog onClose={() => setShowAddEventDialog(false)} />
      )}
    </div>
  )
}
