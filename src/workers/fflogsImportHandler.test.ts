/**
 * FFLogs 导入处理器单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { handleFFLogsImport } from './fflogsImportHandler'
import type { Env } from './fflogs-proxy'
import type { FFLogsV1Report } from '../types/fflogs'

interface JsonBody {
  error?: string
  // V2 format fields
  v?: number
  n?: string
  e?: number
  c?: unknown
  de?: unknown
  ce?: unknown
  se?: Array<{
    t: number
    ty: number
    a: number
    nm?: string
    w: [number, number]
    so?: 1
  }>
  r?: 1
  fs?: { rc: string; fi: number }
  ca?: number
  ua?: number
}

// Mock createClient
const mockGetReport = vi.fn()
const mockGetEvents = vi.fn()

vi.mock('./fflogs-proxy', async () => {
  const actual = await vi.importActual('./fflogs-proxy')
  return {
    ...actual,
    createClient: vi.fn(() => ({
      getReport: mockGetReport,
      getEvents: mockGetEvents,
    })),
  }
})

// Mock generateId 以获得稳定输出
vi.mock('@/utils/id', () => ({
  generateId: vi.fn(() => 'test-id-123'),
}))

const mockEnv: Env = {
  FFLOGS_CLIENT_ID: 'test-client-id',
  FFLOGS_CLIENT_SECRET: 'test-client-secret',
  healerbook: {} as KVNamespace,
  healerbook_timelines: {} as D1Database,
  TOP100_SYNC_QUEUE: {} as Queue,
  STATISTICS_EXTRACT_QUEUE: {} as Queue,
}

/** 构造一个最小的 V1 报告 */
function makeV1Report(
  fights: FFLogsV1Report['fights'] = [],
  overrides: Partial<FFLogsV1Report> = {}
): FFLogsV1Report {
  return {
    title: 'Test Report',
    lang: 'en',
    start: 1000000,
    end: 2000000,
    fights,
    friendlies: [
      {
        id: 1,
        guid: 100,
        name: 'TestPlayer',
        type: 'WhiteMage',
        server: 'Moogle',
        fights: [{ id: 5 }],
      },
    ],
    enemies: [],
    abilities: [{ gameID: 25867, name: 'Glare III', type: 'Spell' }],
    ...overrides,
  }
}

function makeFight(id: number, overrides: Partial<FFLogsV1Report['fights'][0]> = {}) {
  return {
    id,
    name: 'Test Boss',
    difficulty: 100,
    kill: true,
    start_time: 0,
    end_time: 300000,
    boss: 93,
    zoneID: 0,
    zoneName: '',
    size: 8,
    ...overrides,
  }
}

