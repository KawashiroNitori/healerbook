import type { Job } from '@/types/timeline'

// FFLogs spec 名（无空格）→ 职业代码
export const JOB_MAP: Record<string, Job> = {
  Paladin: 'PLD',
  Warrior: 'WAR',
  DarkKnight: 'DRK',
  Gunbreaker: 'GNB',
  WhiteMage: 'WHM',
  Scholar: 'SCH',
  Astrologian: 'AST',
  Sage: 'SGE',
  Monk: 'MNK',
  Dragoon: 'DRG',
  Ninja: 'NIN',
  Samurai: 'SAM',
  Reaper: 'RPR',
  Viper: 'VPR',
  Bard: 'BRD',
  Machinist: 'MCH',
  Dancer: 'DNC',
  BlackMage: 'BLM',
  Summoner: 'SMN',
  RedMage: 'RDM',
  Pictomancer: 'PCT',
}
