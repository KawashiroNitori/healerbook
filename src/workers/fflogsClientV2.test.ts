/**
 * FFLogs V2 客户端：V2 → FFLogsReport 映射测试
 *
 * 重点覆盖"敌方 actor 是否被正确映射进 enemies"——这是目标减导入判定的数据来源。
 * boss 的 type 派生（subType "Boss" → type "Boss"）已对真实 API 验证。
 */

import { describe, it, expect } from 'vitest'
import { mapV2ReportToReport } from './fflogsClientV2'
import { buildBossIds } from '@/utils/fflogsImporter'

describe('mapV2ReportToReport', () => {
  const payload = {
    title: 'Test Report',
    startTime: 1000,
    endTime: 2000,
    fights: [],
    owner: { name: 'Owner' },
    phases: [],
    masterData: {
      actors: [{ id: 1, name: 'Player1', type: 'Player', subType: 'WhiteMage', server: 'S' }],
      enemyActors: [
        { id: 500, name: 'The Boss', type: 'NPC', subType: 'Boss', server: '' },
        { id: 700, name: 'Add', type: 'NPC', subType: 'NPC', server: '' },
      ],
      abilities: [{ gameID: 25867, name: 'Glare III', type: 'Spell', icon: 'i' }],
    },
  }

  it('报告基础字段映射（code/startTime/endTime）', () => {
    const report = mapV2ReportToReport(payload, 'ABC123')
    expect(report.code).toBe('ABC123')
    expect(report.startTime).toBe(1000)
    expect(report.endTime).toBe(2000)
  })

  it('玩家 actor 映射进 friendlies（type 取 subType 即职业）', () => {
    const report = mapV2ReportToReport(payload, 'ABC123')
    expect(report.friendlies?.map(f => f.id)).toEqual([1])
    expect(report.friendlies?.[0].type).toBe('WhiteMage')
  })

  it('敌方 actor 映射进 enemies，boss 的 type 由 subType 派生为 "Boss"', () => {
    const report = mapV2ReportToReport(payload, 'ABC123')
    expect(report.enemies?.map(e => e.id).sort((a, b) => a - b)).toEqual([500, 700])
    expect(report.enemies?.find(e => e.id === 500)?.type).toBe('Boss')
    expect(report.enemies?.find(e => e.id === 700)?.type).toBe('NPC')
  })

  it('映射出的 enemies 能让 buildBossIds 识别 boss、排除小怪', () => {
    const report = mapV2ReportToReport(payload, 'ABC123')
    const bossIds = buildBossIds(report.enemies, 'whatever')
    expect([...bossIds]).toContain(500)
    expect([...bossIds]).not.toContain(700)
  })
})
