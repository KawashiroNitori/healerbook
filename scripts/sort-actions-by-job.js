#!/usr/bin/env node
/**
 * 按职业对 mitigationActions.new.ts 中的技能进行排序
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 职业顺序
const JOB_ORDER = {
  // 坦克
  PLD: 1,
  WAR: 2,
  DRK: 3,
  GNB: 4,
  // 治疗
  WHM: 5,
  SCH: 6,
  AST: 7,
  SGE: 8,
  // 近战
  MNK: 9,
  DRG: 10,
  NIN: 11,
  SAM: 12,
  RPR: 13,
  VPR: 14,
  // 远程物理
  BRD: 15,
  MCH: 16,
  DNC: 17,
  // 远程魔法
  BLM: 18,
  SMN: 19,
  RDM: 20,
  PCT: 21,
}

/**
 * 提取技能的职业优先级
 */
function getJobPriority(actionText) {
  const jobsMatch = actionText.match(/jobs:\s*\[([^\]]+)\]/)
  if (!jobsMatch) return 999

  const jobsStr = jobsMatch[1]
  const jobs = jobsStr.split(',').map((j) => j.trim().replace(/['"]/g, ''))

  if (jobs.length > 0) {
    const firstJobPriority = JOB_ORDER[jobs[0]] || 999
    // 如果是多职业技能,在该职业组内排到最后 (加 0.5)
    if (jobs.length > 1) {
      return firstJobPriority + 0.5
    }
    return firstJobPriority
  }
  return 999
}

/**
 * 提取所有技能定义
 */
function extractActions(content) {
  // 找到 actions: [ 的位置
  const startMatch = content.match(/actions:\s*\[/)
  if (!startMatch) {
    console.error('❌ 错误: 找不到 actions: [')
    process.exit(1)
  }

  const startPos = startMatch.index + startMatch[0].length

  // 找到对应的 ]
  let bracketCount = 1
  let pos = startPos
  while (pos < content.length && bracketCount > 0) {
    if (content[pos] === '[') bracketCount++
    else if (content[pos] === ']') bracketCount--
    pos++
  }

  const endPos = pos - 1

  const prefix = content.substring(0, startMatch.index)
  const actionsContent = content.substring(startPos, endPos)
  const suffix = content.substring(endPos)

  // 分割技能 (通过 },\n 来分割,但要注意嵌套的对象)
  const actions = []
  let currentAction = ''
  let braceCount = 0

  for (const char of actionsContent) {
    currentAction += char
    if (char === '{') {
      braceCount++
    } else if (char === '}') {
      braceCount--
      if (braceCount === 0 && currentAction.trim()) {
        actions.push(currentAction.trim().replace(/,\s*$/, ''))
        currentAction = ''
      }
    }
  }

  return { prefix, actions, suffix }
}

/**
 * 主函数
 */
function main() {
  const inputFile = path.join(__dirname, '../src/data/mitigationActions.new.ts')

  console.log('🔄 按职业排序技能...\n')

  // 读取文件
  const content = fs.readFileSync(inputFile, 'utf-8')

  // 提取技能
  const { prefix, actions, suffix } = extractActions(content)

  console.log(`📊 找到 ${actions.length} 个技能`)

  // 按职业排序
  const sortedActions = actions.sort((a, b) => {
    return getJobPriority(a) - getJobPriority(b)
  })

  // 重新组装
  const actionsStr = sortedActions.join(',\n\n    ')
  const newContent = prefix + 'actions: [\n    ' + actionsStr + ',\n  ' + suffix

  // 写回文件
  fs.writeFileSync(inputFile, newContent, 'utf-8')

  console.log('✅ 排序完成')
  console.log(`   输出: ${inputFile}`)
}

try {
  main()
} catch (error) {
  console.error('❌ 脚本执行出错:', error.message)
  process.exit(1)
}
