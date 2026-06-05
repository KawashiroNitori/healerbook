/**
 * FFLogs V2 客户端：V2→V1 报告映射测试
 *
 * 重点覆盖"敌方 actor 是否被正确映射进 enemies"——这是目标减导入判定的数据来源。
 * boss 的 type 派生（subType "Boss" → type "Boss"）已对真实 API 验证。
 */

import { describe, it, expect } from 'vitest'
import { mapV2ReportToV1Report } from './fflogsClientV2'
import { buildBossIds } from '@/utils/fflogsImporter'

describe('mapV2ReportToV1Report', () => {
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

  it('玩家 actor 映射进 friendlies（type 取 subType 即职业）', () => {
    const v1 = mapV2ReportToV1Report(payload)
    expect(v1.friendlies?.map(f => f.id)).toEqual([1])
    expect(v1.friendlies?.[0].type).toBe('WhiteMage')
  })

  it('敌方 actor 映射进 enemies，boss 的 type 由 subType 派生为 "Boss"', () => {
    const v1 = mapV2ReportToV1Report(payload)
    expect(v1.enemies?.map(e => e.id).sort((a, b) => a - b)).toEqual([500, 700])
    expect(v1.enemies?.find(e => e.id === 500)?.type).toBe('Boss')
    expect(v1.enemies?.find(e => e.id === 700)?.type).toBe('NPC')
  })

  it('映射出的 enemies 能让 buildBossIds 识别 boss、排除小怪', () => {
    const v1 = mapV2ReportToV1Report(payload)
    const bossIds = buildBossIds(v1.enemies, 'whatever')
    expect([...bossIds]).toContain(500)
    expect([...bossIds]).not.toContain(700)
  })
})
