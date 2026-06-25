// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useResourceHoverData } from './useResourceHoverData'
import { useTimelineStore } from '@/store/timelineStore'
import { useMitigationStore } from '@/store/mitigationStore'

describe('useResourceHoverData', () => {
  beforeEach(() => {
    useTimelineStore.setState({ timeline: null })
    useMitigationStore.getState().loadActions()
  })

  it('无 timeline 时 getSnapshotAt 返回空数组', () => {
    const { result } = renderHook(() => useResourceHoverData())
    expect(result.current.getSnapshotAt(0)).toEqual([])
  })
})
