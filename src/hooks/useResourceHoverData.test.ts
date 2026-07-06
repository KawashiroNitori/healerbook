// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useResourceHoverData } from './useResourceHoverData'
import { useTimelineStore } from '@/store/timelineStore'

describe('useResourceHoverData', () => {
  beforeEach(() => {
    useTimelineStore.setState({ timeline: null })
  })

  it('无 timeline 时 getSnapshotAt 返回空数组', () => {
    const { result } = renderHook(() => useResourceHoverData())
    expect(result.current.getSnapshotAt(0)).toEqual([])
  })
})
