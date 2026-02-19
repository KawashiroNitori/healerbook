const fs = require('fs')
const path = require('path')

const filePath = path.join(__dirname, '../src/data/mitigationActions.ts')
const content = fs.readFileSync(filePath, 'utf-8')

console.log('开始合并重复的技能...')

// 解析 actions 数组
const actionsMatch = content.match(/actions: \[([\s\S]*)\]\s*\}/m)
if (!actionsMatch) {
  console.error('无法找到 actions 数组')
  process.exit(1)
}

const actionsContent = actionsMatch[1]

// 解析每个技能对象
const actionRegex = /\{[\s\S]*?\n\s{4}\}/g
const actions = []
let match

while ((match = actionRegex.exec(actionsContent)) !== null) {
  const actionStr = match[0]

  // 提取关键字段
  const idMatch = actionStr.match(/id: (\d+),/)
  const nameMatch = actionStr.match(/name: '([^']+)',/)
  const jobsMatch = actionStr.match(/jobs: \[([^\]]+)\],/)

  if (idMatch && nameMatch && jobsMatch) {
    const id = parseInt(idMatch[1])
    const name = nameMatch[1]
    const jobs = jobsMatch[1].split(',').map(j => j.trim().replace(/'/g, ''))

    actions.push({
      id,
      name,
      jobs,
      fullText: actionStr
    })
  }
}

console.log(`解析到 ${actions.length} 个技能`)

// 按 ID 分组
const groupedById = new Map()
actions.forEach(action => {
  if (!groupedById.has(action.id)) {
    groupedById.set(action.id, [])
  }
  groupedById.get(action.id).push(action)
})

// 找出重复的 ID
const duplicateIds = []
groupedById.forEach((group, id) => {
  if (group.length > 1) {
    duplicateIds.push(id)
    console.log(`\n技能 ID ${id} (${group[0].name}) 有 ${group.length} 个重复条目`)
    console.log(`  职业: ${group.map(a => a.jobs.join(', ')).join(' | ')}`)
  }
})

if (duplicateIds.length === 0) {
  console.log('\n没有发现重复的技能 ID')
  process.exit(0)
}

// 合并重复的技能
console.log('\n开始合并...')

let newContent = content

duplicateIds.forEach(id => {
  const group = groupedById.get(id)

  // 合并所有职业
  const allJobs = []
  group.forEach(action => {
    allJobs.push(...action.jobs)
  })

  // 使用第一个条目作为模板，更新 jobs 字段
  const template = group[0].fullText
  const mergedAction = template.replace(
    /jobs: \[[^\]]+\],/,
    `jobs: [${allJobs.map(j => `'${j}'`).join(', ')}],`
  )

  console.log(`\n合并技能 ${id} (${group[0].name}):`)
  console.log(`  原始: ${group.length} 个条目`)
  console.log(`  合并后职业: [${allJobs.join(', ')}]`)

  // 替换第一个条目
  newContent = newContent.replace(group[0].fullText, mergedAction)

  // 删除其他重复条目
  for (let i = 1; i < group.length; i++) {
    // 需要同时删除前面的逗号和换行
    const toRemove = ',\n' + group[i].fullText
    newContent = newContent.replace(toRemove, '')
  }
})

// 写回文件
fs.writeFileSync(filePath, newContent, 'utf-8')

console.log('\n✅ 合并完成')
console.log(`文件已更新: ${filePath}`)
