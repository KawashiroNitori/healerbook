// ==UserScript==
// @name         Healerbook · FFLogs Samples Queue Enqueuer
// @namespace    healerbook
// @version      1.3.3
// @description  在 FFLogs zone/reports 页面随机抽 20 个 report code 上报给 /api/samples-queue/enqueue
// @match        https://www.fflogs.com/zone/reports*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      *
// @run-at       document-idle
// ==/UserScript==

;(function () {
  'use strict'

  const DEFAULT_API_BASE = 'https://xivhealer.com'
  const INTERVAL_OPTIONS = [300, 600, 900, 1200, 1500, 1800] // 5/10/15/20/25/30 分钟
  const DEFAULT_INTERVAL = 300
  const JITTER_RATIO = 0.2 // 每次刷新在基准间隔 ±20% 内随机
  const SAMPLE_SIZE = 20
  const STORAGE_PREFIX = 'healerbook_fflogs_enqueuer_'
  // 检测到 CF 校验后等多久再判定为人机校验：JS Challenge 一般 3-5s 内自动跳转
  // 若过了这段时间还停留在校验页，几乎可断定是 Turnstile 之类的人机校验
  const HUMAN_CHALLENGE_DELAY_MS = 10000

  // ---- 设置持久化 ----
  function loadSetting(key, fallback) {
    try {
      if (typeof GM_getValue === 'function') {
        const v = GM_getValue(STORAGE_PREFIX + key, undefined)
        return v === undefined ? fallback : v
      }
    } catch (_) {}
    const raw = localStorage.getItem(STORAGE_PREFIX + key)
    if (raw === null) return fallback
    try {
      return JSON.parse(raw)
    } catch {
      return fallback
    }
  }
  function saveSetting(key, value) {
    try {
      if (typeof GM_setValue === 'function') {
        GM_setValue(STORAGE_PREFIX + key, value)
        return
      }
    } catch (_) {}
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value))
  }

  const state = {
    enabled: !!loadSetting('enabled', false),
    autoRefresh: !!loadSetting('autoRefresh', false),
    intervalSeconds: loadSetting('intervalSeconds', DEFAULT_INTERVAL),
    apiBase: String(loadSetting('apiBase', DEFAULT_API_BASE)),
    authToken: String(loadSetting('authToken', '')),
    barkKey: String(loadSetting('barkKey', '')),
    // 刷新前写入页面 #filter-duration-text 的值；空字符串表示不应用
    durationSeconds: String(loadSetting('durationSeconds', '')),
    // 自动填充开关：当 enqueue 响应中的 maxDurationSec 大于当前值时写回输入框
    autoFillDuration: !!loadSetting('autoFillDuration', false),
    lastStatus: '',
  }

  // 本次页面加载中自动上报流程是否已跑过；用于在用户切换"启用"开关时避免重复执行
  let pageRunDone = false

  function jitteredDelaySeconds(baseSeconds) {
    const jitter = (Math.random() * 2 - 1) * JITTER_RATIO
    return Math.max(1, Math.round(baseSeconds * (1 + jitter)))
  }

  // ---- 解析 URL 参数 ----
  const params = new URLSearchParams(window.location.search)
  const zone = params.get('zone') ? Number(params.get('zone')) : null
  const boss = params.get('boss') ? Number(params.get('boss')) : null

  if (!zone || !boss) {
    console.info('[FFLogs Enqueuer] zone / boss 缺失，脚本不生效')
    return
  }

  // ---- Cloudflare 挑战页检测 ----
  // CF 的 JS Challenge / Turnstile 都会用同一 URL 渲染一个挑战页面，DOM 不是 FFLogs 内容。
  // 命中后脚本停手：JS Challenge 通过后 CF 自动跳转回真页面，本脚本会随之重新执行；
  // Turnstile 需用户手动点击，不应继续自动刷新去触发更多挑战。
  function isCloudflareChallenge() {
    if (/Just a moment|Checking your browser|Attention Required/i.test(document.title)) return true
    if (
      document.querySelector(
        '#challenge-form, #challenge-stage, #cf-please-wait, ' +
          '.cf-browser-verification, .cf-im-under-attack, ' +
          'iframe[src*="challenges.cloudflare.com"], ' +
          'script[src*="challenges.cloudflare.com"]'
      )
    )
      return true
    return false
  }

  // ---- Bark 推送 ----
  // 文档：https://bark.day.app/
  // POST JSON 到 https://api.day.app/{device_key}，字段 title / body / url / group / level
  function sendWebhook() {
    if (!state.barkKey) {
      console.warn('[FFLogs Enqueuer] Bark device key 未配置，跳过通知')
      return
    }
    const url = `https://api.day.app/${encodeURIComponent(state.barkKey)}`
    const payload = JSON.stringify({
      title: 'Healerbook Enqueuer',
      body: `Cloudflare 人机校验未通过 zone=${zone} boss=${boss}`,
      url: window.location.href, // 点击通知跳到 FFLogs 页面便于手动解锁
      group: 'Healerbook',
      level: 'timeSensitive', // 绕过手机专注模式
    })

    if (typeof GM_xmlhttpRequest === 'function') {
      GM_xmlhttpRequest({
        method: 'POST',
        url,
        headers: { 'Content-Type': 'application/json' },
        data: payload,
        onload: r => console.info('[FFLogs Enqueuer] Bark sent', r.status),
        onerror: r => console.error('[FFLogs Enqueuer] Bark failed', r),
      })
      return
    }
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      mode: 'no-cors',
    }).catch(e => console.error('[FFLogs Enqueuer] Bark failed', e))
  }

  // 检测到挑战后等一段时间再复查：JS Challenge 会自动跳转（本定时器随导航销毁），
  // 只有人机校验会让我们走到回调里——这时通知 webhook 并停下
  function watchForHumanChallenge() {
    setStatus(`检测到 Cloudflare 校验，观察 ${HUMAN_CHALLENGE_DELAY_MS / 1000}s...`)
    setTimeout(() => {
      if (!isCloudflareChallenge()) return
      setStatus('Cloudflare 人机校验持续未通过，触发 webhook，已停止后续操作')
      sendWebhook()
    }, HUMAN_CHALLENGE_DELAY_MS)
  }

  // ---- 抽取 report code ----
  function extractReportCodes() {
    const codes = new Set()
    const tables = document.querySelectorAll('table')
    const scope = tables.length > 0 ? tables : [document.body]
    for (const root of scope) {
      const anchors = root.querySelectorAll('a[href*="/reports/"]')
      for (const a of anchors) {
        const href = a.getAttribute('href') || ''
        const m = href.match(/\/reports\/([A-Za-z0-9]+)(?:[\/?#].*)?$/)
        if (m && m[1]) codes.add(m[1])
      }
    }
    return [...codes]
  }

  function pickRandom(arr, n) {
    const copy = [...arr]
    const out = []
    while (out.length < n && copy.length > 0) {
      const idx = Math.floor(Math.random() * copy.length)
      out.push(copy.splice(idx, 1)[0])
    }
    return out
  }

  // ---- HTTP ----
  function postEnqueue(payload) {
    const url = state.apiBase.replace(/\/+$/, '') + '/api/samples-queue/enqueue'
    const headers = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + state.authToken,
    }
    const body = JSON.stringify(payload)

    if (typeof GM_xmlhttpRequest === 'function') {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: 'POST',
          url,
          headers,
          data: body,
          onload: r => resolve({ status: r.status, body: r.responseText }),
          onerror: r => reject(new Error('网络错误: ' + (r && r.error ? r.error : 'unknown'))),
          ontimeout: () => reject(new Error('请求超时')),
          timeout: 30000,
        })
      })
    }

    return fetch(url, { method: 'POST', headers, body }).then(async r => ({
      status: r.status,
      body: await r.text(),
    }))
  }

  async function runOnce() {
    const codes = extractReportCodes()
    if (codes.length === 0) {
      setStatus('未找到 report 链接')
      return
    }
    if (!state.authToken) {
      setStatus('未配置 Auth Token，跳过上报')
      return
    }
    const sample = pickRandom(codes, SAMPLE_SIZE)
    setStatus(`提交中：${sample.length} 个 report (encounterId=${boss})`)
    try {
      const res = await postEnqueue({ encounterId: boss, reportCodes: sample })
      if (res.status >= 200 && res.status < 300) {
        let parsed = null
        try {
          parsed = JSON.parse(res.body)
        } catch (_) {}
        if (parsed) {
          maybeAutoFillDuration(parsed.maxDurationSec)
          setStatus(
            `OK: recv=${parsed.received} match=${parsed.matched} ins=${parsed.inserted} dup=${parsed.skippedDuplicates} err=${(parsed.errors || []).length}`
          )
        } else {
          setStatus(`OK (${res.status})`)
        }
      } else {
        setStatus(`失败 ${res.status}: ${(res.body || '').slice(0, 200)}`)
      }
    } catch (err) {
      setStatus('错误: ' + (err && err.message ? err.message : String(err)))
    }
  }

  // ---- UI ----
  let statusEl = null
  let countdownEl = null
  let durationEl = null
  let refreshTimer = null
  let countdownTimer = null
  let refreshAt = 0

  // 把面板里填的 duration 写到页面 #filter-duration-text 上；只接受合法正整数
  function syncDurationToPage() {
    const raw = String(state.durationSeconds || '').trim()
    if (!/^[1-9]\d*$/.test(raw)) return
    const target = document.getElementById('filter-duration-text')
    if (!target) return
    target.value = raw
    target.dispatchEvent(new Event('input', { bubbles: true }))
    target.dispatchEvent(new Event('change', { bubbles: true }))
  }

  // 探测页面上下文里 updateDuration 是否是函数。<script> 在 appendChild 时同步执行，
  // 通过 documentElement 属性把结果回传到 userscript 上下文
  function pageHasUpdateDuration() {
    const flagAttr = 'data-hb-has-updateduration'
    document.documentElement.removeAttribute(flagAttr)
    const s = document.createElement('script')
    s.textContent = `if (typeof updateDuration === "function") document.documentElement.setAttribute(${JSON.stringify(flagAttr)}, '1')`
    document.documentElement.appendChild(s)
    s.remove()
    const has = document.documentElement.hasAttribute(flagAttr)
    document.documentElement.removeAttribute(flagAttr)
    return has
  }

  // 调用页面上下文里的 updateDuration()。userscript 与页面是隔离的 JS 上下文，
  // 不能直接拿到页面定义的函数，注入一段 <script> 即可在页面上下文执行
  function callPageUpdateDuration() {
    const s = document.createElement('script')
    s.textContent =
      'try { if (typeof updateDuration === "function") updateDuration() } catch (e) { console.error(e) }'
    document.documentElement.appendChild(s)
    s.remove()
  }

  // 自动刷新真正执行的动作：
  //   有 updateDuration() —— 调用它做局部刷新（duration 在面板输入框变更时已实时同步）
  //   没有 updateDuration() —— 退回到整页 reload
  function triggerPageRefresh() {
    if (!pageHasUpdateDuration()) {
      setStatus('页面未提供 updateDuration()，退回整页刷新')
      window.location.reload()
      return
    }
    callPageUpdateDuration()
  }

  // 收到 enqueue 响应后，按开关决定是否用 maxDurationSec 回填面板里的 duration。
  // 回填视作面板输入框被修改，同步把新值写到页面 #filter-duration-text 上
  function maybeAutoFillDuration(maxSec) {
    if (!state.autoFillDuration) return
    if (typeof maxSec !== 'number' || !Number.isFinite(maxSec) || maxSec <= 0) return
    const cur = parseInt(String(state.durationSeconds || '').trim(), 10)
    if (Number.isFinite(cur) && cur >= maxSec) return
    state.durationSeconds = String(Math.floor(maxSec))
    saveSetting('durationSeconds', state.durationSeconds)
    if (durationEl) durationEl.value = state.durationSeconds
    syncDurationToPage()
  }

  function setStatus(msg) {
    state.lastStatus = msg
    const ts = new Date().toLocaleTimeString()
    if (statusEl) statusEl.textContent = '[' + ts + '] ' + msg
    console.info('[FFLogs Enqueuer]', msg)
  }

  function scheduleRefresh() {
    if (refreshTimer) {
      clearTimeout(refreshTimer)
      refreshTimer = null
    }
    if (countdownTimer) {
      clearInterval(countdownTimer)
      countdownTimer = null
    }
    if (countdownEl) countdownEl.textContent = ''
    // 自动刷新独立于"启用上报"——只受自动刷新开关控制
    if (!state.autoRefresh) return

    const actualSeconds = jitteredDelaySeconds(state.intervalSeconds)
    refreshAt = Date.now() + actualSeconds * 1000
    refreshTimer = setTimeout(() => {
      try {
        triggerPageRefresh()
      } finally {
        // 触发后再排下一次，形成循环刷新；不依赖页面 reload 重新跑脚本
        scheduleRefresh()
      }
    }, actualSeconds * 1000)
    if (countdownEl) {
      countdownTimer = setInterval(() => {
        const remaining = Math.max(0, Math.round((refreshAt - Date.now()) / 1000))
        countdownEl.textContent = `下次刷新：${remaining}s / ${actualSeconds}s（基准 ${state.intervalSeconds}s ±${Math.round(JITTER_RATIO * 100)}%）`
      }, 1000)
      countdownEl.textContent = `下次刷新：${actualSeconds}s / ${actualSeconds}s（基准 ${state.intervalSeconds}s ±${Math.round(JITTER_RATIO * 100)}%）`
    }
  }

  function escapeAttr(s) {
    return String(s).replace(
      /[&"<>]/g,
      c => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[c]
    )
  }

  function buildPanel() {
    const panel = document.createElement('div')
    panel.id = 'healerbook-enqueuer-panel'
    panel.style.cssText = [
      'position:fixed',
      'right:16px',
      'bottom:16px',
      'z-index:2147483647',
      'background:#1f2937',
      'color:#f3f4f6',
      'padding:12px',
      'border-radius:8px',
      'font:12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'box-shadow:0 4px 16px rgba(0,0,0,0.35)',
      'min-width:280px',
      'max-width:360px',
    ].join(';')

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <strong>Samples Queue Enqueuer</strong>
        <button id="hb-collapse" type="button" style="background:none;color:#9ca3af;border:none;cursor:pointer;font-size:14px;padding:0 4px;">−</button>
      </div>
      <div id="hb-body">
        <div style="margin-bottom:6px;color:#9ca3af;">zone=${zone}　boss=${boss}</div>
        <label style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
          <input id="hb-enabled" type="checkbox" ${state.enabled ? 'checked' : ''} />
          <strong>启用上报</strong>
        </label>
        <label style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
          <input id="hb-auto" type="checkbox" ${state.autoRefresh ? 'checked' : ''} />
          自动刷新
        </label>
        <label style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
          刷新间隔：
          <select id="hb-interval" style="padding:2px 4px;background:#111827;color:#f3f4f6;border:1px solid #374151;border-radius:4px;">
            ${INTERVAL_OPTIONS.map(s => `<option value="${s}" ${s === state.intervalSeconds ? 'selected' : ''}>${s / 60} 分钟</option>`).join('')}
          </select>
        </label>
        <label style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
          Duration (秒)：
          <input id="hb-duration" type="text" inputmode="numeric" value="${escapeAttr(state.durationSeconds)}" placeholder="正整数；空则不写入" style="flex:1;min-width:0;padding:2px 4px;background:#111827;color:#f3f4f6;border:1px solid #374151;border-radius:4px;" />
        </label>
        <label style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
          <input id="hb-autofill" type="checkbox" ${state.autoFillDuration ? 'checked' : ''} />
          自动填充 duration（取响应最大值）
        </label>
        <details style="margin-bottom:6px;">
          <summary style="cursor:pointer;color:#9ca3af;">高级设置</summary>
          <div style="margin-top:6px;">
            <label style="display:block;margin-bottom:6px;">
              API Base：
              <input id="hb-base" type="text" value="${escapeAttr(state.apiBase)}" style="width:100%;padding:2px 4px;background:#111827;color:#f3f4f6;border:1px solid #374151;border-radius:4px;" />
            </label>
            <label style="display:block;margin-bottom:6px;">
              Auth Token：
              <input id="hb-token" type="password" value="${escapeAttr(state.authToken)}" style="width:100%;padding:2px 4px;background:#111827;color:#f3f4f6;border:1px solid #374151;border-radius:4px;" />
            </label>
            <label style="display:block;margin-bottom:6px;">
              Bark Device Key（人机校验时推送，留空则不通知）：
              <input id="hb-bark" type="text" value="${escapeAttr(state.barkKey)}" placeholder="只填 device key，不要带 URL" style="width:100%;padding:2px 4px;background:#111827;color:#f3f4f6;border:1px solid #374151;border-radius:4px;" />
            </label>
          </div>
        </details>
        <div style="display:flex;gap:6px;margin-bottom:6px;">
          <button id="hb-run" type="button" style="flex:1;padding:4px 8px;background:#2563eb;color:white;border:none;border-radius:4px;cursor:pointer;">立即上报</button>
        </div>
        <div id="hb-status" style="color:#9ca3af;font-size:11px;word-break:break-all;">就绪</div>
        <div id="hb-countdown" style="color:#9ca3af;font-size:11px;margin-top:4px;"></div>
      </div>
    `

    document.body.appendChild(panel)
    statusEl = panel.querySelector('#hb-status')
    countdownEl = panel.querySelector('#hb-countdown')

    const enabledEl = panel.querySelector('#hb-enabled')
    const autoEl = panel.querySelector('#hb-auto')
    const intervalEl = panel.querySelector('#hb-interval')
    const baseEl = panel.querySelector('#hb-base')
    const tokenEl = panel.querySelector('#hb-token')
    const barkEl = panel.querySelector('#hb-bark')
    const runEl = panel.querySelector('#hb-run')
    const collapseEl = panel.querySelector('#hb-collapse')
    const bodyEl = panel.querySelector('#hb-body')
    durationEl = panel.querySelector('#hb-duration')
    const autofillEl = panel.querySelector('#hb-autofill')

    enabledEl.addEventListener('change', () => {
      state.enabled = enabledEl.checked
      saveSetting('enabled', state.enabled)
      // 自动刷新已与"启用上报"解耦：不在这里调度刷新，仅控制 enqueue 流程
      if (!state.enabled) {
        setStatus('已禁用')
        return
      }
      if (pageRunDone) {
        setStatus('已启用')
      } else {
        runAutoFlow()
      }
    })
    autoEl.addEventListener('change', () => {
      state.autoRefresh = autoEl.checked
      saveSetting('autoRefresh', state.autoRefresh)
      scheduleRefresh()
    })
    intervalEl.addEventListener('change', () => {
      state.intervalSeconds = Number(intervalEl.value)
      saveSetting('intervalSeconds', state.intervalSeconds)
      if (state.autoRefresh) scheduleRefresh()
    })
    baseEl.addEventListener('change', () => {
      state.apiBase = baseEl.value.trim() || DEFAULT_API_BASE
      saveSetting('apiBase', state.apiBase)
    })
    tokenEl.addEventListener('change', () => {
      state.authToken = tokenEl.value.trim()
      saveSetting('authToken', state.authToken)
    })
    barkEl.addEventListener('change', () => {
      state.barkKey = barkEl.value.trim()
      saveSetting('barkKey', state.barkKey)
    })
    durationEl.addEventListener('change', () => {
      state.durationSeconds = durationEl.value.trim()
      saveSetting('durationSeconds', state.durationSeconds)
      // 用户改动时立刻同步到页面 #filter-duration-text；非法值由 syncDurationToPage 自身忽略
      syncDurationToPage()
    })
    autofillEl.addEventListener('change', () => {
      state.autoFillDuration = autofillEl.checked
      saveSetting('autoFillDuration', state.autoFillDuration)
    })
    runEl.addEventListener('click', () => {
      runOnce()
    })
    collapseEl.addEventListener('click', () => {
      const hidden = bodyEl.style.display === 'none'
      bodyEl.style.display = hidden ? '' : 'none'
      collapseEl.textContent = hidden ? '−' : '+'
    })
  }

  // ---- 等表格 ----
  // 中途若进入 CF 挑战页（极少见，CF 通常一开始就接管），直接抛错让 main 跳过自动刷新
  function waitForTable(timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const start = Date.now()
      const tick = () => {
        if (isCloudflareChallenge()) {
          reject(new Error('CF_CHALLENGE'))
          return
        }
        if (extractReportCodes().length >= 1) {
          resolve()
          return
        }
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`表格内没有任何 report 链接（${timeoutMs}ms 超时）`))
          return
        }
        setTimeout(tick, 300)
      }
      tick()
    })
  }

  // 自动上报流程：等表格 → 上报。自动刷新由 main() / 自动刷新开关独立调度，不在此处启动
  // 受 state.enabled 门控；pageRunDone 保证一次页面加载里只跑一次
  async function runAutoFlow() {
    if (pageRunDone) return
    if (!state.enabled) return

    // 当前就在 CF 挑战页：交给 watchForHumanChallenge。
    // JS Challenge 几秒后会自动跳转，本次执行随之销毁、新页面会重新运行脚本；
    // 人机校验通不过，超时后触发 webhook 并停手。
    if (isCloudflareChallenge()) {
      watchForHumanChallenge()
      return
    }

    let cfBlocked = false
    try {
      await waitForTable()
      await runOnce()
      pageRunDone = true
    } catch (err) {
      const msg = err && err.message ? err.message : String(err)
      if (msg === 'CF_CHALLENGE') {
        cfBlocked = true
        watchForHumanChallenge()
      } else {
        setStatus('页面等待失败：' + msg)
      }
    }
    // 被 CF 挡住时取消 main 里预排的自动刷新——继续刷新只会触发更多挑战
    if (cfBlocked && refreshTimer) {
      clearTimeout(refreshTimer)
      refreshTimer = null
      if (countdownTimer) {
        clearInterval(countdownTimer)
        countdownTimer = null
      }
      if (countdownEl) countdownEl.textContent = ''
    }
  }

  async function main() {
    buildPanel()
    // 自动刷新独立于启用上报：无论是否启用上报都按开关启动
    if (state.autoRefresh) scheduleRefresh()
    if (!state.enabled) {
      setStatus('未启用')
      return
    }
    await runAutoFlow()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main, { once: true })
  } else {
    main()
  }
})()
