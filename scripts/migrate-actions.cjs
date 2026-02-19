const fs = require('fs')
const path = require('path')

const filePath = path.join(__dirname, '../src/data/mitigationActions.ts')
let content = fs.readFileSync(filePath, 'utf-8')

console.log('开始迁移技能数据...')

// 1. 替换 job: 'XXX' 为 jobs: ['XXX']
const jobMatches = content.match(/job: '[A-Z]+'/g)
console.log(`找到 ${jobMatches ? jobMatches.length : 0} 个 job 字段`)

content = content.replace(/job: '([A-Z]+)'/g, "jobs: ['$1']")

// 2. 为互斥技能添加 uniqueGroup 字段
const uniqueGroups = [
  // 远程减伤组 (15% 减伤，15 秒)
  { ids: [7405, 16889, 16012], name: '远程减伤组 (行吟/策动/防守之桑巴)' },

  // 学者盾组 (部分护盾效果互斥)
  { ids: [185, 37013], name: '学者盾组 (鼓舞/意气轩昂)' },

  // 贤者盾组 (部分护盾效果互斥)
  { ids: [24310, 37034], name: '贤者盾组 (整体论/均衡预后II)' },
]

uniqueGroups.forEach(({ ids, name }) => {
  console.log(`\n处理互斥组: ${name}`)
  ids.forEach(id => {
    // 计算该技能的互斥技能列表（组内其他技能）
    const mutuallyExclusiveIds = ids.filter(otherId => otherId !== id)

    // 在 id 行之后、jobs 行之前插入 uniqueGroup
    const regex = new RegExp(`(id: ${id},\\s*\\n(?:.*\\n)*?)(\\s*jobs:)`, 'g')
    const before = content
    content = content.replace(regex, `$1      uniqueGroup: [${mutuallyExclusiveIds.join(', ')}],\n$2`)
    if (content !== before) {
      console.log(`  ✓ 为技能 ID ${id} 添加 uniqueGroup: [${mutuallyExclusiveIds.join(', ')}]`)
    } else {
      console.log(`  ✗ 未找到技能 ID ${id}`)
    }
  })
})

fs.writeFileSync(filePath, content, 'utf-8')
console.log('\n✅ 数据迁移完成')
console.log(`文件已更新: ${filePath}`)
