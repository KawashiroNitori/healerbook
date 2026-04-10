/**
 * 导出时间轴为 Excel 文件
 */

import ExcelJS from 'exceljs'
import type { Timeline } from '@/types/timeline'
import type { MitigationAction } from '@/types/mitigation'
import type { SkillTrack } from '@/utils/skillTracks'
import type { CalculationResult } from '@/utils/mitigationCalculator'
import { mergeAndSortRows } from '@/utils/tableRows'
import { computeLitCellsByEvent, computeCastMarkerCells, cellKey } from '@/utils/castWindow'
import { formatTimeWithDecimal, formatDamageValue } from '@/utils/formatters'
import { getIconUrl } from '@/utils/iconUtils'
import { getJobName } from '@/data/jobs'

export interface ExportExcelOptions {
  timeline: Timeline
  calculationResults: Map<string, CalculationResult>
  skillTracks: SkillTrack[]
  actionsById: Map<number, MitigationAction>
  showOriginalDamage: boolean
  showActualDamage: boolean
  fileName: string
}

// 颜色常量
const COLOR_JOB_HEADER_BG = 'FFF3F4F6'
const COLOR_GREEN_FILL = 'FF34D399'
const COLOR_YELLOW_FILL = 'FFFEF3C7'
const COLOR_BORDER = 'FFE5E7EB'

function thinBorder(color: string): Partial<ExcelJS.Border> {
  return { style: 'thin', color: { argb: color } }
}

const CELL_BORDER: Partial<ExcelJS.Borders> = {
  top: thinBorder(COLOR_BORDER),
  bottom: thinBorder(COLOR_BORDER),
  left: thinBorder(COLOR_BORDER),
  right: thinBorder(COLOR_BORDER),
}

/** 通过 Image + canvas 加载图片并导出为 base64（绕过 CORS） */
function loadImageAsBase64(url: string): Promise<string | null> {
  return new Promise(resolve => {
    if (typeof Image === 'undefined') {
      resolve(null)
      return
    }
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(null)
          return
        }
        ctx.drawImage(img, 0, 0)
        const dataUrl = canvas.toDataURL('image/png')
        resolve(dataUrl.split(',')[1])
      } catch {
        // tainted canvas — CORS 不支持
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    setTimeout(() => resolve(null), 5000)
    img.src = url
  })
}

