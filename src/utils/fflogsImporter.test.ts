/**
 * FFLogs 导入工具测试
 */

import { describe, it, expect } from 'vitest'
import { parseFFLogsUrl } from './fflogsParser'

describe('parseFFLogsUrl', () => {
  describe('完整 URL 格式', () => {
    it('应该解析带 #fight 的完整 URL', () => {
      const result = parseFFLogsUrl('https://www.fflogs.com/reports/ABC123#fight=5')
      expect(result).toEqual({
        reportCode: 'ABC123',
        fightId: 5,
      })
    })

    it('应该解析带 ?fight 的完整 URL', () => {
      const result = parseFFLogsUrl('https://www.fflogs.com/reports/ABC123?fight=5')
      expect(result).toEqual({
        reportCode: 'ABC123',
        fightId: 5,
      })
    })

    it('应该解析中文站点 URL', () => {
      const result = parseFFLogsUrl('https://zh.fflogs.com/reports/ABC123#fight=10')
      expect(result).toEqual({
        reportCode: 'ABC123',
        fightId: 10,
      })
    })

    it('应该解析不带 fight 参数的 URL', () => {
      const result = parseFFLogsUrl('https://www.fflogs.com/reports/ABC123')
      expect(result).toEqual({
        reportCode: 'ABC123',
        fightId: null,
      })
    })

    it('应该解析带其他查询参数的 URL', () => {
      const result = parseFFLogsUrl(
        'https://www.fflogs.com/reports/ABC123?translate=true&fight=3'
      )
      expect(result).toEqual({
        reportCode: 'ABC123',
        fightId: 3,
      })
    })
  })

  describe('简短格式', () => {
    it('应该解析纯报告代码', () => {
      const result = parseFFLogsUrl('ABC123')
      expect(result).toEqual({
        reportCode: 'ABC123',
        fightId: null,
      })
    })

    it('应该解析报告代码 + #fight', () => {
      const result = parseFFLogsUrl('ABC123#fight=5')
      expect(result).toEqual({
        reportCode: 'ABC123',
        fightId: 5,
      })
    })

    it('应该解析报告代码 + ?fight', () => {
      const result = parseFFLogsUrl('ABC123?fight=5')
      expect(result).toEqual({
        reportCode: 'ABC123',
        fightId: 5,
      })
    })
  })

  describe('边界情况', () => {
    it('应该处理空字符串', () => {
      const result = parseFFLogsUrl('')
      expect(result).toEqual({
        reportCode: null,
        fightId: null,
      })
    })

    it('应该处理无效 URL', () => {
      const result = parseFFLogsUrl('https://example.com/invalid')
      expect(result).toEqual({
        reportCode: null,
        fightId: null,
      })
    })

    it('应该处理包含数字的报告代码', () => {
      const result = parseFFLogsUrl('https://www.fflogs.com/reports/a1B2c3D4#fight=1')
      expect(result).toEqual({
        reportCode: 'a1B2c3D4',
        fightId: 1,
      })
    })

    it('应该处理大战斗 ID', () => {
      const result = parseFFLogsUrl('ABC123#fight=999')
      expect(result).toEqual({
        reportCode: 'ABC123',
        fightId: 999,
      })
    })

    it('应该处理 fight=0', () => {
      const result = parseFFLogsUrl('ABC123#fight=0')
      expect(result).toEqual({
        reportCode: 'ABC123',
        fightId: 0,
      })
    })

    it('应该忽略无效的 fight 参数', () => {
      const result = parseFFLogsUrl('ABC123#fight=abc')
      expect(result).toEqual({
        reportCode: 'ABC123',
        fightId: null,
      })
    })
  })

  describe('实际案例', () => {
    it('应该解析真实的 FFLogs URL', () => {
      const result = parseFFLogsUrl(
        'https://www.fflogs.com/reports/a:1234567890abcdef#fight=12&type=damage-done'
      )
      expect(result.reportCode).toBeTruthy()
      expect(result.fightId).toBe(12)
    })
  })
})
