# 导出 Excel 功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在编辑器工具栏添加导出按钮，点击后通过对话框配置导出选项，生成与表格视图一致的 xlsx 文件。

**Architecture:** 工具栏新增 DropdownMenu 导出按钮（分享按钮右侧） → 打开 ExportExcelDialog 对话框（文件名、阵容勾选、伤害列显隐） → 调用 `exportTimelineToExcel()` 纯函数生成 xlsx → 触发浏览器下载。导出逻辑与 UI 解耦，核心函数可独立测试。

**Tech Stack:** ExcelJS（xlsx 生成 + 图片嵌入）、file-saver（触发下载）、现有 castWindow/tableRows/skillTracks 工具函数

---

## 文件结构

| 文件                                   | 职责                                                                  |
| -------------------------------------- | --------------------------------------------------------------------- |
| `src/utils/exportExcel.ts`             | **新建** — 纯函数 `exportTimelineToExcel()`，接收数据生成 xlsx Buffer |
| `src/utils/exportExcel.test.ts`        | **新建** — 导出函数单元测试                                           |
| `src/components/ExportExcelDialog.tsx` | **新建** — 导出设置对话框（文件名、阵容、伤害列）                     |
| `src/components/EditorToolbar.tsx`     | **修改** — 添加导出下拉按钮，打开对话框                               |

---

### Task 1: 安装依赖

**Files:**

- Modify: `package.json`

- [ ] **Step 1.1: 安装 exceljs 和 file-saver**

```bash
pnpm add exceljs file-saver
pnpm add -D @types/file-saver
```

- [ ] **Step 1.2: 验证安装成功**

Run: `pnpm ls exceljs file-saver`
Expected: 显示两个包及其版本号

- [ ] **Step 1.3: 提交**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: 添加 exceljs 和 file-saver 依赖"
```

---

### Task 2: 导出核心函数 — exportTimelineToExcel

**Files:**

- Create: `src/utils/exportExcel.ts`
- Create: `src/utils/exportExcel.test.ts`

这是最核心的任务。函数签名：

```typescript
export interface ExportExcelOptions {
  timeline: Timeline
  calculationResults: Map<string, CalculationResult>
  /** 按职业序排好的技能轨道（已排除隐藏玩家） */
  skillTracks: SkillTrack[]
  /** 所有技能定义，用于查 duration */
  actionsById: Map<number, MitigationAction>
  showOriginalDamage: boolean
  showActualDamage: boolean
  fileName: string
}

export async function exportTimelineToExcel(options: ExportExcelOptions): Promise<Buffer>
```

- [ ] **Step 2.1: 编写基础结构测试**

```typescript
// src/utils/exportExcel.test.ts
import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { exportTimelineToExcel, type ExportExcelOptions } from './exportExcel'
import type { Timeline } from '@/types/timeline'
import type { SkillTrack } from '@/utils/skillTracks'