describe('handleFFLogsImport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetEvents.mockResolvedValue({ events: [] })
  })

  // ========== 参数校验 ==========

  describe('参数校验', () => {
    it('缺少 reportCode 应返回 400', async () => {
      const request = new Request('https://example.com/api/fflogs/import')
      const response = await handleFFLogsImport(request, mockEnv)

      expect(response.status).toBe(400)
      const body = (await response.json()) as JsonBody
      expect(body.error).toContain('reportCode')
    })

    it('fightId 非数字应返回 400', async () => {
      mockGetReport.mockResolvedValue(makeV1Report([makeFight(5)]))

      const request = new Request(
        'https://example.com/api/fflogs/import?reportCode=ABC123&fightId=abc'
      )
      const response = await handleFFLogsImport(request, mockEnv)

      expect(response.status).toBe(400)
      const body = (await response.json()) as JsonBody
      expect(body.error).toContain('fightId')
    })
  })

  // ========== 战斗查找 ==========

  describe('战斗查找', () => {
    it('报告中无战斗记录且不传 fightId 应返回 404', async () => {
      mockGetReport.mockResolvedValue(makeV1Report([]))

      const request = new Request('https://example.com/api/fflogs/import?reportCode=ABC123')
      const response = await handleFFLogsImport(request, mockEnv)

      expect(response.status).toBe(404)
      const body = (await response.json()) as JsonBody
      expect(body.error).toContain('没有战斗记录')
    })

    it('指定的 fightId 不存在应返回 404', async () => {
      mockGetReport.mockResolvedValue(makeV1Report([makeFight(5)]))

      const request = new Request(
        'https://example.com/api/fflogs/import?reportCode=ABC123&fightId=99'
      )
      const response = await handleFFLogsImport(request, mockEnv)

      expect(response.status).toBe(404)
      const body = (await response.json()) as JsonBody
      expect(body.error).toContain('99')
    })
  })

  // ========== 正常流程 ==========

  describe('正常流程', () => {
    it('传入 reportCode + fightId 应返回完整 Timeline', async () => {
      mockGetReport.mockResolvedValue(makeV1Report([makeFight(5), makeFight(10)]))
      mockGetEvents.mockResolvedValue({ events: [] })

      const request = new Request(
        'https://example.com/api/fflogs/import?reportCode=ABC123&fightId=5'
      )
      const response = await handleFFLogsImport(request, mockEnv)

      expect(response.status).toBe(200)
      const timeline = (await response.json()) as JsonBody

      // 验证 V2 格式关键字段
      expect(timeline.v).toBe(2)
      expect(timeline.n).toBeDefined()
      expect(timeline.c).toBeDefined()
      expect(timeline.de).toBeDefined()
      expect(timeline.ce).toBeDefined()
      expect(timeline.r).toBe(1)
      expect(timeline.fs).toEqual({ rc: 'ABC123', fi: 5 })
      expect(timeline.ca).toBeTypeOf('number')
      expect(timeline.ua).toBeTypeOf('number')

      // 验证调用参数
      expect(mockGetReport).toHaveBeenCalledWith({ reportCode: 'ABC123' })
      expect(mockGetEvents).toHaveBeenCalledWith({
        reportCode: 'ABC123',
        start: 0,
        end: 300000,
      })
    })

    it('不传 fightId 应取最后一场战斗', async () => {
      mockGetReport.mockResolvedValue(makeV1Report([makeFight(3), makeFight(5), makeFight(10)]))
      mockGetEvents.mockResolvedValue({ events: [] })

      const request = new Request('https://example.com/api/fflogs/import?reportCode=ABC123')
      const response = await handleFFLogsImport(request, mockEnv)

      expect(response.status).toBe(200)
      const timeline = (await response.json()) as JsonBody
      expect(timeline.fs!.fi).toBe(10)
    })

    it('导入流程产出 syncEvents', async () => {
      mockGetReport.mockResolvedValue(makeV1Report([makeFight(5)]))
      // boss sourceID 999 不在 friendlies（playerMap）中；begincast 空间斩 (0xa3da)
      // timestamp = fightStartTime(0) + 10000 → time = 10s
      mockGetEvents.mockResolvedValue({
        events: [
          {
            type: 'begincast',
            timestamp: 10000,
            sourceID: 999,
            abilityGameID: 0xa3da,
          },
        ],
      })

      const request = new Request(
        'https://example.com/api/fflogs/import?reportCode=ABC123&fightId=5'
      )
      const response = await handleFFLogsImport(request, mockEnv)

      expect(response.status).toBe(200)
      const timeline = (await response.json()) as JsonBody
      expect(timeline.se).toBeDefined()
      expect(timeline.se!.length).toBeGreaterThanOrEqual(1)
      expect(timeline.se).toContainEqual(
        expect.objectContaining({
          a: 0xa3da,
          ty: 0, // begincast
          w: [10, 10],
          t: 10,
        })
      )
    })

    it('匿名报告代码 a:ABC123 应正确传递给 getReport', async () => {
      mockGetReport.mockResolvedValue(makeV1Report([makeFight(1)]))
      mockGetEvents.mockResolvedValue({ events: [] })

      const request = new Request(
        'https://example.com/api/fflogs/import?reportCode=a:ABC123&fightId=1'
      )
      const response = await handleFFLogsImport(request, mockEnv)

      expect(response.status).toBe(200)
      expect(mockGetReport).toHaveBeenCalledWith({ reportCode: 'a:ABC123' })
    })
  })

  // ========== 错误处理 ==========

  describe('错误处理', () => {
    it('FFLogs API 调用失败应返回 502', async () => {
      mockGetReport.mockRejectedValue(new Error('FFLogs API timeout'))

      const request = new Request(
        'https://example.com/api/fflogs/import?reportCode=ABC123&fightId=5'
      )
      const response = await handleFFLogsImport(request, mockEnv)

      expect(response.status).toBe(502)
      const body = (await response.json()) as JsonBody
      expect(body.error).toContain('FFLogs API timeout')
    })

    it('getEvents 失败应返回 502', async () => {
      mockGetReport.mockResolvedValue(makeV1Report([makeFight(5)]))
      mockGetEvents.mockRejectedValue(new Error('Network error'))

      const request = new Request(
        'https://example.com/api/fflogs/import?reportCode=ABC123&fightId=5'
      )
      const response = await handleFFLogsImport(request, mockEnv)

      expect(response.status).toBe(502)
      const body = (await response.json()) as JsonBody
      expect(body.error).toContain('Network error')
    })
  })
})
