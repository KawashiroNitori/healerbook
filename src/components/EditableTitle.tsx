/**
 * 可编辑标题组件
 */

import { useState, useRef, useEffect } from 'react'
import { Check, X, Pencil } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface EditableTitleProps {
  value: string
  onChange: (value: string) => void
  className?: string
}

export default function EditableTitle({ value, onChange, className = '' }: EditableTitleProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)
  const spanRef = useRef<HTMLSpanElement>(null)
  const [inputWidth, setInputWidth] = useState(200)

  // 同步外部 value 变化
  useEffect(() => {
    setEditValue(value)
  }, [value])

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  useEffect(() => {
    // 根据文本内容动态计算宽度
    if (spanRef.current) {
      setInputWidth(Math.max(200, spanRef.current.offsetWidth + 20))
    }
  }, [editValue, isEditing])

  const handleSave = () => {
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== value) {
      onChange(trimmed)
    } else {
      setEditValue(value)
    }
    setIsEditing(false)
  }

  const handleCancel = () => {
    setEditValue(value)
    setIsEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave()
    } else if (e.key === 'Escape') {
      handleCancel()
    }
  }

  if (isEditing) {
    return (
      <div className="flex items-center gap-2 h-7">
        {/* 隐藏的 span 用于测量文本宽度 */}
        <span
          ref={spanRef}
          className={`invisible absolute whitespace-pre ${className}`}
          aria-hidden="true"
        >
          {editValue || value}
        </span>
        <input
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={e => setEditValue(e.target.value)}
          maxLength={50}
          onKeyDown={handleKeyDown}
          style={{ width: `${inputWidth}px` }}
          className="px-1 h-7 border rounded-md text-sm"
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleSave}
              className="p-0.5 hover:bg-accent rounded-md transition-colors"
            >
              <Check className="w-4 h-4 text-green-600" />
            </button>
          </TooltipTrigger>
          <TooltipContent>保存</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleCancel}
              className="p-0.5 hover:bg-accent rounded-md transition-colors"
            >
              <X className="w-4 h-4 text-red-600" />
            </button>
          </TooltipTrigger>
          <TooltipContent>取消</TooltipContent>
        </Tooltip>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 h-7 group">
      <h1 className={className}>{value}</h1>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => setIsEditing(true)}
            className="p-1 opacity-0 group-hover:opacity-100 hover:bg-accent rounded-md transition-all"
          >
            <Pencil className="w-4 h-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent>编辑标题</TooltipContent>
      </Tooltip>
    </div>
  )
}