function makeTimeline(overrides?: Partial<Timeline>): Timeline {
  return {
    id: 'test',
    name: '测试时间轴',
    encounter: { id: 1, name: 'Test', zoneName: 'Zone', zoneId: 1 },
    composition: {
      players: [
        { id: 1, job: 'WAR' },
        { id: 2, job: 'WHM' },
      ],
    },
    damageEvents: [
      {
        id: 'e1',
        name: '全体攻击',
        time: 65.3,
        damage: 120000,
        type: 'aoe',
        damageType: 'magical',
      },
      { id: 'e2', name: '死刑', time: 90.0, damage: 200000, type: 'aoe', damageType: 'physical' },
    ],
    castEvents: [],
    statusEvents: [],
    annotations: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

function makeOptions(overrides?: Partial<ExportExcelOptions>): ExportExcelOptions {
  const timeline = makeTimeline()
  return {
    timeline,
    calculationResults: new Map([
      [
        'e1',
        {
          originalDamage: 120000,
          finalDamage: 80000,
          maxDamage: 85000,
          mitigationPercentage: 33,
          appliedStatuses: [],
        },
      ],
      [
        'e2',
        {
          originalDamage: 200000,
          finalDamage: 150000,
          maxDamage: 160000,
          mitigationPercentage: 25,
          appliedStatuses: [],
        },
      ],
    ]),
    skillTracks: [
      {
        job: 'WAR',
        playerId: 1,
        actionId: 7535,
        actionName: '雪仇',
        actionIcon: '/i/000000/000806.png',
      },
      {
        job: 'WAR',
        playerId: 1,
        actionId: 7548,
        actionName: '原初的直觉',
        actionIcon: '/i/002000/002548.png',
      },
      {
        job: 'WHM',
        playerId: 2,
        actionId: 3569,
        actionName: '节制',
        actionIcon: '/i/002000/002633.png',
      },
    ],
    actionsById: new Map([
      [7535, { id: 7535, name: '雪仇', duration: 15, cooldown: 60 } as any],
      [7548, { id: 7548, name: '原初的直觉', duration: 6, cooldown: 25 } as any],
      [3569, { id: 3569, name: '节制', duration: 15, cooldown: 120 } as any],
    ]),
    showOriginalDamage: true,
    showActualDamage: true,
    fileName: '测试时间轴',
    ...overrides,
  }
}

describe('exportTimelineToExcel', () => {
  it('生成有效的 xlsx buffer', async () => {
    const buffer = await exportTimelineToExcel(makeOptions())
    expect(buffer).toBeInstanceOf(Buffer)
    expect(buffer.length).toBeGreaterThan(0)

    // 用 ExcelJS 反解析验证
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)
    expect(wb.worksheets.length).toBe(1)
  })

  it('sheet 名为文件名', async () => {
    const buffer = await exportTimelineToExcel(makeOptions({ fileName: '我的规划' }))
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)
    expect(wb.worksheets[0].name).toBe('我的规划')
  })

  it('固定列正确：时间 + 名称 + 原始伤害 + 最终伤害', async () => {
    const buffer = await exportTimelineToExcel(makeOptions())
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)
    const ws = wb.worksheets[0]
    // 第二行（表头行 2）前 4 列
    expect(ws.getCell(2, 1).value).toBe('时间')
    expect(ws.getCell(2, 2).value).toBe('事件')
    expect(ws.getCell(2, 3).value).toBe('原始伤害')
    expect(ws.getCell(2, 4).value).toBe('最终伤害')
  })

  it('隐藏原始伤害列时不导出该列', async () => {
    const buffer = await exportTimelineToExcel(makeOptions({ showOriginalDamage: false }))
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)
    const ws = wb.worksheets[0]
    // 第二行表头：时间 | 事件 | 最终伤害（无原始伤害列）
    expect(ws.getCell(2, 1).value).toBe('时间')
    expect(ws.getCell(2, 2).value).toBe('事件')
    expect(ws.getCell(2, 3).value).toBe('最终伤害')
  })

  it('隐藏最终伤害列时不导出该列', async () => {
    const buffer = await exportTimelineToExcel(makeOptions({ showActualDamage: false }))
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)
    const ws = wb.worksheets[0]
    expect(ws.getCell(2, 3).value).toBe('原始伤害')
    // 第 4 列应该是技能列而非最终伤害
    expect(ws.getCell(2, 4).value).toBeNull()
  })

  it('伤害事件数据行正确', async () => {
    const buffer = await exportTimelineToExcel(makeOptions())
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)
    const ws = wb.worksheets[0]
    // 数据从第 3 行开始
    expect(ws.getCell(3, 1).value).toBe('1:05.3')
    expect(ws.getCell(3, 2).value).toBe('全体攻击')
    expect(ws.getCell(3, 3).value).toBe(120000)
    expect(ws.getCell(3, 4).value).toBe(80000)
  })

  it('施放点标记为 ✓ 且有绿色背景', async () => {
    const timeline = makeTimeline({
      castEvents: [{ id: 'c1', actionId: 7535, timestamp: 60, playerId: 1, job: 'WAR' }],
    })
    const buffer = await exportTimelineToExcel(makeOptions({ timeline }))
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)
    const ws = wb.worksheets[0]
    // 第一个技能列从第 5 列开始（时间+名称+原始+最终=4），第 3 行是 e1(65.3s)
    // cast at 60s, duration 15s → covers e1(65.3) ✓, e2(90) ✗
    // marker cell: e1 is first event at or after 60s → marker
    const cell = ws.getCell(3, 5)
    expect(cell.value).toBe('✓')
    expect(cell.fill).toMatchObject({
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF34D399' },
    })
  })

  it('亮灯格有绿色背景但无文字', async () => {
    const timeline = makeTimeline({
      damageEvents: [
        { id: 'e1', name: '事件1', time: 62, damage: 100000, type: 'aoe', damageType: 'magical' },
        { id: 'e2', name: '事件2', time: 65, damage: 100000, type: 'aoe', damageType: 'magical' },
      ],
      castEvents: [{ id: 'c1', actionId: 7535, timestamp: 60, playerId: 1, job: 'WAR' }],
    })
    const buffer = await exportTimelineToExcel(makeOptions({ timeline }))
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)
    const ws = wb.worksheets[0]
    // e1(62s) 是 marker cell（first at/after 60）→ ✓
    // e2(65s) 在 [60, 60+15) 范围内 → 亮灯（绿色背景但无文字）
    const markerCell = ws.getCell(3, 5)
    expect(markerCell.value).toBe('✓')
    const litCell = ws.getCell(4, 5)
    expect(litCell.value).toBeNull()
    expect(litCell.fill).toMatchObject({
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF34D399' },
    })
  })

  it('注释行正确导出', async () => {
    const timeline = makeTimeline({
      annotations: [{ id: 'a1', text: 'P1 开始', time: 60, anchor: { type: 'damageTrack' } }],
    })
    const buffer = await exportTimelineToExcel(makeOptions({ timeline }))
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)
    const ws = wb.worksheets[0]
    // 注释行排在 e1(65.3s) 之前（time=60 < 65.3）
    expect(ws.getCell(3, 1).value).toBe('1:00.0')
    expect(ws.getCell(3, 2).value).toBe('P1 开始')
    // 注释行应有黄色背景
    const fill = ws.getCell(3, 1).fill as ExcelJS.FillPattern
    expect(fill.fgColor?.argb).toBe('FFFEF3C7')
  })

  it('第一行为职业合并表头', async () => {
    const buffer = await exportTimelineToExcel(makeOptions())
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)
    const ws = wb.worksheets[0]
    // WAR 有 2 个技能列（列 5-6），WHM 有 1 个技能列（列 7）
    expect(ws.getCell(1, 5).value).toBe('战士')
    expect(ws.getCell(1, 7).value).toBe('白魔法师')
  })
})
```

- [ ] **Step 2.2: 运行测试确认全部失败**

Run: `pnpm test:run src/utils/exportExcel.test.ts`
Expected: FAIL — 模块 `./exportExcel` 不存在

- [ ] **Step 2.3: 实现 exportTimelineToExcel**

```typescript
// src/utils/exportExcel.ts
import ExcelJS from 'exceljs'
import type { Timeline } from '@/types/timeline'
import type { MitigationAction } from '@/types/mitigation'
import type { SkillTrack } from '@/utils/skillTracks'
import type { CalculationResult } from '@/utils/mitigationCalculator'
import { mergeAndSortRows } from '@/utils/tableRows'
import { computeLitCellsByEvent, computeCastMarkerCells, cellKey } from '@/utils/castWindow'
import { formatTimeWithDecimal } from '@/utils/formatters'
import { getIconUrl } from '@/utils/iconUtils'
import { getJobName } from '@/data/jobs'
import type { Job } from '@/types/timeline'

