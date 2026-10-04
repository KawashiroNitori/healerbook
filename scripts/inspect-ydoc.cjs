/**
 * Yjs 文档/增量诊断工具(协作时间轴排障用)。
 *
 * 用法:
 *   node scripts/inspect-ydoc.cjs overview <file.ydoc>          # 整 doc 体积/墓碑/client/各 root 分布
 *   node scripts/inspect-ydoc.cjs update   <file.ydoc> [base]   # 解析单条 update;给 base 则解析落点
 *   node scripts/inspect-ydoc.cjs cast     <file.ydoc>          # castEvents 抖动定位(同一 cast 的 actionId 被改写次数)
 *
 * 背景:一个内容很少的协作文档可能因为「同 trackGroup 的 cast 数 > 组成员数」触发
 * 自动重映射 effect 在两个变体间无限横跳,每次 set 留一个墓碑,把 doc 撑到 MB 级。
 * 这些子命令用来量化墓碑、定位是哪个 cast/字段在抖动。
 */
const fs = require('fs')
const Y = require('yjs')

function load(file) {
  const u8 = new Uint8Array(fs.readFileSync(file))
  const doc = new Y.Doc()
  Y.applyUpdate(doc, u8)
  return { u8, doc }
}
function shareNames(doc) {
  const m = new Map()
  for (const [name, type] of doc.share) m.set(type, name)
  return m
}
function makeRootOf(names) {
  return function rootOf(item) {
    let t = item.parent,
      g = 0
    while (t && t._item && g++ < 1000) t = t._item.parent
    return names.get(t) || '(unknown)'
  }
}
function contentBytes(content) {
  const n = content.constructor.name
  try {
    switch (n) {
      case 'ContentString':
        return Buffer.byteLength(content.str, 'utf8')
      case 'ContentAny':
      case 'ContentJSON':
        return JSON.stringify(content.arr).length
      case 'ContentBinary':
        return content.content.byteLength
      case 'ContentEmbed':
        return JSON.stringify(content.embed).length
      case 'ContentFormat':
        return String(content.key).length + JSON.stringify(content.value).length
      default:
        return 0
    }
  } catch {
    return 0
  }
}

function overview(file) {
  const { u8, doc } = load(file)
  console.log(`file: ${file}  ${u8.length} bytes (${(u8.length / 1048576).toFixed(2)} MB)\n`)
  const { ds } = Y.decodeUpdate(u8)
  let dsRanges = 0,
    dsLen = 0
  for (const [, arr] of ds.clients) {
    dsRanges += arr.length
    for (const r of arr) dsLen += r.len
  }
  let items = 0,
    gc = 0,
    deleted = 0
  const perClient = []
  for (const [client, arr] of doc.store.clients) {
    let it = 0,
      g = 0,
      del = 0
    for (const s of arr) {
      if (s.constructor.name === 'GC') (g++, gc++)
      else {
        it++, items++
        if (s.deleted) (del++, deleted++)
      }
    }
    perClient.push({ client, structs: arr.length, items: it, gc: g, deleted: del })
  }
  perClient.sort((a, b) => b.structs - a.structs)
  console.log(`structs: items=${items} gc=${gc} deletedItems=${deleted}  clients=${doc.store.clients.size}`)
  console.log(`deleteSet: clients=${ds.clients.size} ranges=${dsRanges} deletedClockLen=${dsLen}`)
  console.log('top clients by struct count:')
  for (const c of perClient.slice(0, 10))
    console.log(`  client ${c.client}: structs=${c.structs} items=${c.items} gc=${c.gc} deleted=${c.deleted}`)

  const names = shareNames(doc)
  const rootOf = makeRootOf(names)
  const byType = {}
  for (const [, arr] of doc.store.clients) {
    for (const s of arr) {
      if (s.constructor.name === 'GC') continue
      const root = rootOf(s)
      const t = (byType[root] ||= { live: 0, deleted: 0, items: 0, deletedItems: 0 })
      const cb = contentBytes(s.content)
      t.items++
      if (s.deleted) (t.deleted += cb), t.deletedItems++
      else t.live += cb
    }
  }
  console.log('\nestimated content bytes by root type:')
  for (const [root, t] of Object.entries(byType).sort((a, b) => b[1].items - a[1].items))
    console.log(`  ${root}: items=${t.items} deletedItems=${t.deletedItems} liveBytes=${t.live} deletedBytes=${t.deleted}`)
}

