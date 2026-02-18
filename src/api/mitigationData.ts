/**
 * 减伤技能数据加载 API
 */

import skillsData from '@/data/mitigationSkills.json'
import type { MitigationSkill, Job } from '@/types/mitigation'

/**
 * 获取所有减伤技能
 */
export function getAllMitigationSkills(): MitigationSkill[] {
  return skillsData.skills as MitigationSkill[]
}

/**
 * 根据职业获取减伤技能
 */
export function getSkillsByJob(job: Job): MitigationSkill[] {
  return skillsData.skills.filter(skill => skill.job === job) as MitigationSkill[]
}

/**
 * 根据 ID 获取减伤技能
 */
export function getSkillById(id: string): MitigationSkill | undefined {
  return skillsData.skills.find(skill => skill.id === id) as MitigationSkill | undefined
}

/**
 * 获取所有团队减伤技能
 */
export function getPartyWideSkills(): MitigationSkill[] {
  return skillsData.skills.filter(skill => skill.isPartyWide) as MitigationSkill[]
}

/**
 * 根据职业获取团队减伤技能
 */
export function getPartyWideSkillsByJob(job: Job): MitigationSkill[] {
  return skillsData.skills.filter(
    skill => skill.job === job && skill.isPartyWide
  ) as MitigationSkill[]
}

/**
 * 获取数据版本信息
 */
export function getDataVersion(): {
  version: string
  lastUpdated: string
  source: string
} {
  return {
    version: skillsData.version,
    lastUpdated: skillsData.lastUpdated,
    source: skillsData.source,
  }
}