export interface ExportExcelOptions {
  timeline: Timeline
  calculationResults: Map<string, CalculationResult>
  skillTracks: SkillTrack[]
  actionsById: Map<number, MitigationAction>
  showOriginalDamage: boolean
  showActualDamage: boolean
  fileName: string
}

const GREEN_FILL: ExcelJS.FillPattern = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF34D399' },
}

const YELLOW_FILL: ExcelJS.FillPattern = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFEF3C7' },
}

const HEADER_FILL: ExcelJS.FillPattern = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFF3F4F6' },
}

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
  bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
  left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
  right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
}

const CENTER: Partial<ExcelJS.Alignment> = {
  horizontal: 'center',
  vertical: 'middle',
}

export async function exportTimelineToExcel(options: ExportExcelOptions): Promise<Buffer> {
  const {
    timeline,
    calculationResults,
    skillTracks,
    actionsById,
    showOriginalDamage,
    showActualDamage,
    fileName,
  } = options

  const wb = new ExcelJS.Workbook()
  // Sheet 名最长 31 字符（Excel 限制）
  const sheetName = fileName.slice(0, 31) || '减伤表'
  const ws = wb.addWorksheet(sheetName)

  // ─── 列定义 ───
  const fixedCols: { header: string; key: string; width: number }[] = [
    { header: '时间', key: 'time', width: 10 },
    { header: '事件', key: 'name', width: 18 },
  ]
  if (showOriginalDamage) {
    fixedCols.push({ header: '原始伤害', key: 'originalDamage', width: 12 })
  }
  if (showActualDamage) {
    fixedCols.push({ header: '最终伤害', key: 'actualDamage', width: 12 })
  }
  const fixedColCount = fixedCols.length
  const skillColWidth = 5.5 // Excel 列宽单位 ≈ 字符宽度，5.5 约等于 40px

  // 设置列（固定列 + 技能列）
  ws.columns = [
    ...fixedCols.map(c => ({ width: c.width })),
    ...skillTracks.map(() => ({ width: skillColWidth })),
  ]

  // 设置所有行高为 30（约 40px）
  ws.properties.defaultRowHeight = 30

  // ─── 表头第一行：职业合并单元格 ───
  const row1 = ws.getRow(1)
  row1.height = 20

  // 固定列区域留空
  for (let c = 1; c <= fixedColCount; c++) {
    const cell = ws.getCell(1, c)
    cell.fill = HEADER_FILL
    cell.border = THIN_BORDER
  }

  // 按玩家分组技能列，合并并写职业名
  let colIdx = fixedColCount + 1
  const playerGroups: { job: Job; startCol: number; endCol: number }[] = []
  let currentPlayerId: number | null = null
  let groupStart = colIdx

  for (let i = 0; i < skillTracks.length; i++) {
    const track = skillTracks[i]
    if (currentPlayerId !== null && track.playerId !== currentPlayerId) {
      playerGroups.push({ job: skillTracks[i - 1].job, startCol: groupStart, endCol: colIdx - 1 })
      groupStart = colIdx
    }
    currentPlayerId = track.playerId
    colIdx++
  }
  if (currentPlayerId !== null) {
    playerGroups.push({
      job: skillTracks[skillTracks.length - 1].job,
      startCol: groupStart,
      endCol: colIdx - 1,
    })
  }

  for (const group of playerGroups) {
    if (group.startCol < group.endCol) {
      ws.mergeCells(1, group.startCol, 1, group.endCol)
    }
    const cell = ws.getCell(1, group.startCol)
    cell.value = getJobName(group.job)
    cell.alignment = CENTER
    cell.fill = HEADER_FILL
    cell.border = THIN_BORDER
    cell.font = { bold: true, size: 9 }
  }

  // ─── 表头第二行：固定列标题 + 技能图标（先写标题，图标异步下载后嵌入） ───
  const row2 = ws.getRow(2)
  row2.height = 30

  for (let i = 0; i < fixedCols.length; i++) {
    const cell = ws.getCell(2, i + 1)
    cell.value = fixedCols[i].header
    cell.alignment = CENTER
    cell.fill = HEADER_FILL
    cell.border = THIN_BORDER
    cell.font = { bold: true, size: 10 }
  }

  // 技能列表头：先留空，后面下载图标后嵌入
  for (let i = 0; i < skillTracks.length; i++) {
    const cell = ws.getCell(2, fixedColCount + 1 + i)
    cell.fill = HEADER_FILL
    cell.border = THIN_BORDER
    cell.alignment = CENTER
  }

  // ─── 数据行 ───
  const rows = mergeAndSortRows(timeline.damageEvents, timeline.annotations ?? [])
  const litCellsByEvent = computeLitCellsByEvent(
    timeline.damageEvents,
    timeline.castEvents,
    actionsById
  )
  const markerCellsByEvent = computeCastMarkerCells(timeline.damageEvents, timeline.castEvents)

  let rowNum = 3 // 数据从第 3 行开始
  for (const row of rows) {
    const excelRow = ws.getRow(rowNum)
    excelRow.height = 30

    if (row.kind === 'annotation') {
      // 注释行：时间 + 文本（合并后续列）
      const timeCell = ws.getCell(rowNum, 1)
      timeCell.value = formatTimeWithDecimal(row.time)
      timeCell.alignment = CENTER
      timeCell.fill = YELLOW_FILL
      timeCell.border = THIN_BORDER

      const textCell = ws.getCell(rowNum, 2)
      textCell.value = row.annotation!.text
      textCell.fill = YELLOW_FILL
      textCell.border = THIN_BORDER
      textCell.font = { italic: true }

      // 剩余列也填黄色背景
      const totalCols = fixedColCount + skillTracks.length
      if (totalCols > 2) {
        ws.mergeCells(rowNum, 2, rowNum, totalCols)
      }
    } else {
      // 伤害事件行
      const event = row.event!
      const calcResult = calculationResults.get(event.id)

      ws.getCell(rowNum, 1).value = formatTimeWithDecimal(event.time)
      ws.getCell(rowNum, 1).alignment = CENTER
      ws.getCell(rowNum, 1).border = THIN_BORDER

      ws.getCell(rowNum, 2).value = event.name
      ws.getCell(rowNum, 2).border = THIN_BORDER

      let colOffset = 3
      if (showOriginalDamage) {
        ws.getCell(rowNum, colOffset).value = event.damage
        ws.getCell(rowNum, colOffset).alignment = { ...CENTER, horizontal: 'right' }
        ws.getCell(rowNum, colOffset).border = THIN_BORDER
        ws.getCell(rowNum, colOffset).numFmt = '#,##0'
        colOffset++
      }
      if (showActualDamage) {
        ws.getCell(rowNum, colOffset).value = calcResult?.finalDamage ?? null
        ws.getCell(rowNum, colOffset).alignment = { ...CENTER, horizontal: 'right' }
        ws.getCell(rowNum, colOffset).border = THIN_BORDER
        ws.getCell(rowNum, colOffset).numFmt = '#,##0'
        colOffset++
      }

      // 技能列
      const litCells = litCellsByEvent.get(event.id) ?? new Set<string>()
      const markerCells = markerCellsByEvent.get(event.id) ?? new Set<string>()

      for (let i = 0; i < skillTracks.length; i++) {
        const track = skillTracks[i]
        const key = cellKey(track.playerId, track.actionId)
        const cell = ws.getCell(rowNum, fixedColCount + 1 + i)
        cell.border = THIN_BORDER
        cell.alignment = CENTER

        if (markerCells.has(key)) {
          cell.value = '✓'
          cell.fill = GREEN_FILL
          cell.font = { bold: true, color: { argb: 'FF065F46' } }
        } else if (litCells.has(key)) {
          cell.fill = GREEN_FILL
        }
      }
    }

    rowNum++
  }

  // ─── 下载技能图标并嵌入表头第二行 ───
  const iconPromises = skillTracks.map(async (track, i) => {
    const url = getIconUrl(track.actionIcon)
    if (!url) return
    try {
      const response = await fetch(url)
      if (!response.ok) return
      const arrayBuffer = await response.arrayBuffer()
      const imageId = wb.addImage({
        buffer: Buffer.from(arrayBuffer),
        extension: 'png',
      })
      ws.addImage(imageId, {
        tl: { col: fixedColCount + i, row: 1 },
        br: { col: fixedColCount + i + 1, row: 2 },
        editAs: 'oneCell',
      })
    } catch {
      // 图标下载失败时静默跳过，单元格保持空白
    }
  })
  await Promise.all(iconPromises)

  // ─── 生成 buffer ───
  const arrayBuffer = await wb.xlsx.writeBuffer()
  return Buffer.from(arrayBuffer)
}
```

- [ ] **Step 2.4: 运行测试**

Run: `pnpm test:run src/utils/exportExcel.test.ts`
Expected: 大部分测试通过。如果图标下载相关测试失败（测试环境无网络），需要在测试中 mock fetch。

注意：测试中不涉及图标下载（没有 actionIcon 的完整 URL），所以图标嵌入部分会静默跳过。

- [ ] **Step 2.5: 修复可能的测试问题并确认全部通过**

Run: `pnpm test:run src/utils/exportExcel.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 2.6: 提交**

