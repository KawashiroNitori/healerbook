/**
 * exportTimelineToExcel 单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import ExcelJS from 'exceljs'
import { exportTimelineToExcel } from './exportExcel'
import type { Timeline, CastEvent, Annotation } from '@/types/timeline'
import type { MitigationAction } from '@/types/mitigation'
import type { SkillTrack } from '@/utils/skillTracks'
import type { CalculationResult } from '@/utils/mitigationCalculator'

// Mock fetch 用于跳过图标下载
vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))

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

const makeSkillTracks = (): SkillTrack[] => [
  {
    job: 'WAR',
    playerId: 1,
    actionId: 10,
    actionName: '原初的直觉',
    actionIcon: '/i/000000/000806.png',
  },
  {
    job: 'WHM',
    playerId: 2,
    actionId: 20,
    actionName: '庇护所',
    actionIcon: '/i/012000/012809.png',
  },
]

const makeActionsById = (): Map<number, MitigationAction> => {
  const action = (id: number, duration: number): MitigationAction =>
    ({
      id,
      name: `action-${id}`,
      icon: `/i/icon-${id}.png`,
      jobs: [],
      duration,
      cooldown: 60,
      uniqueGroup: [],
      executor: () => ({ players: [], statuses: [], timestamp: 0 }),
    }) as unknown as MitigationAction
  return new Map([
    [10, action(10, 15)],
    [20, action(20, 20)],
  ])
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
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
  })

  it('生成有效的 xlsx buffer', async () => {
    const buffer = await exportTimelineToExcel({
      timeline: makeTimeline(),
      calculationResults: makeCalculationResults(),
      skillTracks: makeSkillTracks(),
      actionsById: makeActionsById(),
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
    const buffer = await exportTimelineToExcel({
      timeline: makeTimeline(),
      calculationResults: makeCalculationResults(),
      skillTracks: makeSkillTracks(),
      actionsById: makeActionsById(),
      showOriginalDamage: true,
      showActualDamage: true,
      fileName: '我的减伤表',
    })

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer as unknown as Buffer)
    expect(wb.worksheets[0].name).toBe('我的减伤表')
  })

  it('固定列正确：时间 + 名称 + 原始伤害 + 最终伤害', async () => {
    const buffer = await exportTimelineToExcel({
      timeline: makeTimeline(),
      calculationResults: makeCalculationResults(),
      skillTracks: makeSkillTracks(),
      actionsById: makeActionsById(),
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
    expect(row2.getCell(4).value).toBe('最终伤害')
  })

  it('隐藏原始伤害列时不导出该列', async () => {
    const buffer = await exportTimelineToExcel({
      timeline: makeTimeline(),
      calculationResults: makeCalculationResults(),
      skillTracks: makeSkillTracks(),
      actionsById: makeActionsById(),
      showOriginalDamage: false,
      showActualDamage: true,
      fileName: '测试',
    })

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer as unknown as Buffer)
    const ws = wb.worksheets[0]
    const row2 = ws.getRow(2)
    expect(row2.getCell(3).value).toBe('最终伤害')
  })

  it('隐藏最终伤害列时不导出该列', async () => {
    const buffer = await exportTimelineToExcel({
      timeline: makeTimeline(),
      calculationResults: makeCalculationResults(),
      skillTracks: makeSkillTracks(),
      actionsById: makeActionsById(),
      showOriginalDamage: true,
      showActualDamage: false,
      fileName: '测试',
    })

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer as unknown as Buffer)
    const ws = wb.worksheets[0]
    const row2 = ws.getRow(2)
    expect(row2.getCell(3).value).toBe('原始伤害')
    expect(row2.getCell(4).value).toBeNull()
  })

  it('伤害事件数据行正确', async () => {
    const buffer = await exportTimelineToExcel({
      timeline: makeTimeline(),
      calculationResults: makeCalculationResults(95000),
      skillTracks: makeSkillTracks(),
      actionsById: makeActionsById(),
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
    expect(row3.getCell(3).value).toBe(120000)
    expect(row3.getCell(4).value).toBe(95000)
  })

  it('施放点标记为 ✓ 且有绿色背景', async () => {
    // WAR (playerId=1) 在 t=60 使用 actionId=10 (duration=15)
    // event 在 t=65.3，处于窗口内
    // castMarker：65.3 >= 60，所以 e1 是 cast marker
    const timeline = makeTimeline({
      castEvents: [
        {
          id: 'c1',
          actionId: 10,
          timestamp: 60,
          playerId: 1,
          job: 'WAR',
        } as CastEvent,
      ],
    })

    const buffer = await exportTimelineToExcel({
      timeline,
      calculationResults: makeCalculationResults(),
      skillTracks: makeSkillTracks(),
      actionsById: makeActionsById(),
      showOriginalDamage: true,
      showActualDamage: true,
      fileName: '测试',
    })

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer as unknown as Buffer)
    const ws = wb.worksheets[0]
    // 固定列：时间、事件、原始伤害、最终伤害 = 4列
    // 技能列从第5列开始，第1个技能轨道是 WAR playerId=1 actionId=10
    const row3 = ws.getRow(3)
    const skillCol = 5 // 第一个技能列
    const cell = row3.getCell(skillCol)
    expect(cell.value).toBe('✓')
    const fill = cell.fill as ExcelJS.FillPattern
    expect(fill?.fgColor?.argb).toBe('FF34D399')
  })

  it('亮灯格有绿色背景但无文字', async () => {
    // 两个 events，第二个事件也在 cast 窗口内，但不是 marker（第一个事件才是 marker）
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
        {
          id: 'e2',
          name: '第二个',
          time: 70,
          damage: 100000,
          type: 'aoe',
          damageType: 'magical',
        },
      ],
      castEvents: [
        {
          id: 'c1',
          actionId: 10,
          timestamp: 60,
          playerId: 1,
          job: 'WAR',
        } as CastEvent,
      ],
    })

    const calculationResults = new Map([
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
      timeline,
      calculationResults,
      skillTracks: makeSkillTracks(),
      actionsById: makeActionsById(),
      showOriginalDamage: true,
      showActualDamage: true,
      fileName: '测试',
    })

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer as unknown as Buffer)
    const ws = wb.worksheets[0]

    // e1 是 cast marker，e2 是 lit cell (70 < 60+15=75)
    // e1 在 row3，e2 在 row4
    const row4 = ws.getRow(4)
    const skillCol = 5
    const cell = row4.getCell(skillCol)
    // 亮灯格：绿色背景，无文字（null 或 '' 均可）
    const fill = cell.fill as ExcelJS.FillPattern
    expect(fill?.fgColor?.argb).toBe('FF34D399')
    expect(cell.value === null || cell.value === '').toBe(true)
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
      skillTracks: makeSkillTracks(),
      actionsById: makeActionsById(),
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
    const buffer = await exportTimelineToExcel({
      timeline: makeTimeline(),
      calculationResults: makeCalculationResults(),
      skillTracks: makeSkillTracks(),
      actionsById: makeActionsById(),
      showOriginalDamage: true,
      showActualDamage: true,
      fileName: '测试',
    })

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer as unknown as Buffer)
    const ws = wb.worksheets[0]

    const row1 = ws.getRow(1)
    // 技能列从第5列开始
    // WAR 有 1 个技能 (playerId=1, actionId=10)
    // WHM 有 1 个技能 (playerId=2, actionId=20)
    const warCell = row1.getCell(5)
    const whmCell = row1.getCell(6)
    expect(warCell.value).toBe('战士')
    expect(whmCell.value).toBe('白魔法师')
  })
})