export async function exportTimelineToExcel(options: ExportExcelOptions): Promise<Uint8Array> {
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
  const sanitized = (fileName || '减伤表').replace(/[\\/?*[\]:]/g, '_')
  const sheetName = sanitized.slice(0, 31) || '减伤表'
  const ws = wb.addWorksheet(sheetName)

  // 计算固定列数
  const fixedCols: string[] = ['时间', '事件']
  if (showOriginalDamage) fixedCols.push('原始伤害')
  if (showActualDamage) fixedCols.push('实际伤害')
  const fixedColCount = fixedCols.length
  const totalCols = fixedColCount + skillTracks.length

  // 设置列宽
  ws.getColumn(1).width = 10 // 时间
  ws.getColumn(2).width = 18 // 事件
  let colIdx = 3
  if (showOriginalDamage) {
    ws.getColumn(colIdx).width = 12
    colIdx++
  }
  if (showActualDamage) {
    ws.getColumn(colIdx).width = 12
    colIdx++
  }
  for (let i = 0; i < skillTracks.length; i++) {
    ws.getColumn(fixedColCount + 1 + i).width = 2.5
  }

  // ---- Row 1: 职业合并表头 ----
  const row1 = ws.getRow(1)

  // 固定列留空
  for (let c = 1; c <= fixedColCount; c++) {
    const cell = row1.getCell(c)
    cell.value = null
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_JOB_HEADER_BG } }
  }

  // 按职业分组技能列，合并相同 playerId 的连续列
  if (skillTracks.length > 0) {
    // 找出每个 playerId 的起止列
    const playerGroups: Array<{ playerId: number; job: string; startCol: number; endCol: number }> =
      []
    skillTracks.forEach((track, idx) => {
      const col = fixedColCount + 1 + idx
      const last = playerGroups[playerGroups.length - 1]
      if (last && last.playerId === track.playerId) {
        last.endCol = col
      } else {
        playerGroups.push({
          playerId: track.playerId,
          job: track.job,
          startCol: col,
          endCol: col,
        })
      }
    })

    for (const group of playerGroups) {
      const jobName = getJobName(group.job as Parameters<typeof getJobName>[0])
      if (group.startCol === group.endCol) {
        const cell = row1.getCell(group.startCol)
        cell.value = jobName
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_JOB_HEADER_BG } }
        cell.alignment = { horizontal: 'center', vertical: 'middle' }
        cell.font = { bold: true }
      } else {
        ws.mergeCells(1, group.startCol, 1, group.endCol)
        const cell = row1.getCell(group.startCol)
        cell.value = jobName
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_JOB_HEADER_BG } }
        cell.alignment = { horizontal: 'center', vertical: 'middle' }
        cell.font = { bold: true }
      }
    }

    // 为合并区域内的其他单元格也设置填充（ExcelJS 要求）
    for (let c = fixedColCount + 1; c <= totalCols; c++) {
      const cell = row1.getCell(c)
      if (!cell.fill || (cell.fill as ExcelJS.FillPattern).pattern === 'none') {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_JOB_HEADER_BG } }
      }
    }
  }

  // ---- Row 2: 列标题 + 技能图标 ----
  const row2 = ws.getRow(2)

  // 固定列标题
  fixedCols.forEach((header, i) => {
    const cell = row2.getCell(i + 1)
    cell.value = header
    cell.font = { bold: true }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.border = CELL_BORDER
    if (i >= 2) {
      // 数值列右对齐
      cell.alignment = { horizontal: 'right', vertical: 'middle' }
    }
  })

  // 技能图标：通过 Image + canvas 加载（绕过 CORS 限制）
  await Promise.all(
    skillTracks.map(async (track, idx) => {
      const col = fixedColCount + 1 + idx
      const cell = row2.getCell(col)
      cell.border = CELL_BORDER
      cell.alignment = { horizontal: 'center', vertical: 'middle' }

      const url = getIconUrl(track.actionIcon)
      if (!url) return

      try {
        const base64 = await loadImageAsBase64(url)
        if (!base64) return
        const imageId = wb.addImage({ base64, extension: 'png' })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ws.addImage(imageId, { tl: { col: col - 1, row: 1 }, br: { col, row: 2 } } as any)
      } catch {
        // 图标加载失败，静默跳过
      }
    })
  )

  // ---- 计算 lit cells 和 cast marker cells ----
  const litCellsByEvent = computeLitCellsByEvent(
    timeline.damageEvents,
    timeline.castEvents,
    actionsById
  )
  const castMarkerCells = computeCastMarkerCells(timeline.damageEvents, timeline.castEvents)

  // ---- Row 3+: 数据行 ----
  const rows = mergeAndSortRows(timeline.damageEvents, timeline.annotations)
  let rowNum = 3

  for (const tableRow of rows) {
    const wsRow = ws.getRow(rowNum)

    if (tableRow.kind === 'annotation') {
      const { annotation } = tableRow
      // 时间列
      const timeCell = wsRow.getCell(1)
      timeCell.value = formatTimeWithDecimal(annotation.time)
      timeCell.alignment = { horizontal: 'center', vertical: 'middle' }
      timeCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_YELLOW_FILL } }
      timeCell.border = CELL_BORDER

      // 文本列（合并到最后一列）
      const textCell = wsRow.getCell(2)
      textCell.value = annotation.text
      textCell.font = { italic: true }
      textCell.alignment = { horizontal: 'left', vertical: 'middle' }
      textCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_YELLOW_FILL } }
      textCell.border = CELL_BORDER

      // 合并 col2 到最后一列
      if (totalCols > 2) {
        ws.mergeCells(rowNum, 2, rowNum, totalCols)
      }
    } else {
      const { event } = tableRow

      // 时间
      const timeCell = wsRow.getCell(1)
      timeCell.value = formatTimeWithDecimal(event.time)
      timeCell.alignment = { horizontal: 'center', vertical: 'middle' }
      timeCell.border = CELL_BORDER

      // 事件名
      const nameCell = wsRow.getCell(2)
      nameCell.value = event.name
      nameCell.alignment = { horizontal: 'left', vertical: 'middle' }
      nameCell.border = CELL_BORDER

      // 数值列
      let dynCol = 3
      if (showOriginalDamage) {
        const cell = wsRow.getCell(dynCol)
        cell.value = formatDamageValue(event.damage)
        cell.alignment = { horizontal: 'right', vertical: 'middle' }
        cell.border = CELL_BORDER
        dynCol++
      }
      if (showActualDamage) {
        const result = calculationResults.get(event.id)
        const cell = wsRow.getCell(dynCol)
        cell.value = result ? formatDamageValue(result.finalDamage) : ''
        cell.alignment = { horizontal: 'right', vertical: 'middle' }
        cell.border = CELL_BORDER
        dynCol++
      }

      // 技能列
      const litSet = litCellsByEvent.get(event.id) ?? new Set<string>()
      const markerSet = castMarkerCells.get(event.id) ?? new Set<string>()

      skillTracks.forEach((track, idx) => {
        const col = fixedColCount + 1 + idx
        const cell = wsRow.getCell(col)
        const key = cellKey(track.playerId, track.actionId)

        cell.border = CELL_BORDER
        cell.alignment = { horizontal: 'center', vertical: 'middle' }

        if (markerSet.has(key)) {
          cell.value = '✓'
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_GREEN_FILL } }
          cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
        } else if (litSet.has(key)) {
          cell.value = null
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_GREEN_FILL } }
        }
      })
    }

    rowNum++
  }

  // 导出为 Uint8Array
  const arrayBuffer = await wb.xlsx.writeBuffer()
  return new Uint8Array(arrayBuffer)
}