function update(file, base) {
  const u8 = new Uint8Array(fs.readFileSync(file))
  console.log(`file: ${file}  ${u8.length} bytes\n`)
  const { structs, ds } = Y.decodeUpdate(u8)
  let dsRanges = 0,
    dsLen = 0
  for (const [, arr] of ds.clients) {
    dsRanges += arr.length
    for (const r of arr) dsLen += r.len
  }
  console.log(`structs=${structs.length}  deleteSet: ranges=${dsRanges} deletedClockLen=${dsLen}`)
  const preview = c => {
    const n = c.constructor.name
    if (n === 'ContentAny' || n === 'ContentJSON') return n + ' ' + JSON.stringify(c.arr).slice(0, 120)
    if (n === 'ContentString') return 'ContentString ' + JSON.stringify(c.str.slice(0, 120))
    if (n === 'ContentType') return 'ContentType <Y.' + (c.type && c.type.constructor ? c.type.constructor.name : '?') + '>'
    if (n === 'ContentDeleted') return 'ContentDeleted(' + c.len + ')'
    return n
  }
  for (const s of structs.slice(0, 40)) {
    if (s.constructor.name !== 'Item') {
      console.log(`  ${s.constructor.name} ${s.id.client}:${s.id.clock} len=${s.length}`)
      continue
    }
    console.log(`  ${s.id.client}:${s.id.clock} len=${s.length} sub=${JSON.stringify(s.parentSub)}  ${preview(s.content)}`)
  }
  if (!base) return
  const b = load(base).doc
  const names = shareNames(b)
  const rootOf = makeRootOf(names)
  Y.applyUpdate(b, u8)
  console.log(`\nresolved against base ${base}:`)
  for (const s of structs) {
    if (s.constructor.name !== 'Item') continue
    const arr = b.store.clients.get(s.id.client)
    const found = arr && arr.find(it => it.id && it.id.clock <= s.id.clock && it.id.clock + it.length > s.id.clock)
    if (!found || found.constructor.name === 'GC') {
      console.log(`  ${s.id.client}:${s.id.clock} -> GC/not resolvable`)
      continue
    }
    console.log(`  ${s.id.client}:${s.id.clock} root=${rootOf(found)} sub=${JSON.stringify(found.parentSub)} ${preview(found.content)}`)
  }
}

