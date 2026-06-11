// 一次性诊断：拉真实 targetabilityupdate 事件 + 5min 前后伤害源，验证 targetID 假设
import { readFileSync } from 'node:fs'

const vars = Object.fromEntries(
  readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8')
    .split('\n')
    .filter(l => l.includes('='))
    .map(l => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    })
)
const CODE = '7YmcBTgfyX2dPA4z'
const FIGHT = 6

async function token() {
  const r = await fetch('https://www.fflogs.com/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization:
        'Basic ' +
        Buffer.from(`${vars.FFLOGS_CLIENT_ID}:${vars.FFLOGS_CLIENT_SECRET}`).toString('base64'),
    },
    body: 'grant_type=client_credentials',
  })
  return (await r.json()).access_token
}

async function gql(t, query, variables) {
  const r = await fetch('https://www.fflogs.com/api/v2/client', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
    body: JSON.stringify({ query, variables }),
  })
  const j = await r.json()
  if (j.errors) throw new Error(JSON.stringify(j.errors))
  return j.data
}

const t = await token()

const meta = await gql(
  t,
  `query($code:String!){reportData{report(code:$code){
    fights{id name startTime endTime}
    masterData{actors(type:"NPC"){id name subType gameID}}
  }}}`,
  { code: CODE }
)
const fight = meta.reportData.report.fights.find(f => f.id === FIGHT)
console.log('=== FIGHT ===', JSON.stringify(fight))
const dur = fight.endTime - fight.startTime
console.log(`时长 ${(dur / 60000).toFixed(2)}min`)
const actors = new Map(meta.reportData.report.masterData.actors.map(a => [a.id, a]))

const ta = await gql(
  t,
  `query($code:String!,$s:Float!,$e:Float!){reportData{report(code:$code){
    events(startTime:$s,endTime:$e,dataType:All,filterExpression:"type=\\"targetabilityupdate\\"",limit:10000){data nextPageTimestamp}
  }}}`,
  { code: CODE, s: fight.startTime, e: fight.endTime }
)
const taEvents = ta.reportData.report.events.data
console.log(`\n=== targetabilityupdate: ${taEvents.length} 条, nextPage=${ta.reportData.report.events.nextPageTimestamp} ===`)
for (const e of taEvents) {
  const relS = (e.timestamp - fight.startTime) / 1000
  console.log(
    `${relS.toFixed(1)}s(${(relS / 60).toFixed(2)}m) src=${e.sourceID} tgt=${e.targetID ?? 'UNDEF'} able=${e.targetable} [${actors.get(e.sourceID)?.name ?? '?'}]`
  )
}
if (taEvents.length) console.log('首条原始:', JSON.stringify(taEvents[0]))

const win0 = fight.startTime + 270000
const win1 = fight.startTime + 330000
const dmg = await gql(
  t,
  `query($code:String!,$s:Float!,$e:Float!){reportData{report(code:$code){
    events(startTime:$s,endTime:$e,dataType:DamageTaken,hostilityType:Friendlies,limit:5000){data}
  }}}`,
  { code: CODE, s: win0, e: win1 }
)
const srcCount = new Map()
for (const e of dmg.reportData.report.events.data) {
  const k = `${e.sourceID} (${actors.get(e.sourceID)?.name ?? '?'})`
  srcCount.set(k, (srcCount.get(k) ?? 0) + 1)
}
console.log('\n=== 4.5~5.5min 窗口伤害 source 分布 ===')
for (const [k, v] of [...srcCount.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${v}x src=${k}`)

console.log('\n=== enemies(NPC) 列表 ===')
for (const a of actors.values()) console.log(`  id=${a.id} ${a.name} (gameID=${a.gameID})`)
