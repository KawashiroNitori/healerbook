/**
 * exportTimelineToExcel 单元测试
 *
 * 使用真实的 mitigationActions 和 deriveSkillTracks 派生技能列
 */

import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { exportTimelineToExcel } from './exportExcel'
import type { Timeline, CastEvent, Annotation } from '@/types/timeline'
import type { CalculationResult } from '@/utils/mitigationCalculator'
import { deriveSkillTracks } from '@/utils/skillTracks'
import { MITIGATION_DATA } from '@/data/mitigationActions'
import type { MitigationAction } from '@/types/mitigation'

const actions = MITIGATION_DATA.actions
const actionsById = new Map<number, MitigationAction>(actions.map(a => [a.id, a]))

const makeTimeline = (overrides: Partial<Timeline> = {}): Timeline => ({
  id: 'test-id',
  name: '测试时间轴',
  encounter: {
    id: 1,
    name: 'Test Encounter',
    displayName: '测试副本',
    zone: 'Test Zone',
    damageEvents: [],
  },
  composition: {
    players: [
      { id: 1, job: 'WAR' },
      { id: 2, job: 'WHM' },
    ],
  },
  damageEvents: [
    {
      id: 'e1',
      name: '地狱之牙',
      time: 65.3,
      damage: 120000,
      type: 'aoe',
      damageType: 'magical',
    },
  ],
  castEvents: [],
  statusEvents: [],
  annotations: [],
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
})

/** 从真实数据派生技能列 */
function makeSkillTracks(timeline: Timeline, hiddenPlayerIds = new Set<number>()) {
  return deriveSkillTracks(timeline.composition, hiddenPlayerIds, actions)
}

const makeCalculationResults = (finalDamage = 95000): Map<string, CalculationResult> => {
  return new Map([
    [
      'e1',
      {
        originalDamage: 120000,
        finalDamage,
        maxDamage: 130000,
        mitigationPercentage: 0.2,
        appliedStatuses: [],
      },
    ],
  ])
}