```bash
git add src/utils/exportExcel.ts src/utils/exportExcel.test.ts
git commit -m "feat: 实现 exportTimelineToExcel 核心导出函数"
```

---

### Task 3: 导出设置对话框 — ExportExcelDialog

**Files:**

- Create: `src/components/ExportExcelDialog.tsx`

- [ ] **Step 3.1: 实现对话框组件**

```typescript
// src/components/ExportExcelDialog.tsx
import { useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { saveAs } from 'file-saver'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalFooter } from '@/components/ui/modal'
import { Switch } from '@/components/ui/switch'
import { useTimelineStore } from '@/store/timelineStore'
import { useUIStore } from '@/store/uiStore'
import { useMitigationStore } from '@/store/mitigationStore'
import { useDamageCalculationResults } from '@/contexts/DamageCalculationContext'
import { deriveSkillTracks } from '@/utils/skillTracks'
import { sortJobsByOrder, getJobName } from '@/data/jobs'
import { exportTimelineToExcel } from '@/utils/exportExcel'

interface ExportExcelDialogProps {
  open: boolean
  onClose: () => void
}

export default function ExportExcelDialog({ open, onClose }: ExportExcelDialogProps) {
  const timeline = useTimelineStore(s => s.timeline)
  const actions = useMitigationStore(s => s.actions)
  const globalHiddenPlayerIds = useUIStore(s => s.hiddenPlayerIds)
  const globalShowOriginalDamage = useUIStore(s => s.showOriginalDamage)
  const globalShowActualDamage = useUIStore(s => s.showActualDamage)
  const calculationResults = useDamageCalculationResults()

  // 对话框内的本地状态，初始值跟随全局
  const [fileName, setFileName] = useState('')
  const [hiddenPlayerIds, setHiddenPlayerIds] = useState<Set<number>>(new Set())
  const [showOriginalDamage, setShowOriginalDamage] = useState(true)
  const [showActualDamage, setShowActualDamage] = useState(true)
  const [exporting, setExporting] = useState(false)

  // 每次打开时重置为全局状态
  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen && timeline) {
      setFileName(timeline.name || '减伤表')
      setHiddenPlayerIds(new Set(globalHiddenPlayerIds))
      setShowOriginalDamage(globalShowOriginalDamage)
      setShowActualDamage(globalShowActualDamage)
    }
    if (!isOpen) onClose()
  }

  // 首次 open 时也需要初始化
  if (open && fileName === '' && timeline) {
    handleOpenChange(true)
  }

  const composition = timeline?.composition
  const sortedPlayers = composition ? sortJobsByOrder(composition.players, p => p.job) : []

  const togglePlayer = (playerId: number) => {
    setHiddenPlayerIds(prev => {
      const next = new Set(prev)
      if (next.has(playerId)) {
        next.delete(playerId)
      } else {
        next.add(playerId)
      }
      return next
    })
  }

  const handleExport = async () => {
    if (!timeline || !composition) return

    setExporting(true)
    try {
      const actionsById = new Map(actions.map(a => [a.id, a]))
      const skillTracks = deriveSkillTracks(composition, hiddenPlayerIds, actions)

      const buffer = await exportTimelineToExcel({
        timeline,
        calculationResults,
        skillTracks,
        actionsById,
        showOriginalDamage,
        showActualDamage,
        fileName,
      })

      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      saveAs(blob, `${fileName}.xlsx`)
      toast.success('导出成功')
      onClose()
    } catch (err) {
      console.error('Export failed:', err)
      toast.error('导出失败，请重试')
    } finally {
      setExporting(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} disableBackdropClick={exporting}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>导出 Excel 表格</ModalTitle>
        </ModalHeader>

        <div className="space-y-4">
          {/* 文件名 */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">文件名</label>
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={fileName}
                onChange={e => setFileName(e.target.value)}
                className="flex-1 px-3 py-1.5 text-sm border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                disabled={exporting}
              />
              <span className="text-sm text-muted-foreground">.xlsx</span>
            </div>
          </div>

          {/* 阵容勾选 */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">导出阵容</label>
            <div className="space-y-1">
              {sortedPlayers.map(player => (
                <label
                  key={player.id}
                  className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted/50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={!hiddenPlayerIds.has(player.id)}
                    onChange={() => togglePlayer(player.id)}
                    disabled={exporting}
                    className="rounded border-input"
                  />
                  <span className={`text-sm ${hiddenPlayerIds.has(player.id) ? 'text-muted-foreground' : ''}`}>
                    {getJobName(player.job)}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* 显示选项 */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">显示列</label>
            <div className="space-y-2">
              <label className="flex items-center justify-between px-2 py-1 cursor-pointer">
                <span className="text-sm">原始伤害</span>
                <Switch
                  checked={showOriginalDamage}
                  onCheckedChange={setShowOriginalDamage}
                  disabled={exporting}
                />
              </label>
              <label className="flex items-center justify-between px-2 py-1 cursor-pointer">
                <span className="text-sm">最终伤害</span>
                <Switch
                  checked={showActualDamage}
                  onCheckedChange={setShowActualDamage}
                  disabled={exporting}
                />
              </label>
            </div>
          </div>
        </div>

        <ModalFooter>
          <Button variant="outline" onClick={onClose} disabled={exporting}>
            取消
          </Button>
          <Button onClick={handleExport} disabled={exporting || !fileName.trim()}>
            {exporting ? (
              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
            ) : (
              <Download className="w-4 h-4 mr-1" />
            )}
            导出
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
```