function cast(file) {
  const { doc } = load(file)
  const names = shareNames(doc)
  const rootOf = makeRootOf(names)
  const isRoot = t => t && t._item == null && names.has(t)
  const containers = new Map()
  const actionVals = new Map()
  const actionCount = new Map()
  for (const [, arr] of doc.store.clients) {
    for (const s of arr) {
      if (s.constructor.name !== 'Item') continue
      if (rootOf(s) !== 'castEvents') continue
      if (isRoot(s.parent) && s.content.constructor.name === 'ContentType') {
        containers.set(s.id.client + ':' + s.id.clock, { eventId: s.parentSub, type: s.content.type })
        continue
      }
      if (s.parentSub === 'actionId') {
        const c = s.parent && s.parent._item ? s.parent._item.id : null
        const key = c ? c.client + ':' + c.clock : '(none)'
        actionCount.set(key, (actionCount.get(key) || 0) + 1)
        const m = actionVals.get(key) || new Map()
        actionVals.set(key, m)
        const cn = s.content.constructor.name
        const v = cn === 'ContentAny' ? JSON.stringify(s.content.arr[0]) : cn === 'ContentDeleted' ? '(gc墓碑)' : cn
        m.set(v, (m.get(v) || 0) + 1)
      }
    }
  }
  const counts = [...actionCount.values()]
  const total = counts.reduce((a, b) => a + b, 0)
  console.log(`cast 容器=${containers.size}  actionId 写入总数=${total}  涉及容器=${actionCount.size}`)
  console.log(`平均每容器=${(total / (actionCount.size || 1)).toFixed(1)}  最多=${counts.length ? Math.max(...counts) : 0}`)
  const top = [...actionCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  console.log('\n被改写最多的 cast:')
  for (const [key, n] of top) {
    const c = containers.get(key)
    let pid, ts, aid
    if (c && c.type)
      try {
        pid = c.type.get('playerId')
        ts = c.type.get('timestamp')
        aid = c.type.get('actionId')
      } catch {}
    console.log(`  ${key} eventId=${c ? c.eventId : '?'} writes=${n}  当前: player=${pid} t=${ts} actionId=${aid}`)
    const vals = [...(actionVals.get(key) || new Map()).entries()].sort((a, b) => b[1] - a[1])
    console.log('    值分布: ' + vals.slice(0, 6).map(([v, c2]) => `${v}×${c2}`).join('  '))
  }
}

/**
 * 解析一批 update 里的 actionId 修改,定位到具体 cast(timestamp/playerId)+ 新值 + 来源 client。
 * 需要一份能解析出 cast 容器的 base 快照;update 按给定顺序累积应用(还原"互相覆盖"的时序)。
 * node scripts/inspect-ydoc.cjs actionedits <base.ydoc> <update1.ydoc> [update2.ydoc ...]
 */
function actionEdits(baseFile, updateFiles) {
  const base = load(baseFile).doc
  const names = shareNames(base)
  const rootOf = makeRootOf(names)
  if (!updateFiles.length) {
    console.error('需要至少一个 update 文件')
    process.exit(1)
  }
  for (const f of updateFiles) {
    const u8 = new Uint8Array(fs.readFileSync(f))
    const { structs } = Y.decodeUpdate(u8)
    Y.applyUpdate(base, u8) // 累积应用,使后续 update 的 parent 可解析
    for (const s of structs) {
      if (s.constructor.name !== 'Item') continue
      const arr = base.store.clients.get(s.id.client)
      const found =
        arr && arr.find(it => it.id.clock <= s.id.clock && it.id.clock + it.length > s.id.clock)
      if (!found || found.constructor.name === 'GC') continue
      if (found.parentSub !== 'actionId' || rootOf(found) !== 'castEvents') continue
      const cast = found.parent // cast 的 Y.Map
      let t, p
      try {
        t = cast.get('timestamp')
        p = cast.get('playerId')
      } catch {}
      // 值从 raw struct 取(base 里可能已被对冲删除、GC 成 ContentDeleted);timestamp 从 resolved parent 取
      const val = s.content.constructor.name === 'ContentAny' ? s.content.arr[0] : '?'
      console.log(`${f}  client=${s.id.client}  player=${p}  t=${t}  actionId -> ${val}`)
    }
  }
}

const argv = process.argv.slice(2)
const [cmd, file, arg] = argv
if (!cmd || !file) {
  console.error(
    '用法:\n' +
      '  node scripts/inspect-ydoc.cjs overview <file.ydoc>\n' +
      '  node scripts/inspect-ydoc.cjs update   <file.ydoc> [base.ydoc]\n' +
      '  node scripts/inspect-ydoc.cjs cast     <file.ydoc>\n' +
      '  node scripts/inspect-ydoc.cjs actionedits <base.ydoc> <update...>'
  )
  process.exit(1)
}
if (cmd === 'overview') overview(file)
else if (cmd === 'update') update(file, arg)
else if (cmd === 'cast') cast(file)
else if (cmd === 'actionedits') actionEdits(file, argv.slice(2))
else {
  console.error('未知子命令: ' + cmd)
  process.exit(1)
}