describe('exportTimelineToExcel', () => {
  it('生成有效的 xlsx buffer', async () => {
    const timeline = makeTimeline()
    const buffer = await exportTimelineToExcel({
      timeline,
      calculationResults: makeCalculationResults(),
      skillTracks: makeSkillTracks(timeline),
      actionsById,
      showOriginalDamage: true,
      showActualDamage: true,
      fileName: '测试文件',
    })

    expect(buffer).toBeInstanceOf(Uint8Array)
    expect(buffer.length).toBeGreaterThan(0)

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer as unknown as Buffer)
    expect(wb.worksheets).toHaveLength(1)
  })

  it('sheet 名为文件名', async () => {
    const timeline = makeTimeline()
    const buffer = await exportTimelineToExcel({
      timeline,
      calculationResults: makeCalculationResults(),
      skillTracks: makeSkillTracks(timeline),
      actionsById,
      showOriginalDamage: true,
      showActualDamage: true,
      fileName: '我的减伤表',
    })

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer as unknown as Buffer)
    expect(wb.worksheets[0].name).toBe('我的减伤表')
  })

  it('固定列正确：时间 + 名称 + 原始伤害 + 实际伤害', async () => {
    const timeline = makeTimeline()
    const buffer = await exportTimelineToExcel({
      timeline,
      calculationResults: makeCalculationResults(),
      skillTracks: makeSkillTracks(timeline),
      actionsById,
      showOriginalDamage: true,
      showActualDamage: true,
      fileName: '测试',
    })

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer as unknown as Buffer)
    const ws = wb.worksheets[0]
    const row2 = ws.getRow(2)
    expect(row2.getCell(1).value).toBe('时间')
    expect(row2.getCell(2).value).toBe('事件')
    expect(row2.getCell(3).value).toBe('原始伤害')
    expect(row2.getCell(4).value).toBe('实际伤害')
  })

  it('隐藏原始伤害列时不导出该列', async () => {
    const timeline = makeTimeline()
    const buffer = await exportTimelineToExcel({
      timeline,
      calculationResults: makeCalculationResults(),
      skillTracks: makeSkillTracks(timeline),
      actionsById,
      showOriginalDamage: false,
      showActualDamage: true,
      fileName: '测试',
    })

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer as unknown as Buffer)
    const ws = wb.worksheets[0]
    const row2 = ws.getRow(2)
    expect(row2.getCell(3).value).toBe('实际伤害')
  })

  it('隐藏实际伤害列时不导出该列', async () => {
    const timeline = makeTimeline()
    const skillTracks = makeSkillTracks(timeline)
    const buffer = await exportTimelineToExcel({
      timeline,
      calculationResults: makeCalculationResults(),
      skillTracks,
      actionsById,
      showOriginalDamage: true,
      showActualDamage: false,
      fileName: '测试',
    })

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer as unknown as Buffer)
    const ws = wb.worksheets[0]
    const row2 = ws.getRow(2)
    expect(row2.getCell(3).value).toBe('原始伤害')
    // 第 4 列应该是第一个技能名
    expect(row2.getCell(4).value).toBe(skillTracks[0].actionName)
  })

  it('伤害事件数据行正确', async () => {
    const timeline = makeTimeline()
    const buffer = await exportTimelineToExcel({
      timeline,
      calculationResults: makeCalculationResults(95000),
      skillTracks: makeSkillTracks(timeline),
      actionsById,
      showOriginalDamage: true,
      showActualDamage: true,
      fileName: '测试',
    })

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer as unknown as Buffer)
    const ws = wb.worksheets[0]
    const row3 = ws.getRow(3)
    expect(row3.getCell(1).value).toBe('1:05.3')
    expect(row3.getCell(2).value).toBe('地狱之牙')
    expect(row3.getCell(3).value).toBe('12.0w')
    expect(row3.getCell(4).value).toBe('9.5w')
  })

  it('施放点标记为 ✓ 且有绿色背景', async () => {
    const timeline = makeTimeline()
    const skillTracks = makeSkillTracks(timeline)
    // 找到 WAR 的第一个技能
    const warTrack = skillTracks.find(t => t.playerId === 1)!
    const action = actionsById.get(warTrack.actionId)!

    const timelineWithCast = makeTimeline({
      castEvents: [
        {
          id: 'c1',
          actionId: warTrack.actionId,
          timestamp: 60,
          playerId: 1,
          job: 'WAR',
        } as CastEvent,
      ],
    })

    const buffer = await exportTimelineToExcel({
      timeline: timelineWithCast,
      calculationResults: makeCalculationResults(),
      skillTracks,
      actionsById,
      showOriginalDamage: true,
      showActualDamage: true,
      fileName: '测试',
    })

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer as unknown as Buffer)
    const ws = wb.worksheets[0]
    // 固定列 4 个 + WAR 第一个技能在 skillTracks 中的 index
    const trackIdx = skillTracks.indexOf(warTrack)
    const skillCol = 5 + trackIdx
    // 只有在 cast 覆盖事件时才有标记（60 + duration > 65.3）
    if (60 + action.duration > 65.3) {
      const cell = ws.getRow(3).getCell(skillCol)
      expect(cell.value).toBe('✓')
      const fill = cell.fill as ExcelJS.FillPattern
      expect(fill?.fgColor?.argb).toBe('FF34D399')
    }
  })

  it('亮灯格有绿色背景但无文字', async () => {
    const timeline = makeTimeline({
      damageEvents: [
        {
          id: 'e1',
          name: '第一个',
          time: 65.3,
          damage: 120000,
          type: 'aoe',
          damageType: 'magical',
        },
        { id: 'e2', name: '第二个', time: 70, damage: 100000, type: 'aoe', damageType: 'magical' },
      ],
    })
    const skillTracks = makeSkillTracks(timeline)
    const warTrack = skillTracks.find(t => t.playerId === 1)!
    const action = actionsById.get(warTrack.actionId)!

    const timelineWithCast = makeTimeline({
      damageEvents: timeline.damageEvents,
      castEvents: [
        {
          id: 'c1',
          actionId: warTrack.actionId,
          timestamp: 60,
          playerId: 1,
          job: 'WAR',
        } as CastEvent,
      ],
    })

    const calculationResults = new Map<string, CalculationResult>([
      [
        'e1',
        {
          originalDamage: 120000,
          finalDamage: 95000,
          maxDamage: 130000,
          mitigationPercentage: 0.2,
          appliedStatuses: [],
        },
      ],
      [
        'e2',
        {
          originalDamage: 100000,
          finalDamage: 80000,
          maxDamage: 110000,
          mitigationPercentage: 0.2,
          appliedStatuses: [],
        },
      ],
    ])

    const buffer = await exportTimelineToExcel({
      timeline: timelineWithCast,
      calculationResults,
      skillTracks,
      actionsById,
      showOriginalDamage: true,
      showActualDamage: true,
      fileName: '测试',
    })

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer as unknown as Buffer)
    const ws = wb.worksheets[0]

    const trackIdx = skillTracks.indexOf(warTrack)
    const skillCol = 5 + trackIdx

    // e2(70s) 在 [60, 60+duration) 范围内 → 亮灯格（非 marker）
    if (60 + action.duration > 70) {
      const cell = ws.getRow(4).getCell(skillCol)
      const fill = cell.fill as ExcelJS.FillPattern
      expect(fill?.fgColor?.argb).toBe('FF34D399')
      expect(cell.value === null || cell.value === '').toBe(true)
    }
  })

  it('注释行正确导出', async () => {
    const annotation: Annotation = {
      id: 'ann1',
      text: '这里要用减伤',
      time: 30,
      anchor: { type: 'damageTrack' },
    }
    const timeline = makeTimeline({ annotations: [annotation] })

    const buffer = await exportTimelineToExcel({
      timeline,
      calculationResults: makeCalculationResults(),
      skillTracks: makeSkillTracks(timeline),
      actionsById,
      showOriginalDamage: true,
      showActualDamage: true,
      fileName: '测试',
    })

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer as unknown as Buffer)
    const ws = wb.worksheets[0]

    // 注释在 time=30，事件在 time=65.3，所以注释在 row3，事件在 row4
    const row3 = ws.getRow(3)
    expect(row3.getCell(1).value).toBe('0:30.0')
    expect(row3.getCell(2).value).toBe('这里要用减伤')
    const fill = row3.getCell(2).fill as ExcelJS.FillPattern
    expect(fill?.fgColor?.argb).toBe('FFFEF3C7')
  })

  it('第一行为职业合并表头', async () => {
    const timeline = makeTimeline()
    const skillTracks = makeSkillTracks(timeline)
    const buffer = await exportTimelineToExcel({
      timeline,
      calculationResults: makeCalculationResults(),
      skillTracks,
      actionsById,
      showOriginalDamage: true,
      showActualDamage: true,
      fileName: '测试',
    })

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer as unknown as Buffer)
    const ws = wb.worksheets[0]
    const row1 = ws.getRow(1)

    // WAR 和 WHM 的技能列分别从第 5 列开始
    const warTrackCount = skillTracks.filter(t => t.playerId === 1).length
    const whmStartCol = 5 + warTrackCount

    // WAR 和 WHM 各自的表头单元格应该有值
    const warCell = row1.getCell(5)
    const whmCell = row1.getCell(whmStartCol)
    expect(warCell.value).toBeTruthy()
    expect(whmCell.value).toBeTruthy()
  })
})