- [ ] **Step 3.2: 验证 TypeScript 编译通过**

Run: `pnpm exec tsc --noEmit --pretty 2>&1 | head -20`
Expected: 无与 ExportExcelDialog 相关的错误

- [ ] **Step 3.3: 提交**

```bash
git add src/components/ExportExcelDialog.tsx
git commit -m "feat: 添加导出 Excel 设置对话框"
```

---

### Task 4: 工具栏集成导出按钮

**Files:**

- Modify: `src/components/EditorToolbar.tsx`

- [ ] **Step 4.1: 在 EditorToolbar 中添加导出下拉按钮**

在文件顶部追加导入：

```typescript
import { Download } from 'lucide-react'
import ExportExcelDialog from './ExportExcelDialog'
```

在 `EditorToolbar` 函数内添加状态：

```typescript
const [showExportDialog, setShowExportDialog] = useState(false)
```

在 JSX 中，找到共享按钮区域（`{timeline && (` 开始的块），在其 `</>` 闭合标签之后、`{/* Exit Replay Mode Confirmation */}` 注释之前，插入导出按钮：

```tsx
{
  /* 导出 */
}
{
  timeline && (
    <>
      <div className="w-px h-6 bg-border mx-1" />
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7">
                <Download className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">导出</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start">
          <DropdownMenuCheckboxItem
            checked={false}
            onCheckedChange={() => setShowExportDialog(true)}
          >
            Excel 表格...
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
```

