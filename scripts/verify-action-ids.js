#!/usr/bin/env node
/**
 * 验证 mitigationActions.new.ts 中的技能 ID 是 mitigationActions.ts 的超集
 *
 * 用法: node scripts/verify-action-ids.js
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 文件路径
const oldFile = path.join(__dirname, '../src/data/mitigationActions.ts')
const newFile = path.join(__dirname, '../src/data/mitigationActions.new.ts')

/**
 * 从文件中提取所有技能 ID
 * @param {string} filePath - 文件路径
 * @returns {Set<number>} - 技能 ID 集合
 */
function extractActionIds(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8')
  const ids = new Set()

  // 匹配 id: 数字 的模式
  const regex = /\bid:\s*(\d+)/g
  let match

  while ((match = regex.exec(content)) !== null) {
    ids.add(parseInt(match[1], 10))
  }

  return ids
}

/**
 * 主函数
 */
function main() {
  console.log('🔍 验证技能 ID 完整性...\n')

  // 检查文件是否存在
  if (!fs.existsSync(oldFile)) {
    console.error(`❌ 错误: 找不到文件 ${oldFile}`)
    process.exit(1)
  }

  if (!fs.existsSync(newFile)) {
    console.error(`❌ 错误: 找不到文件 ${newFile}`)
    process.exit(1)
  }

  // 提取 ID
  const oldIds = extractActionIds(oldFile)
  const newIds = extractActionIds(newFile)

  console.log(`📊 统计信息:`)
  console.log(`   旧文件 (mitigationActions.ts):     ${oldIds.size} 个技能`)
  console.log(`   新文件 (mitigationActions.new.ts): ${newIds.size} 个技能`)
  console.log()

  // 检查是否为超集
  const missingIds = []
  const extraIds = []

  for (const id of oldIds) {
    if (!newIds.has(id)) {
      missingIds.push(id)
    }
  }

  for (const id of newIds) {
    if (!oldIds.has(id)) {
      extraIds.push(id)
    }
  }

  // 输出结果
  if (missingIds.length === 0) {
    console.log('✅ 验证通过: 新文件包含旧文件的所有技能 ID')

    if (extraIds.length > 0) {
      console.log(`\n📝 新增技能 (${extraIds.length} 个):`)
      extraIds.sort((a, b) => a - b).forEach(id => {
        console.log(`   - ${id}`)
      })
    }

    console.log(`\n✨ 新文件是旧文件的超集 (${newIds.size} ≥ ${oldIds.size})`)
    process.exit(0)
  } else {
    console.error(`❌ 验证失败: 新文件缺少 ${missingIds.length} 个技能 ID\n`)
    console.error('缺少的技能 ID:')
    missingIds.sort((a, b) => a - b).forEach(id => {
      console.error(`   - ${id}`)
    })

    if (extraIds.length > 0) {
      console.log(`\n新增的技能 ID (${extraIds.length} 个):`)
      extraIds.sort((a, b) => a - b).forEach(id => {
        console.log(`   - ${id}`)
      })
    }

    process.exit(1)
  }
}

// 运行主函数
try {
  main()
} catch (error) {
  console.error('❌ 脚本执行出错:', error.message)
  process.exit(1)
}
