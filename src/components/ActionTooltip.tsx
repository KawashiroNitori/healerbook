/**
 * 技能悬浮提示窗组件
 * 显示技能的详细信息
 */

import { useLayoutEffect, useRef, useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getIconUrl } from '@/utils/iconUtils'
import type { MitigationAction } from '@/types/mitigation'
import { getActionById } from '@/api/xivapi'
import JobIcon from './JobIcon'
import type { TooltipPlacement } from '@/store/tooltipStore'

interface ActionTooltipProps {
  action: MitigationAction | null
  anchorRect: DOMRect | null
  placementPriority?: TooltipPlacement[]
  noTransition?: boolean
  onMouseEnter: () => void
  onMouseLeave: () => void
}

export default function ActionTooltip({
  action,
  anchorRect,
  placementPriority = ['r', 'l', 'b', 't'],
  noTransition = false,
  onMouseEnter,
  onMouseLeave,
}: ActionTooltipProps) {
  // 保留上一次非 null 的数据，用于退出动画期间继续渲染
  const [displayedData, setDisplayedData] = useState<{
    action: MitigationAction
    anchorRect: DOMRect
  } | null>(null)

  // 内部管理可见状态
  const [isVisible, setIsVisible] = useState(false)
  const [isPositioned, setIsPositioned] = useState(false)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const checkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const showTimeRef = useRef<number>(0)

  // 渲染期派生状态更新（React 推荐的 "adjusting state when props change" 模式）
  // 当 action/anchorRect 改变时同步更新，避免在 effect 中调用 setState
  const [prevAction, setPrevAction] = useState(action)
  const [prevAnchorRect, setPrevAnchorRect] = useState(anchorRect)
  if (action !== prevAction || anchorRect !== prevAnchorRect) {
    setPrevAction(action)
    setPrevAnchorRect(anchorRect)
    if (action !== null && anchorRect !== null) {
      setDisplayedData({ action, anchorRect })
      setIsVisible(true)
      setIsPositioned(false)
    } else {
      setIsVisible(false)
      if (noTransition) setDisplayedData(null)
    }
  }

  useEffect(() => {
    if (action !== null && anchorRect !== null) {
      // 记录显示时间，供 interval 判断宽限期
      showTimeRef.current = Date.now()

      // 启动鼠标位置检测
      if (checkIntervalRef.current) clearInterval(checkIntervalRef.current)
      checkIntervalRef.current = setInterval(() => {
        if (!tooltipRef.current) return

        // 给 200ms 宽限期，让鼠标有时间移到悬浮窗
        if (Date.now() - showTimeRef.current < 200) return

        // 获取鼠标位置
        const win = window as Window & { lastMouseX?: number; lastMouseY?: number }
        const mouseX = win.lastMouseX ?? 0
        const mouseY = win.lastMouseY ?? 0

        // 检查鼠标是否在悬浮窗内或触发元素上
        const element = document.elementFromPoint(mouseX, mouseY)
        if (!element) {
          setIsVisible(false)
          if (checkIntervalRef.current) {
            clearInterval(checkIntervalRef.current)
            checkIntervalRef.current = null
          }
          return
        }

        const isInTooltip = tooltipRef.current.contains(element)
        // 检查是否在原始触发区域（anchorRect）内
        const isInAnchor =
          mouseX >= anchorRect.left &&
          mouseX <= anchorRect.right &&
          mouseY >= anchorRect.top &&
          mouseY <= anchorRect.bottom

        if (!isInTooltip && !isInAnchor) {
          setIsVisible(false)
          if (checkIntervalRef.current) {
            clearInterval(checkIntervalRef.current)
            checkIntervalRef.current = null
          }
        }
      }, 200)
    } else {
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current)
        checkIntervalRef.current = null
      }
    }

    return () => {
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current)
        checkIntervalRef.current = null
      }
    }
  }, [action, anchorRect])

  // 全局鼠标位置追踪
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const win = window as Window & { lastMouseX?: number; lastMouseY?: number }
      win.lastMouseX = e.clientX
      win.lastMouseY = e.clientY
    }
    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [])

  const { data: apiData, isLoading } = useQuery({
    queryKey: ['action', displayedData?.action.id ?? 0],
    queryFn: () => getActionById(displayedData!.action.id),
    enabled: displayedData !== null,
    staleTime: 1000 * 60 * 60 * 24,
    gcTime: 1000 * 60 * 60 * 24,
    retry: 2,
  })

  const [position, setPosition] = useState<{ left: number; top: number }>({
    left: -9999,
    top: -9999,
  })

  useLayoutEffect(() => {
    if (!tooltipRef.current || !displayedData) return
    const { anchorRect } = displayedData
    const tooltipWidth = tooltipRef.current.offsetWidth
    const tooltipHeight = tooltipRef.current.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight

    const fits = {
      b: anchorRect.bottom + tooltipHeight <= vh,
      t: anchorRect.top - tooltipHeight >= 0,
      r: anchorRect.right + tooltipWidth <= vw,
      l: anchorRect.left - tooltipWidth >= 0,
    }

    const place = (p: (typeof placementPriority)[number]) => {
      if (p === 'b') {
        const left = Math.max(0, Math.min(anchorRect.left, vw - tooltipWidth))
        setPosition({ left, top: anchorRect.bottom })
      } else if (p === 't') {
        const left = Math.max(0, Math.min(anchorRect.left, vw - tooltipWidth))
        setPosition({ left, top: anchorRect.top - tooltipHeight })
      } else if (p === 'r') {
        const top = Math.max(0, Math.min(anchorRect.top, vh - tooltipHeight))
        setPosition({ left: anchorRect.right, top })
      } else {
        const top = Math.max(0, Math.min(anchorRect.top, vh - tooltipHeight))
        setPosition({ left: anchorRect.left - tooltipWidth, top })
      }
      setIsPositioned(true)
    }

    for (const p of placementPriority) {
      if (fits[p]) {
        place(p)
        return
      }
    }
    // 全部放不下时用第一优先级
    place(placementPriority[0])
  }, [displayedData, isLoading, apiData, placementPriority])

  if (!displayedData) return null

  const { action: displayedAction } = displayedData

  return (
    <div
      ref={tooltipRef}
      className={cn(
        'fixed z-[9999]',
        !noTransition && 'transition-opacity duration-150',
        isVisible && isPositioned ? 'opacity-100' : 'opacity-0'
      )}
      style={{
        left: `${position.left}px`,
        top: `${position.top}px`,
        transform: isVisible && isPositioned ? 'scale(1)' : 'scale(0.95)',
        transition: noTransition ? 'none' : 'opacity 150ms, transform 150ms',
      }}
      onTransitionEnd={() => {
        if (!isVisible) setDisplayedData(null)
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="bg-[#1a1a1a] border border-[#3a3a3a] rounded-lg shadow-2xl text-white w-[400px] drop-shadow-[0_8px_24px_rgba(0,0,0,0.8)] select-none">
        {isLoading ? (
          <div className="p-3 flex items-center justify-center gap-2 text-sm text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            加载中...
          </div>
        ) : apiData ? (
          <div className="p-3 space-y-3">
            {/* 前两行：图标占两行高度 + 技能名/类型 + 距离/范围 */}
            <div className="flex items-start gap-3">
              {/* 图标自适应右侧内容高度 */}
              <div className="self-stretch aspect-square flex-shrink-0 min-w-[40px] min-h-[40px] rounded overflow-hidden bg-[#2a2a2a] border border-[#4a4a4a]">
                <img
                  src={getIconUrl(apiData.Icon || displayedAction.icon)}
                  alt={apiData.Name || displayedAction.name}
                  className="w-full h-full object-cover"
                />
              </div>

              {/* 中间内容：技能名 / ActionCategory */}
              <div className="flex-1 flex flex-col gap-1 min-w-0">
                <div className="text-base font-semibold truncate">
                  {apiData.Name || displayedAction.name}
                </div>
                <div className="text-xs text-gray-400">
                  {apiData.ActionCategory?.Name || '能力'}
                </div>
              </div>

              {/* 右侧：距离 / 范围（网格对齐） */}
              <div className="grid grid-cols-[auto_auto] gap-x-1 text-xs flex-shrink-0 self-start">
                {apiData.Range > 0 && (
                  <>
                    <span className="text-gray-400">距离</span>
                    <span className="text-white text-right">{apiData.Range}米</span>
                  </>
                )}
                {apiData.EffectRange > 0 && (
                  <>
                    <span className="text-gray-400">范围</span>
                    <span className="text-white text-right">{apiData.EffectRange}米</span>
                  </>
                )}
              </div>
            </div>

            {/* 第三行：咏唱时间 CD 耗魔（均匀分布占满整行） */}
            <div className="flex text-right gap-3">
              <div className="flex-1">
                <div className="text-[10px] text-gray-400">咏唱时间</div>
                <div className="text-base text-white font-medium pr-1">
                  {apiData.Cast100ms === 0 ? '即时' : `${apiData.Cast100ms / 10}s`}
                </div>
                <div className="h-1 rounded-full bg-[#3a3a3a] -mt-2" />
              </div>
              <div className="flex-1">
                <div className="text-[10px] text-gray-400">复唱时间</div>
                <div className="text-base text-white font-medium pr-1">
                  {apiData.Recast100ms / 10}s
                </div>
                <div className="h-1 rounded-full bg-[#3a3a3a] -mt-2" />
              </div>
              <div className="flex-1">
                {apiData.PrimaryCostType === 3 && apiData.PrimaryCostValue > 0 && (
                  <>
                    <div className="text-[10px] text-gray-400">消耗魔力</div>
                    <div className="text-base text-white font-medium pr-1">
                      {apiData.PrimaryCostValue * 100}
                    </div>
                    <div className="h-1 rounded-full bg-[#3a3a3a] -mt-2" />
                  </>
                )}
              </div>
            </div>

            {/* 技能描述 */}
            {apiData.Description && (
              <div className="pt-2 border-t border-[#3a3a3a]">
                <div
                  className="text-xs text-gray-300 leading-relaxed whitespace-pre-line"
                  dangerouslySetInnerHTML={{
                    __html: apiData.Description.replace(/\n/g, '<br/>'),
                  }}
                />
              </div>
            )}

            {/* 习得条件 + 适用职业 */}
            <div className="pt-2 border-t border-[#3a3a3a] space-y-1">
              <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs items-center">
                <span className="text-gray-400">习得条件</span>
                <span className="text-white">{apiData.ClassJobLevel}级</span>
                <span className="text-gray-400">适用职业</span>
                <div className="flex flex-wrap gap-1">
                  {displayedAction.jobs.map(job => (
                    <JobIcon key={job} job={job} size="sm" />
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-3 text-center text-sm text-gray-400">加载失败</div>
        )}
      </div>
    </div>
  )
}
