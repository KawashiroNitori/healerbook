/**
 * 时间轴 Canvas 组件
 */

import { useRef, useEffect, useState } from 'react'
import { Stage, Layer, Rect, Line, Text, Group, Image as KonvaImage } from 'react-konva'
import { useTimelineStore } from '@/store/timelineStore'
import { useMitigationStore } from '@/store/mitigationStore'
import { getIconUrl } from '@/utils/iconUtils'
import { sortJobsByOrder } from '@/data/jobs'
import { useKonvaImage } from '@/utils/useKonvaImage'
import { useDamageCalculation } from '@/hooks/useDamageCalculation'
import { toast } from 'sonner'
import JobIcon from './JobIcon'
import ConfirmDialog from './ConfirmDialog'
import type { MitigationAssignment, Job } from '@/types/timeline'

// 技能图标子组件
function SkillIcon({ iconPath, isSelected }: { iconPath: string; isSelected: boolean }) {
  const image = useKonvaImage(iconPath)

  if (!image) {
    // 加载中或加载失败，显示占位符
    return (
      <>
        <Rect
          x={0}
          y={-15}
          width={30}
          height={30}
          fill="#e5e7eb"
          cornerRadius={4}
          shadowEnabled={false}
          perfectDrawEnabled={false}
        />
      </>
    )
  }

  return (
    <>
      <KonvaImage
        image={image}
        x={0}
        y={-15}
        width={30}
        height={30}
        cornerRadius={4}
      />
      {isSelected && (
        <Rect
          x={0}
          y={-15}
          width={30}
          height={30}
          stroke="#3b82f6"
          strokeWidth={2}
          cornerRadius={4}
          shadowEnabled={false}
          perfectDrawEnabled={false}
        />
      )}
    </>
  )
}

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
  // 跟踪拖动中的事件位置
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

  // 使用统一的伤害计算 Hook
  const eventResults = useDamageCalculation(timeline, actions)

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

    // 技能占用时间 = 冷却时间（从使用时刻到冷却结束）
    const currentEndTime = newTime + currentAction.cooldown

    return timeline.mitigationAssignments.some((other) => {
      if (excludeAssignmentId && other.id === excludeAssignmentId) return false // 跳过自己
      if (other.job !== job || other.actionId !== actionId) return false // 不同轨道

      const otherAction = actions.find((a) => a.id === other.actionId)
      if (!otherAction) return false

      // 其他技能的占用时间 = 冷却时间
      const otherEndTime = other.time + otherAction.cooldown

      // 检查时间区间是否重叠
      // 两个区间 [a1, a2] 和 [b1, b2] 重叠的条件是：a1 < b2 && b1 < a2
      return newTime < otherEndTime && other.time < currentEndTime
    })
  }

  // 布局常量
  const timeRulerHeight = 30
  const eventTrackHeight = 100
  const skillTrackHeight = 40
  const labelColumnWidth = 150

  // 同步左侧标签列和右侧时间轴的垂直滚动
  useEffect(() => {
    const scrollContainer = scrollContainerRef.current
    const labelColumnContent = labelColumnContainerRef.current

    if (!scrollContainer || !labelColumnContent) return

    const handleScroll = () => {
      // 使用 transform 移动左侧标签列内容
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

  // 初始化缩放级别：一屏显示 1 分钟（60 秒）
  // 只在首次加载且 zoomLevel 为默认值 50 时设置
  useEffect(() => {
    if (width > 0 && !hasInitializedZoom.current && zoomLevel === 50) {
      const defaultZoomLevel = width / 60 // 像素/秒
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

      // 检查是否点击了可拖动的元素（伤害事件）
      let node = target
      while (node && node !== stage) {
        if (node.attrs?.draggable) {
          // 点击了可拖动的元素，不触发 Stage 拖动
          return
        }
        node = node.parent
      }

      // 只有点击背景时才触发 Stage 拖动
      const clickedOnBackground =
        target === stage ||
        target.getClassName() === 'Rect'

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

      // 检查是否点击了可拖动的元素（减伤分配）
      let node = target
      while (node && node !== stage) {
        if (node.attrs?.draggable) {
          // 点击了可拖动的元素，不触发 Stage 拖动
          return
        }
        node = node.parent
      }

      // 检查是否点击了标记为可拖动的背景元素
      const clickedOnBackground =
        target === stage ||
        target.attrs?.draggableBackground === true

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

    // 处理滚轮事件（使用原生事件监听器以更好地控制）
    const handleNativeWheel = (e: WheelEvent) => {
      // 按住 Ctrl/Cmd 时进行缩放
      if (e.ctrlKey || e.metaKey) {
        // 阻止浏览器的默认缩放行为
        e.preventDefault()
        e.stopPropagation()

        const { setZoomLevel } = useTimelineStore.getState()
        const currentZoom = useTimelineStore.getState().zoomLevel
        const delta = e.deltaY > 0 ? -5 : 5
        const newZoomLevel = Math.max(10, Math.min(200, currentZoom + delta))

        setZoomLevel(newZoomLevel)
      } else {
        // 不按 Ctrl 时，将垂直滚动转换为水平滚动
        e.preventDefault()
        scrollContainer.scrollLeft += e.deltaY
      }
    }

    stage.on('mousedown', handleStageMouseDown)
    stage.on('mousemove', handleStageMouseMove)
    stage.on('mouseup', handleStageMouseUp)
    stage.on('mouseleave', handleStageMouseUp)

    // 添加原生滚轮事件监听器，使用 passive: false 确保可以阻止默认行为
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

    // 获取技能信息
    const action = actions.find((s) => s.id === actionId)
    if (!action) return

    // 获取容器的位置和滚动偏移
    const rect = scrollContainerRef.current.getBoundingClientRect()
    const scrollLeft = scrollContainerRef.current.scrollLeft
    const scrollTop = scrollContainerRef.current.scrollTop

    // 计算相对于 Canvas 的坐标
    const x = e.clientX - rect.left + scrollLeft
    const y = e.clientY - rect.top + scrollTop

    // 转换为时间
    const time = Math.max(0, x / zoomLevel)

    // 查找最近的伤害事件
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

    // 创建减伤分配
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

  if (!timeline) {
    return (
      <div
        className="flex items-center justify-center bg-muted/20"
        style={{ width, height }}
      >
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

  // 为每个队员的每个技能创建轨道
  interface SkillTrack {
    job: Job
    actionId: number
    actionName: string
    actionIcon: string
  }

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

  // 计算时间轴总长度 (秒)
  const maxTime = Math.max(
    ...timeline.damageEvents.map((e) => e.time),
    ...timeline.mitigationAssignments.map((a) => a.time),
    600 // 最小 10 分钟
  )

  const timelineWidth = maxTime * zoomLevel
  const timeRulerStartY = 0 // 时间标尺起始位置
  const eventTrackStartY = timeRulerHeight // 伤害事件轨道起始位置
  const skillTracksStartY = timeRulerHeight + eventTrackHeight // 技能轨道起始位置
  const totalHeight = skillTracksStartY + skillTracks.length * skillTrackHeight // 总高度
  const fixedAreaHeight = timeRulerHeight + eventTrackHeight // 固定区域高度（时间标尺 + 伤害事件）
  const skillTracksHeight = skillTracks.length * skillTrackHeight // 技能轨道区域高度

  return (
    <div className="relative flex flex-col" style={{ width, height }}>
      {/* 固定顶部区域：时间标尺 + 伤害事件轨道 */}
      <div className="flex flex-shrink-0" style={{ height: fixedAreaHeight }}>
        {/* 左侧固定标签 */}
        <div
          className="flex-shrink-0 border-r bg-background flex flex-col"
          style={{ width: labelColumnWidth }}
        >
          {/* 时间标尺占位 */}
          <div
            style={{ height: timeRulerHeight }}
            className="border-b bg-muted/30 flex items-center px-2"
          >
            <span className="text-xs text-muted-foreground">技能</span>
          </div>

          {/* 伤害事件轨道占位 */}
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
              {/* 时间标尺轨道背景 */}
              <Rect
                x={0}
                y={0}
                width={timelineWidth}
                height={timeRulerHeight}
                fill="#f3f4f6"
              />

              {/* 时间标尺刻度 */}
              {Array.from({ length: Math.ceil(maxTime / 10) + 1 }).map((_, i) => {
                const time = i * 10
                const x = time * zoomLevel
                return (
                  <Group key={`ruler-${i}`}>
                    <Line
                      points={[x, 0, x, timeRulerHeight]}
                      stroke="#d1d5db"
                      strokeWidth={1}
                    />
                    <Text
                      x={x + 4}
                      y={8}
                      text={`${Math.floor(time / 60)}:${String(time % 60).padStart(2, '0')}`}
                      fontSize={12}
                      fill="#6b7280"
                      fontFamily="Arial, sans-serif"
                      perfectDrawEnabled={false}
                      listening={false}
                    />
                  </Group>
                )
              })}

              {/* 伤害事件轨道背景 */}
              <Rect
                x={0}
                y={timeRulerHeight}
                width={timelineWidth}
                height={eventTrackHeight}
                fill="#e5e7eb"
              />

              {/* 伤害事件 */}
              {[...timeline.damageEvents]
                .sort((a, b) => a.time - b.time) // 按时间排序，早发生的先渲染（在底层）
                .map((event) => {
                  const x = event.time * zoomLevel
                  const isSelected = selectedEventId === event.id

                  // 使用预先计算的结果
                  const result = eventResults.get(event.id)
                  if (!result) return null

                  const finalDamage = result.finalDamage
                  const mitigationPercent = result.mitigationPercentage.toFixed(1)

                  // 伤害类型映射
                  const damageTypeMap: Record<string, string> = {
                    physical: '物理',
                    magical: '魔法',
                    special: '特殊',
                  }
                  const damageTypeText = damageTypeMap[event.damageType || 'physical'] || '物理'

                return (
                  <Group
                    key={event.id}
                    x={x}
                    y={timeRulerHeight + eventTrackHeight / 2}
                    draggable
                    dragBoundFunc={(pos) => {
                      // 只允许水平拖动
                      return {
                        x: Math.max(0, pos.x),
                        y: timeRulerHeight + eventTrackHeight / 2,
                      }
                    }}
                    onClick={() => selectEvent(event.id)}
                    onTap={() => selectEvent(event.id)}
                    onDragStart={() => {
                      // 开始拖动时记录初始位置
                      setDraggingEventPosition({
                        eventId: event.id,
                        x: event.time * zoomLevel,
                      })
                    }}
                    onDragMove={(e) => {
                      // 拖动过程中实时更新位置
                      const newX = e.target.x()
                      setDraggingEventPosition({
                        eventId: event.id,
                        x: newX,
                      })
                      e.target.getStage()?.batchDraw()
                    }}
                    onDragEnd={(e) => {
                      const newX = e.target.x()
                      const newTime = Math.max(0, Math.round((newX / zoomLevel) * 10) / 10)
                      const { updateDamageEvent } = useTimelineStore.getState()
                      updateDamageEvent(event.id, { time: newTime })
                      e.target.x(newTime * zoomLevel)
                      // 清除拖动状态
                      setDraggingEventPosition(null)
                    }}
                  >
                    {/* 移除这里的虚线，放回技能区域 */}

                    {/* 白色背景矩形 */}
                    <Rect
                      x={0}
                      y={-40}
                      width={150}
                      height={80}
                      fill="#ffffff"
                      stroke={isSelected ? '#3b82f6' : '#d1d5db'}
                      strokeWidth={isSelected ? 2 : 1}
                      cornerRadius={4}
                      shadowEnabled={false}
                      perfectDrawEnabled={false}
                    />

                    {/* 伤害名称 */}
                    <Text
                      x={5}
                      y={-35}
                      width={140}
                      text={event.name}
                      fontSize={14}
                      fill="#000000"
                      fontStyle="bold"
                      fontFamily="Arial, sans-serif"
                      wrap="none"
                      ellipsis={true}
                      perfectDrawEnabled={false}
                      listening={false}
                    />

                    {/* 原始伤害 */}
                    <Text
                      x={5}
                      y={-18}
                      text={`原始: ${event.damage.toLocaleString()}`}
                      fontSize={12}
                      fill="#6b7280"
                      fontFamily="Arial, sans-serif"
                      perfectDrawEnabled={false}
                      listening={false}
                    />

                    {/* 最终伤害 */}
                    <Text
                      x={5}
                      y={0}
                      text={`最终: ${finalDamage.toLocaleString()}`}
                      fontSize={12}
                      fill="#10b981"
                      fontStyle="bold"
                      fontFamily="Arial, sans-serif"
                      perfectDrawEnabled={false}
                      listening={false}
                    />

                    {/* 减伤比例 */}
                    <Text
                      x={5}
                      y={18}
                      text={`减伤: ${mitigationPercent}%`}
                      fontSize={12}
                      fill="#ef4444"
                      fontFamily="Arial, sans-serif"
                      perfectDrawEnabled={false}
                      listening={false}
                    />

                    {/* 右上角伤害类型 */}
                    <Text
                      x={125}
                      y={-35}
                      text={damageTypeText}
                      fontSize={11}
                      fill="#9ca3af"
                      fontFamily="Arial, sans-serif"
                      align="right"
                      perfectDrawEnabled={false}
                      listening={false}
                    />
                  </Group>
                )
              })}
            </Layer>
          </Stage>
        </div>
      </div>

      {/* 可滚动区域：技能轨道 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左侧技能标签（不可滚动，通过同步移动） */}
        <div
          className="flex-shrink-0 border-r bg-background overflow-hidden"
          style={{ width: labelColumnWidth }}
        >
          <div ref={labelColumnContainerRef} style={{ height: skillTracksHeight }}>
            {/* 技能轨道标签 */}
            {skillTracks.map((track, index) => (
              <div
                key={`label-${track.job}-${track.actionId}`}
                style={{ height: skillTrackHeight }}
                className={`border-b flex items-center gap-2 px-2 ${
                  index % 2 === 0 ? 'bg-background' : 'bg-muted/20'
                }`}
              >
                {/* 职业图标 */}
                <div className="opacity-60">
                  <JobIcon job={track.job as Job} size="sm" />
                </div>
                {/* 技能图标 */}
                <img
                  src={getIconUrl(track.actionIcon)}
                  alt={track.actionName}
                  className="w-6 h-6 rounded"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none'
                  }}
                />
                {/* 技能名称 */}
                <span className="text-xs truncate flex-1">{track.actionName}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 右侧技能轨道 Stage（可滚动） */}
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
            <Layer>
              {/* 技能轨道背景（可双击添加技能） */}
              {skillTracks.map((track, index) => (
                <Rect
                  key={`track-bg-${track.job}-${track.actionId}`}
                  x={0}
                  y={index * skillTrackHeight}
                  width={timelineWidth}
                  height={skillTrackHeight}
                  fill={index % 2 === 0 ? '#fafafa' : '#ffffff'}
                  draggableBackground={true}
                  onDblClick={(e) => {
                    // 双击添加技能
                    const stage = e.target.getStage()
                    if (!stage) return

                    const pointerPos = stage.getPointerPosition()
                    if (!pointerPos) return

                    const time = Math.round((pointerPos.x / zoomLevel) * 10) / 10

                    // 检查是否与同轨道的其他技能重叠
                    if (checkOverlap(time, track.job, track.actionId)) {
                      // 有重叠，显示提示
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
                  }}
                />
              ))}

              {/* 技能轨道分隔线 */}
              {skillTracks.map((track, index) => (
                <Line
                  key={`track-line-${track.job}-${track.actionId}`}
                  points={[
                    0,
                    (index + 1) * skillTrackHeight,
                    timelineWidth,
                    (index + 1) * skillTrackHeight,
                  ]}
                  stroke="#e5e7eb"
                  strokeWidth={1}
                />
              ))}

              {/* 网格（仅垂直线） */}
              {Array.from({ length: Math.ceil(maxTime / 10) + 1 }).map((_, i) => {
                const time = i * 10
                const x = time * zoomLevel
                return (
                  <Line
                    key={`grid-${i}`}
                    points={[x, 0, x, skillTracksHeight]}
                    stroke="#f3f4f6"
                    strokeWidth={1}
                  />
                )
              })}
            </Layer>

            {/* 减伤分配层 */}
            <Layer>
              {/* 伤害事件时刻的红色虚线 */}
              {timeline.damageEvents.map((event) => {
                // 如果事件正在被拖动，使用拖动中的位置
                const x =
                  draggingEventPosition?.eventId === event.id
                    ? draggingEventPosition.x
                    : event.time * zoomLevel

                return (
                  <Line
                    key={`damage-line-${event.id}`}
                    points={[x, 0, x, skillTracksHeight]}
                    stroke="#ef4444"
                    strokeWidth={2}
                    dash={[5, 5]}
                    shadowEnabled={false}
                    perfectDrawEnabled={false}
                    listening={false}
                  />
                )
              })}

              {timeline.mitigationAssignments.map((assignment) => {
                // 找到对应的轨道索引
                const trackIndex = skillTracks.findIndex(
                  (t) => t.job === assignment.job && t.actionId === assignment.actionId
                )

                if (trackIndex === -1) return null

                const x = assignment.time * zoomLevel
                const y = trackIndex * skillTrackHeight + skillTrackHeight / 2
                const isSelected = assignment.id === selectedAssignmentId

                const action = actions.find((a) => a.id === assignment.actionId)
                if (!action) return null

                // 计算拖动边界
                // 找到同轨道的其他技能，计算可拖动的范围
                const sameTrackAssignments = timeline.mitigationAssignments
                  .filter(
                    (other) =>
                      other.id !== assignment.id &&
                      other.job === assignment.job &&
                      other.actionId === assignment.actionId
                  )
                  .map((other) => {
                    const otherAction = actions.find((a) => a.id === other.actionId)
                    return {
                      startTime: other.time,
                      // 实际结束时间 = 开始时间 + 冷却时间（冷却时间条的右边缘）
                      endTime: other.time + (otherAction?.cooldown || 0),
                    }
                  })
                  .sort((a, b) => a.startTime - b.startTime)

                // 当前技能的实际占用时长 = 冷却时间
                const currentDuration = action.cooldown

                // 找到左边界：左侧最近的技能的结束时间
                const leftBoundary = sameTrackAssignments
                  .filter((other) => other.endTime <= assignment.time)
                  .reduce((max, other) => Math.max(max, other.endTime), 0)

                // 找到右边界：右侧最近的技能的开始时间 - 当前技能的占用时长
                const rightBoundary = sameTrackAssignments
                  .filter((other) => other.startTime >= assignment.time + currentDuration)
                  .reduce(
                    (min, other) => Math.min(min, other.startTime - currentDuration),
                    Infinity
                  )

                return (
                  <Group
                    key={assignment.id}
                    x={x}
                    y={y}
                    draggable
                    dragBoundFunc={(pos) => {
                      // 限制拖动范围：不能超出左右边界
                      const minX = leftBoundary * zoomLevel
                      const maxX =
                        rightBoundary === Infinity ? pos.x : rightBoundary * zoomLevel

                      return {
                        x: Math.max(minX, Math.min(maxX, pos.x)),
                        y,
                      }
                    }}
                    onClick={() => selectAssignment(assignment.id)}
                    onTap={() => selectAssignment(assignment.id)}
                    onDragEnd={(e) => {
                      const newX = e.target.x()
                      const newTime = Math.max(0, Math.round((newX / zoomLevel) * 10) / 10)

                      // 更新位置（边界已在 dragBoundFunc 中限制）
                      const { updateAssignment } = useTimelineStore.getState()
                      updateAssignment(assignment.id, { time: newTime })
                      e.target.x(newTime * zoomLevel)
                    }}
                    onContextMenu={(e) => {
                      // 右键删除
                      e.evt.preventDefault()
                      setAssignmentToDelete(assignment.id)
                      setDeleteConfirmOpen(true)
                    }}
                  >
                    {/* 持续时间条（从图标内部开始，填充圆角缺口，绿色，无圆角） */}
                    {action && action.duration > 0 && (
                      <Rect
                        x={26}
                        y={-15}
                        width={Math.max(0, action.duration * zoomLevel - 26)}
                        height={30}
                        fill="#10b981"
                        opacity={0.3}
                        shadowEnabled={false}
                        perfectDrawEnabled={false}
                      />
                    )}

                    {/* 冷却时间条（持续时间条右侧，蓝色，无圆角） */}
                    {action && action.cooldown > 0 && (
                      <Rect
                        x={action.duration * zoomLevel}
                        y={-15}
                        width={Math.max(0, action.cooldown * zoomLevel - action.duration * zoomLevel)}
                        height={30}
                        fill="#3b82f6"
                        opacity={0.2}
                        shadowEnabled={false}
                        perfectDrawEnabled={false}
                      />
                    )}

                    {/* 技能图标（最后渲染，确保在最上层，左边缘对齐生效时刻） */}
                    {action ? (
                      <SkillIcon iconPath={action.icon} isSelected={isSelected} />
                    ) : (
                      <>
                        {/* 降级方案 */}
                        <Rect
                          x={0}
                          y={-15}
                          width={30}
                          height={30}
                          fill={isSelected ? '#3b82f6' : '#ef4444'}
                          cornerRadius={4}
                          shadowEnabled={false}
                          perfectDrawEnabled={false}
                        />
                        <Text
                          x={0}
                          y={-8}
                          width={30}
                          text={assignment.job}
                          fontSize={10}
                          fill="#ffffff"
                          align="center"
                          fontStyle="bold"
                          fontFamily="Arial, sans-serif"
                          perfectDrawEnabled={false}
                          listening={false}
                        />
                      </>
                    )}
                  </Group>
                )
              })}
            </Layer>
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
        description="确定要删除这个减伤分配吗？"
      />
    </div>
  )
}