注意：这里用 `DropdownMenuCheckboxItem` 不太合适，应该用普通菜单项。但现有导入里没有 `DropdownMenuItem`，需要额外导入。修正为：

追加导入 `DropdownMenuItem`：

```typescript
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem, // ← 新增
  DropdownMenuSub,
  // ... 其余保持不变
} from '@/components/ui/dropdown-menu'
```

对应 JSX 改为：

```tsx
<DropdownMenuItem onSelect={() => setShowExportDialog(true)}>Excel 表格...</DropdownMenuItem>
```

在组件 return 最外层的 `<>` 内、`<StatDataDialog .../>` 之后，添加：

```tsx
<ExportExcelDialog open={showExportDialog} onClose={() => setShowExportDialog(false)} />
```

- [ ] **Step 4.2: 验证 TypeScript 编译通过**

Run: `pnpm exec tsc --noEmit --pretty 2>&1 | head -20`
Expected: 无错误

- [ ] **Step 4.3: 手动验证功能**

Run: `pnpm dev`

验证清单：

1. 工具栏最右侧出现下载图标按钮
2. 点击按钮弹出下拉菜单，显示「Excel 表格...」
3. 点击菜单项弹出导出对话框
4. 对话框显示：文件名（默认为时间轴名称）、阵容勾选列表、伤害列开关
5. 修改设置后点击「导出」，下载 xlsx 文件
6. 用 Excel/WPS 打开验证：表头、数据行、绿色标记、注释行、技能图标

- [ ] **Step 4.4: 提交**

```bash
git add src/components/EditorToolbar.tsx
git commit -m "feat: 工具栏添加导出 Excel 按钮和菜单"
```

---

### Task 5: 集成测试与收尾

- [ ] **Step 5.1: 运行全量测试确认无回归**

Run: `pnpm test:run`
Expected: 所有测试通过（原有 129 + 新增 8 = 137）

- [ ] **Step 5.2: 运行 lint 检查**

Run: `pnpm lint`
Expected: 无错误

- [ ] **Step 5.3: 修复 lint 问题（如有）**

Run: `pnpm lint:fix`

- [ ] **Step 5.4: 最终提交（如有 lint 修复）**

```bash
git add -A
git commit -m "fix: 修复 lint 问题"
```
