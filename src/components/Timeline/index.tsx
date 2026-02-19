/**
 * 时间轴 Canvas 主组件（重构版）
 */

import { useRef, useEffect, useState } from 'react'
import { Stage, Layer } from 'react-konva'
import { useTimelineStore } from '@/store/timelineStore'
import { useMitigationStore } from '@/store/mitigationStore'
import { sortJobsByOrder } from '@/data/jobs'
import { useDamageCalculation } from '@/hooks/useDamageCalculation'
import { toast } from 'sonner'
import ConfirmDialog from '../ConfirmDialog'
import TimeRuler from './TimeRuler'
import DamageEventTrack from './DamageEventTrack'
import SkillTrackLabels from './SkillTrackLabels'
import SkillTracksCanvas from './SkillTracksCanvas'
import type { SkillTrack } from './SkillTrackLabels'
import type { MitigationAssignment, Job } from '@/types/timeline'

interface TimelineCanvasProps {
  width: number
  height: number
}

export default function TimelineCanvas({ width, height }: TimelineCanvasProps) {
  const stageRef = useRef<any>(null)
  const fixedStageRef = useRef<any>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const fixedScrollContainerRef = useRef<HTMLDivElement>(null)
  const labelColumnContainerRef = useRef<HTMLDivElement>(null)
  const hasInitializedZoom = useRef(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [assignmentToDelete, setAssignmentToDelete] = useState<string | null>(null)
  const [draggingEventPosition, setDraggingEventPosition] = useState<{
    eventId: string
    x: number
  } | null>(null)

  const {
    timeline,
    zoomLevel,
    selectedEventId,
    selectedAssignmentId,
    selectEvent,
    selectAssignment,
    addAssignment,
    removeDamageEvent,
    removeAssignment,
    setZoomLevel,
  } = useTimelineStore()
  const { actions } = useMitigationStore()

  const eventResults = useDamageCalculation(timeline, actions)

  // 布局常量
  const timeRulerHeight = 30
  const eventTrackHeight = 100
  const skillTrackHeight = 40
  const labelColumnWidth = 150

  // 检查技能是否与同轨道的其他技能重叠
  const checkOverlap = (
    newTime: number,
    job: Job,
    actionId: number,
    excludeAssignmentId?: string
  ): boolean => {
    if (!timeline) return false

    const currentAction = actions.find((a) => a.id === actionId)
    if (!currentAction) return false

    const currentEndTime = newTime + currentAction.cooldown

    return timeline.mitigationAssignments.some((other) => {
      if (excludeAssignmentId && other.id === excludeAssignmentId) return false
      if (other.job !== job || other.actionId !== actionId) return false

      const otherAction = actions.find((a) => a.id === other.actionId)
      if (!otherAction) return false

      const otherEndTime = other.time + otherAction.cooldown

      return newTime < otherEndTime && other.time < currentEndTime
    })
  }

  // 同步左侧标签列和右侧时间轴的垂直滚动
  useEffect(() => {
    const scrollContainer = scrollContainerRef.current
    const labelColumnContent = labelColumnContainerRef.current

    if (!scrollContainer || !labelColumnContent) return

    const handleScroll = () => {
      const scrollTop = scrollContainer.scrollTop
      labelColumnContent.style.transform = `translateY(-${scrollTop}px)`
    }

    scrollContainer.addEventListener('scroll', handleScroll)

    return () => {
      scrollContainer.removeEventListener('scroll', handleScroll)
    }
  }, [])

  // 同步顶部固定区域和底部技能区域的水平滚动
  useEffect(() => {
    const fixedScrollContainer = fixedScrollContainerRef.current
    const scrollContainer = scrollContainerRef.current

    if (!fixedScrollContainer || !scrollContainer) return

    const handleFixedScroll = () => {
      scrollContainer.scrollLeft = fixedScrollContainer.scrollLeft
    }

    const handleScrollContainerScroll = () => {
      fixedScrollContainer.scrollLeft = scrollContainer.scrollLeft
    }

    fixedScrollContainer.addEventListener('scroll', handleFixedScroll)
    scrollContainer.addEventListener('scroll', handleScrollContainerScroll)

    return () => {
      fixedScrollContainer.removeEventListener('scroll', handleFixedScroll)
      scrollContainer.removeEventListener('scroll', handleScrollContainerScroll)
    }
  }, [])

  // 初始化缩放级别
  useEffect(() => {
    if (width > 0 && !hasInitializedZoom.current && zoomLevel === 50) {
      const defaultZoomLevel = width / 60
      setZoomLevel(defaultZoomLevel)
      hasInitializedZoom.current = true
    }
  }, [width, zoomLevel, setZoomLevel])

  // 处理键盘删除
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedEventId) {
          removeDamageEvent(selectedEventId)
        } else if (selectedAssignmentId) {
          removeAssignment(selectedAssignmentId)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedEventId, selectedAssignmentId, removeDamageEvent, removeAssignment])

  // 处理顶部固定区域的 Stage 拖动
  useEffect(() => {
    const stage = fixedStageRef.current
    const scrollContainer = fixedScrollContainerRef.current
    if (!stage || !scrollContainer) return

    let isDragging = false
    let startX = 0

    const handleStageMouseDown = (e: any) => {
      const target = e.target

      let node = target
      while (node && node !== stage) {
        if (node.attrs?.draggable) {
          return
        }
        node = node.parent
      }

      const clickedOnBackground = target === stage || target.getClassName() === 'Rect'

      if (clickedOnBackground) {
        isDragging = true
        startX = e.evt.clientX + (scrollContainer?.scrollLeft || 0)
        scrollContainer.style.cursor = 'grabbing'
      }
    }

    const handleStageMouseMove = (e: any) => {
      if (!isDragging || !scrollContainer) return

      const deltaX = startX - e.evt.clientX
      scrollContainer.scrollLeft = deltaX
    }

    const handleStageMouseUp = () => {
      isDragging = false
      if (scrollContainer) {
        scrollContainer.style.cursor = 'grab'
      }
    }

    stage.on('mousedown', handleStageMouseDown)
    stage.on('mousemove', handleStageMouseMove)
    stage.on('mouseup', handleStageMouseUp)
    stage.on('mouseleave', handleStageMouseUp)

    return () => {
      stage.off('mousedown', handleStageMouseDown)
      stage.off('mousemove', handleStageMouseMove)
      stage.off('mouseup', handleStageMouseUp)
      stage.off('mouseleave', handleStageMouseUp)
    }
  }, [timeline])

  // 处理 Stage 拖动
  useEffect(() => {
    const stage = stageRef.current
    const scrollContainer = scrollContainerRef.current
    if (!stage || !scrollContainer) return

    let isDragging = false
    let startX = 0
    let startY = 0

    const handleStageMouseDown = (e: any) => {
      const target = e.target

      let node = target
      while (node && node !== stage) {
        if (node.attrs?.draggable) {
          return
        }
        node = node.parent
      }

      const clickedOnBackground = target === stage || target.attrs?.draggableBackground === true

      if (clickedOnBackground) {
        isDragging = true
        startX = e.evt.clientX + (scrollContainer?.scrollLeft || 0)
        startY = e.evt.clientY + (scrollContainer?.scrollTop || 0)
        scrollContainer.style.cursor = 'grabbing'
      }
    }

    const handleStageMouseMove = (e: any) => {
      if (!isDragging || !scrollContainer) return

      const deltaX = startX - e.evt.clientX
      const deltaY = startY - e.evt.clientY
      scrollContainer.scrollLeft = deltaX
      scrollContainer.scrollTop = deltaY
    }

    const handleStageMouseUp = () => {
      isDragging = false
      if (scrollContainer) {
        scrollContainer.style.cursor = 'grab'
      }
    }

    const handleNativeWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        e.stopPropagation()

        const { setZoomLevel } = useTimelineStore.getState()
        const currentZoom = useTimelineStore.getState().zoomLevel
        const delta = e.deltaY > 0 ? -5 : 5
        const newZoomLevel = Math.max(10, Math.min(200, currentZoom + delta))

        setZoomLevel(newZoomLevel)
      } else {
        e.preventDefault()
        scrollContainer.scrollLeft += e.deltaY
      }
    }

    stage.on('mousedown', handleStageMouseDown)
    stage.on('mousemove', handleStageMouseMove)
    stage.on('mouseup', handleStageMouseUp)
    stage.on('mouseleave', handleStageMouseUp)

    scrollContainer.addEventListener('wheel', handleNativeWheel, { passive: false })

    return () => {
      stage.off('mousedown', handleStageMouseDown)
      stage.off('mousemove', handleStageMouseMove)
      stage.off('mouseup', handleStageMouseUp)
      stage.off('mouseleave', handleStageMouseUp)
      scrollContainer.removeEventListener('wheel', handleNativeWheel)
    }
  }, [timeline])

  // 处理拖放
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()

    const actionIdStr = e.dataTransfer.getData('actionId')
    if (!actionIdStr || !timeline || !scrollContainerRef.current) return

    const actionId = parseInt(actionIdStr, 10)
    if (isNaN(actionId)) return

    const action = actions.find((s) => s.id === actionId)
    if (!action) return

    const rect = scrollContainerRef.current.getBoundingClientRect()
    const scrollLeft = scrollContainerRef.current.scrollLeft
    const scrollTop = scrollContainerRef.current.scrollTop

    const x = e.clientX - rect.left + scrollLeft
    const y = e.clientY - rect.top + scrollTop

    const time = Math.max(0, x / zoomLevel)

    let damageEventId: string | null = null
    let minDistance = Infinity

    for (const event of timeline.damageEvents) {
      const eventX = event.time * zoomLevel
      const eventY = 100
      const distance = Math.sqrt(Math.pow(x - eventX, 2) + Math.pow(y - eventY, 2))

      if (distance < 50 && distance < minDistance) {
        minDistance = distance
        damageEventId = event.id
      }
    }

    const assignment: MitigationAssignment = {
      id: `assignment-${Date.now()}`,
      actionId,
      damageEventId: damageEventId || timeline.damageEvents[0]?.id || '',
      time: Math.round(time * 10) / 10,
      job: action.job,
    }

    addAssignment(assignment)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  // 处理双击轨道添加技能
  const handleDoubleClickTrack = (track: SkillTrack, time: number) => {
    if (!timeline) return

    if (checkOverlap(time, track.job, track.actionId)) {
      const action = actions.find((a) => a.id === track.actionId)
      toast.error('无法添加技能', {
        description: `${action?.name || '该技能'}在此时间段与其他技能冲突`,
      })
      return
    }

    const assignment: MitigationAssignment = {
      id: `assignment-${Date.now()}`,
      actionId: track.actionId,
      damageEventId: timeline.damageEvents[0]?.id || '',
      time,
      job: track.job,
    }
    addAssignment(assignment)
  }

  // 处理伤害事件拖动
  const handleEventDragEnd = (eventId: string, x: number) => {
    const newTime = Math.max(0, Math.round((x / zoomLevel) * 10) / 10)
    const { updateDamageEvent } = useTimelineStore.getState()
    updateDamageEvent(eventId, { time: newTime })
    setDraggingEventPosition(null)
  }

  // 处理减伤分配拖动
  const handleAssignmentDragEnd = (assignmentId: string, x: number) => {
    const newTime = Math.max(0, Math.round((x / zoomLevel) * 10) / 10)
    const { updateAssignment } = useTimelineStore.getState()
    updateAssignment(assignmentId, { time: newTime })
  }

  if (!timeline) {
    return (
      <div className="flex items-center justify-center bg-muted/20" style={{ width, height }}>
        <p className="text-muted-foreground">未加载时间轴</p>
      </div>
    )
  }

  // 获取阵容和技能轨道信息
  const composition = timeline.composition || { tanks: [], healers: [], dps: [] }

  const allMembers = sortJobsByOrder([
    ...(composition.tanks || []),
    ...(composition.healers || []),
    ...(composition.dps || []),
  ])

  const skillTracks: SkillTrack[] = []
  allMembers.forEach((job) => {
    const jobActions = actions.filter((action) => action.job === job)
    jobActions.forEach((action) => {
      skillTracks.push({
        job,
        actionId: action.id,
        actionName: action.name,
        actionIcon: action.icon,
      })
    })
  })

  // 计算时间轴总长度
  const maxTime = Math.max(
    ...timeline.damageEvents.map((e) => e.time),
    ...timeline.mitigationAssignments.map((a) => a.time),
    600
  )

  const timelineWidth = maxTime * zoomLevel
  const fixedAreaHeight = timeRulerHeight + eventTrackHeight
  const skillTracksHeight = skillTracks.length * skillTrackHeight

  return (
    <div className="relative flex flex-col" style={{ width, height }}>
      {/* 固定顶部区域：时间标尺 + 伤害事件轨道 */}
      <div className="flex flex-shrink-0" style={{ height: fixedAreaHeight }}>
        {/* 左侧固定标签 */}
        <div
          className="flex-shrink-0 border-r bg-background flex flex-col"
          style={{ width: labelColumnWidth }}
        >
          <div
            style={{ height: timeRulerHeight }}
            className="border-b bg-muted/30 flex items-center px-2"
          >
            <span className="text-xs text-muted-foreground">技能</span>
          </div>

          <div
            style={{ height: eventTrackHeight }}
            className="border-b bg-muted/50 flex items-center px-2"
          >
            <span className="text-xs text-muted-foreground">伤害事件</span>
          </div>
        </div>

        {/* 右侧固定 Stage 区域 */}
        <div
          ref={fixedScrollContainerRef}
          className="flex-1 overflow-x-auto overflow-y-hidden scrollbar-hide"
          style={{ cursor: 'grab' }}
        >
          <Stage
            width={Math.max(width - labelColumnWidth, timelineWidth)}
            height={fixedAreaHeight}
            ref={fixedStageRef}
            pixelRatio={window.devicePixelRatio || 2}
          >
            <Layer>
              <TimeRuler
                maxTime={maxTime}
                zoomLevel={zoomLevel}
                timelineWidth={timelineWidth}
                height={timeRulerHeight}
              />

              <DamageEventTrack
                events={timeline.damageEvents}
                eventResults={eventResults}
                selectedEventId={selectedEventId}
                zoomLevel={zoomLevel}
                timelineWidth={timelineWidth}
                trackHeight={eventTrackHeight}
                yOffset={timeRulerHeight}
                onSelectEvent={selectEvent}
                onDragStart={(eventId, x) => setDraggingEventPosition({ eventId, x })}
                onDragMove={(eventId, x) => {
                  setDraggingEventPosition({ eventId, x })
                }}
                onDragEnd={handleEventDragEnd}
              />
            </Layer>
          </Stage>
        </div>
      </div>

      {/* 可滚动区域：技能轨道 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左侧技能标签 */}
        <div
          className="flex-shrink-0 border-r bg-background overflow-hidden"
          style={{ width: labelColumnWidth }}
        >
          <div ref={labelColumnContainerRef} style={{ height: skillTracksHeight }}>
            <SkillTrackLabels skillTracks={skillTracks} trackHeight={skillTrackHeight} />
          </div>
        </div>

        {/* 右侧技能轨道 Stage */}
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-auto scrollbar-custom"
          style={{ cursor: 'grab' }}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
        >
          <Stage
            width={Math.max(width - labelColumnWidth, timelineWidth)}
            height={skillTracksHeight}
            ref={stageRef}
            pixelRatio={window.devicePixelRatio || 2}
          >
            <SkillTracksCanvas
              timeline={timeline}
              skillTracks={skillTracks}
              actions={actions}
              zoomLevel={zoomLevel}
              timelineWidth={timelineWidth}
              trackHeight={skillTrackHeight}
              maxTime={maxTime}
              selectedAssignmentId={selectedAssignmentId}
              draggingEventPosition={draggingEventPosition}
              onSelectAssignment={selectAssignment}
              onUpdateAssignment={handleAssignmentDragEnd}
              onContextMenu={(assignmentId) => {
                setAssignmentToDelete(assignmentId)
                setDeleteConfirmOpen(true)
              }}
              onDoubleClickTrack={handleDoubleClickTrack}
            />
          </Stage>
        </div>
      </div>

      {/* 删除确认对话框 */}
      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        onConfirm={() => {
          if (assignmentToDelete) {
            removeAssignment(assignmentToDelete)
            setAssignmentToDelete(null)
          }
        }}
        title="删除减伤分配"
        description="确定要删除这个减伤分配吗?"
      />
    </div>
  )
}
