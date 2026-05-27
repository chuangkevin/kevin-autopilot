import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { createHash } from 'node:crypto'
import { getKeyStatus, importGeminiKeys, clearStoredGeminiKeys } from './keys.js'
import { loadRuntimeOverrides, saveRuntimeOverrides, RUNTIME_OVERRIDE_SCHEMA, RuntimeOverrideError, getEffectiveConfig } from './runtime-overrides.js'
import { openRadarDatabase, listProblemCards, upsertRawSignal, makeSignalId } from './problem-cards.js'
import { fetchExternalSignals } from './external-sources.js'
import { runRadarPipeline } from './radar.js'
import { getSetting, setSetting } from './settings-store.js'
import { getOpenCodeServers, getOpenCodeTextModel, listOpenCodeModels, invalidateProvider } from './provider.js'
import { APP_VERSION } from './version.js'
import type { AutopilotConfig, KeyStatusSummary, ProblemCard, ProblemSignal } from './types.js'

const DEFAULT_PORT = 3023
const MAX_BODY_BYTES = 32 * 1024
const NO_STORE = { 'cache-control': 'no-store, max-age=0', pragma: 'no-cache', expires: '0' }

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

// Secret writes (Gemini key import/clear) are restricted to loopback, private
// LAN, Docker bridge, and Tailscale (100.64/10) ranges. OpenCode config and
// scan-interval overrides are not secrets and stay open.
function isTrustedSettingsAddress(address: string): boolean {
  const normalized = address.replace(/^::ffff:/, '')
  if (normalized === '::1' || normalized === '127.0.0.1') return true
  const parts = normalized.split('.').map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const [a, b] = parts
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
}

function headerAddresses(value: string | string[] | undefined): string[] {
  if (!value) return []
  const values = Array.isArray(value) ? value : [value]
  return values.flatMap((entry) => entry.split(',')).map((entry) => entry.trim()).filter(Boolean)
}

function isTrustedSettingsRequest(req: IncomingMessage): boolean {
  if (!isTrustedSettingsAddress(req.socket.remoteAddress ?? '')) return false
  const forwarded = [...headerAddresses(req.headers['x-forwarded-for']), ...headerAddresses(req.headers['x-real-ip'])]
  return forwarded.every(isTrustedSettingsAddress)
}

interface OpenCodeUiStatus {
  servers: Array<{ id: string; label: string; baseUrl: string }>
  serversSource: 'none' | 'setting' | 'env'
  textModel: string
  textModelSource: 'default' | 'setting' | 'env'
}

function getOpenCodeUiStatus(config: AutopilotConfig): OpenCodeUiStatus {
  const dbServersRaw = getSetting(config, 'opencode_servers')
  const servers = getOpenCodeServers(config)
  let serversSource: OpenCodeUiStatus['serversSource'] = 'none'
  if (dbServersRaw && dbServersRaw.trim()) serversSource = 'setting'
  else if (getSetting(config, 'opencode_url')) serversSource = 'setting'
  else if (servers.length > 0) serversSource = 'env'
  const textFromSetting = getSetting(config, 'opencode_text_model')
  const textFromEnv = process.env.OPENCODE_MODEL?.trim() ?? ''
  return {
    servers,
    serversSource,
    textModel: getOpenCodeTextModel(config),
    textModelSource: textFromSetting ? 'setting' : textFromEnv ? 'env' : 'default',
  }
}

function readBody(req: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > maxBytes) { req.destroy(); reject(new Error('body too large')); return }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function json(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data)
  res.writeHead(status, { ...NO_STORE, 'content-type': 'application/json' })
  res.end(body)
}

function renderCard(card: ProblemCard): string {
  const sourceLabel = card.signalId.includes('reddit') ? 'reddit' : card.signalId.includes('manual') ? 'manual' : 'hn'
  const date = card.createdAt.slice(0, 16).replace('T', ' ')
  const seedsHtml = card.ideaSeeds.length > 0
    ? `<div class="idea-seeds">
        <div class="idea-seeds-toggle" onclick="toggleSeeds(this)">▾ Possible directions</div>
        <ul class="idea-seeds-list">${card.ideaSeeds.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ul>
       </div>`
    : ''
  return `<div class="card">
  <div class="card-meta">
    <span class="card-source">${escapeHtml(sourceLabel)}</span>
    <span>${escapeHtml(date)}</span>
    ${card.sourceUrl ? `<a href="${escapeAttr(card.sourceUrl)}" target="_blank" rel="noopener" style="color:#6366f1;text-decoration:none">→ source</a>` : ''}
  </div>
  <div class="card-row"><span class="card-key">Who</span><span class="card-val">${escapeHtml(card.whoIsInPain)}</span></div>
  <div class="card-row"><span class="card-key">Pain</span><span class="card-val">${escapeHtml(card.pain)}</span></div>
  <div class="card-row"><span class="card-key">Context</span><span class="card-val">${escapeHtml(card.context)}</span></div>
  <div class="card-row"><span class="card-key">Workaround</span><span class="card-val">${escapeHtml(card.currentWorkaround)}</span></div>
  <div class="card-row"><span class="card-key">Why now</span><span class="card-val">${escapeHtml(card.urgencySignal)}</span></div>
  ${seedsHtml}
</div>`
}

function renderPage(cards: ProblemCard[]): string {
  const cardsHtml = cards.length > 0
    ? cards.map(renderCard).join('\n')
    : '<div class="empty">// 尚無問題卡片 — 點「Scan Now」或貼上文字</div>'
  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>World Problem Radar</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0f172a;color:#e2e8f0;font-family:'Courier New',monospace;min-height:100vh}
header{padding:16px 24px;border-bottom:1px solid rgba(148,163,184,.15);display:flex;justify-content:space-between;align-items:center}
.logo{font-size:14px;font-weight:700;letter-spacing:.12em;color:#6366f1}
.header-actions{display:flex;gap:10px;align-items:center}
.settings-link{color:#475569;text-decoration:none;font-size:13px;padding:8px 12px;border-radius:10px;border:1px solid rgba(148,163,184,.2)}
.settings-link:hover{color:#a5b4fc;border-color:rgba(99,102,241,.4)}
.scan-btn{background:rgba(99,102,241,.15);border:1px solid rgba(99,102,241,.4);color:#a5b4fc;padding:8px 18px;border-radius:10px;font-size:13px;cursor:pointer;font-family:inherit}
.scan-btn:hover{background:rgba(99,102,241,.25)}
main{max-width:780px;margin:0 auto;padding:24px 16px}
.paste-bar{display:flex;gap:8px;margin-bottom:24px}
.paste-input{flex:1;background:rgba(15,23,42,.7);border:1px solid rgba(148,163,184,.2);border-radius:12px;padding:12px 16px;color:#e2e8f0;font-size:14px;font-family:inherit;min-width:0}
.paste-input::placeholder{color:#334155}
.paste-btn{background:rgba(30,27,75,.4);border:1px solid rgba(99,102,241,.4);border-radius:12px;color:#a5b4fc;font-size:13px;padding:12px 18px;cursor:pointer;white-space:nowrap;font-family:inherit}
.feed-label{font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:.1em;margin-bottom:12px}
.feed{display:flex;flex-direction:column;gap:12px}
.card{background:rgba(15,23,42,.7);border:1px solid rgba(148,163,184,.12);border-radius:16px;padding:18px 20px}
.card-meta{font-size:11px;color:#475569;margin-bottom:12px;display:flex;gap:12px;align-items:center}
.card-source{color:#6366f1}
.card-row{display:grid;grid-template-columns:90px 1fr;gap:4px 12px;font-size:13px;margin-bottom:6px}
.card-key{color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:.05em;padding-top:2px}
.card-val{color:#cbd5e1;line-height:1.5}
.idea-seeds{margin-top:12px}
.idea-seeds-toggle{font-size:12px;color:#475569;cursor:pointer;user-select:none;padding:4px 0}
.idea-seeds-list{display:none;margin-top:6px;padding-left:14px}
.idea-seeds-list li{font-size:13px;color:#94a3b8;line-height:1.6}
.empty{text-align:center;padding:60px 0;color:#475569;font-size:14px}
</style>
</head>
<body>
<header>
  <div class="logo">/// WORLD PROBLEM RADAR</div>
  <div class="header-actions">
    <a class="settings-link" href="/settings">⚙ Settings</a>
    <button class="scan-btn" onclick="triggerScan(this)">Scan Now</button>
  </div>
</header>
<main>
  <div class="paste-bar">
    <input class="paste-input" id="paste-input" placeholder="貼上任何文字作為問題訊號…" />
    <button class="paste-btn" onclick="submitPaste()">送出</button>
  </div>
  <div class="feed-label">// PROBLEM FEED</div>
  <div class="feed">${cardsHtml}</div>
</main>
<script>
async function triggerScan(btn){
  btn.disabled=true;btn.textContent='Scanning…';
  try{await fetch('/api/radar/scan',{method:'POST'});location.reload()}
  catch{btn.textContent='Error';setTimeout(()=>{btn.disabled=false;btn.textContent='Scan Now'},2000)}
}
async function submitPaste(){
  var input=document.getElementById('paste-input');
  var text=input.value.trim();if(!text)return;
  await fetch('/api/radar/paste',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text})});
  input.value='';location.reload();
}
function toggleSeeds(el){
  var list=el.nextElementSibling;if(!list)return;
  var open=list.style.display==='block';
  list.style.display=open?'none':'block';
  el.textContent=open?'▾ Possible directions':'▴ Possible directions';
}
</script>
</body>
</html>`
}

function renderSettingsPage(
  config: AutopilotConfig,
  keyStatus: KeyStatusSummary,
  opencode: OpenCodeUiStatus,
  scan: { enabled: boolean; intervalMin: number },
): string {
  const storedSuffixes = keyStatus.storedSuffixes.length > 0
    ? keyStatus.storedSuffixes.map((s) => `<span class="chip">${escapeHtml(s)}</span>`).join('')
    : '<span class="muted">無</span>'
  const envSuffixes = keyStatus.envSuffixes.length > 0
    ? keyStatus.envSuffixes.map((s) => `<span class="chip">${escapeHtml(s)}</span>`).join('')
    : '<span class="muted">無</span>'
  const serverLines = opencode.servers.map((s) => s.baseUrl).join('\n')
  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Radar Settings</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0f172a;color:#e2e8f0;font-family:'Courier New',monospace;min-height:100vh}
header{padding:16px 24px;border-bottom:1px solid rgba(148,163,184,.15);display:flex;justify-content:space-between;align-items:center}
.logo{font-size:14px;font-weight:700;letter-spacing:.12em;color:#6366f1}
.back{color:#475569;text-decoration:none;font-size:13px}
.back:hover{color:#a5b4fc}
main{max-width:720px;margin:0 auto;padding:24px 16px;display:flex;flex-direction:column;gap:20px}
section{background:rgba(15,23,42,.7);border:1px solid rgba(148,163,184,.12);border-radius:16px;padding:18px 20px}
h2{font-size:13px;color:#a5b4fc;letter-spacing:.08em;text-transform:uppercase;margin-bottom:12px}
.row{font-size:13px;color:#94a3b8;margin-bottom:8px;line-height:1.6}
.muted{color:#475569}
.chip{display:inline-block;background:rgba(99,102,241,.12);border:1px solid rgba(99,102,241,.25);color:#a5b4fc;border-radius:8px;padding:2px 8px;margin:2px;font-size:12px}
textarea,input{width:100%;background:rgba(15,23,42,.9);border:1px solid rgba(148,163,184,.2);border-radius:10px;padding:10px 12px;color:#e2e8f0;font-size:13px;font-family:inherit;margin-top:8px}
textarea{min-height:90px;resize:vertical}
.btn{background:rgba(99,102,241,.15);border:1px solid rgba(99,102,241,.4);color:#a5b4fc;padding:8px 16px;border-radius:10px;font-size:13px;cursor:pointer;font-family:inherit;margin-top:10px;margin-right:8px}
.btn:hover{background:rgba(99,102,241,.25)}
.btn.danger{background:rgba(239,68,68,.1);border-color:rgba(239,68,68,.4);color:#fca5a5}
.label{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-top:12px;display:block}
.src{font-size:11px;color:#475569;margin-left:6px}
.msg{font-size:12px;margin-top:8px;min-height:16px}
.msg.ok{color:#4ade80}.msg.err{color:#fca5a5}
.inline{display:flex;align-items:center;gap:8px;margin-top:8px}
.inline input[type=checkbox]{width:auto;margin:0}
.inline input[type=number]{width:120px;margin:0}
</style>
</head>
<body>
<header>
  <div class="logo">/// RADAR SETTINGS</div>
  <a class="back" href="/">← back to feed</a>
</header>
<main>
  <section>
    <h2>AI — Gemini Keys</h2>
    <div class="row">已儲存: ${keyStatus.storedCount} 把 ${storedSuffixes}</div>
    <div class="row">環境變數: ${keyStatus.envCount} 把 ${envSuffixes}</div>
    <div class="row muted">總可用: ${keyStatus.totalAvailable} 把（AI pipeline 需要至少 1 把可用 key 或 OpenCode）</div>
    <span class="label">貼上 Gemini API keys（每行一把，或逗號分隔）</span>
    <textarea id="keys-input" placeholder="AIzaSy..."></textarea>
    <button class="btn" onclick="importKeys()">匯入</button>
    <button class="btn danger" onclick="clearKeys()">清除全部</button>
    <div class="msg" id="keys-msg"></div>
  </section>

  <section>
    <h2>AI — OpenCode（選用，優先於 Gemini）</h2>
    <div class="row">目前來源: ${escapeHtml(opencode.serversSource)} · model: ${escapeHtml(opencode.textModel)}<span class="src">(${escapeHtml(opencode.textModelSource)})</span></div>
    <span class="label">OpenCode server URLs（每行一個）</span>
    <textarea id="oc-servers" placeholder="http://host:port">${escapeHtml(serverLines)}</textarea>
    <span class="label">Text model id</span>
    <input id="oc-model" value="${escapeAttr(opencode.textModel)}" placeholder="openai/gpt-5.5" />
    <button class="btn" onclick="saveOpenCode()">儲存</button>
    <button class="btn" onclick="loadModels()">列出可用 models</button>
    <button class="btn danger" onclick="clearOpenCode()">清除</button>
    <div class="msg" id="oc-msg"></div>
  </section>

  <section>
    <h2>Radar Scan</h2>
    <div class="inline"><input type="checkbox" id="scan-enabled" ${scan.enabled ? 'checked' : ''}/> <label for="scan-enabled">啟用背景掃描</label></div>
    <span class="label">掃描間隔（分鐘，最小 1）</span>
    <div class="inline"><input type="number" id="scan-interval" min="1" max="1440" value="${scan.intervalMin}" /></div>
    <button class="btn" onclick="saveScan()">儲存</button>
    <div class="msg" id="scan-msg"></div>
  </section>
</main>
<script>
function show(id,text,ok){var e=document.getElementById(id);e.textContent=text;e.className='msg '+(ok?'ok':'err')}
async function importKeys(){
  var keys=document.getElementById('keys-input').value.trim();if(!keys){show('keys-msg','請先貼上 key',false);return}
  try{var r=await fetch('/api/keys/import',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({keys})});
  var d=await r.json();if(!r.ok){show('keys-msg',d.error||'匯入失敗',false);return}
  show('keys-msg','匯入 '+d.imported+' 把，忽略 '+d.ignored+'，總共 '+d.totalStored,true);setTimeout(()=>location.reload(),900)}
  catch(e){show('keys-msg',String(e),false)}
}
async function clearKeys(){
  if(!confirm('確定清除所有已儲存的 Gemini key？'))return;
  try{var r=await fetch('/api/keys/clear',{method:'POST'});if(!r.ok){var d=await r.json();show('keys-msg',d.error||'清除失敗',false);return}
  show('keys-msg','已清除',true);setTimeout(()=>location.reload(),700)}catch(e){show('keys-msg',String(e),false)}
}
async function saveOpenCode(){
  var servers=document.getElementById('oc-servers').value.split('\\n').map(s=>s.trim()).filter(Boolean);
  var textModel=document.getElementById('oc-model').value.trim();
  try{var r=await fetch('/api/settings/opencode',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({servers,textModel})});
  if(!r.ok){var d=await r.json();show('oc-msg',d.error||'儲存失敗',false);return}
  show('oc-msg','已儲存',true);setTimeout(()=>location.reload(),700)}catch(e){show('oc-msg',String(e),false)}
}
async function clearOpenCode(){
  if(!confirm('清除 OpenCode 設定？'))return;
  try{var r=await fetch('/api/settings/opencode',{method:'DELETE'});if(!r.ok){show('oc-msg','清除失敗',false);return}
  show('oc-msg','已清除',true);setTimeout(()=>location.reload(),700)}catch(e){show('oc-msg',String(e),false)}
}
async function loadModels(){
  show('oc-msg','載入中…',true);
  try{var r=await fetch('/api/settings/opencode/models');var d=await r.json();
  if(d.warning){show('oc-msg',d.warning,false);return}
  show('oc-msg',(d.models||[]).slice(0,40).map(m=>m.id).join('  ·  ')||'無 model',true)}
  catch(e){show('oc-msg',String(e),false)}
}
async function saveScan(){
  var enabled=document.getElementById('scan-enabled').checked;
  var intervalMs=Math.round(Number(document.getElementById('scan-interval').value)*60000);
  try{var r=await fetch('/api/runtime-overrides',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({'radarScan.enabled':enabled,'radarScan.intervalMs':intervalMs})});
  var d=await r.json();if(!r.ok){show('scan-msg',d.error||'儲存失敗',false);return}
  show('scan-msg','已儲存（重啟容器後生效）',true)}catch(e){show('scan-msg',String(e),false)}
}
</script>
</body>
</html>`
}

export function createWebServer(config: AutopilotConfig): Server {
  const server = createServer(async (req, res) => {
    const url = req.url ?? '/'
    const method = req.method ?? 'GET'

    try {
      if (method === 'GET' && url === '/health') {
        return json(res, 200, { status: 'ok', version: APP_VERSION, environment: config.environment })
      }

      if (method === 'GET' && (url === '/' || url === '/index.html')) {
        const db = openRadarDatabase(config)
        const cards = listProblemCards(db, { limit: 50 })
        db.close()
        res.writeHead(200, { ...NO_STORE, 'content-type': 'text/html; charset=utf-8' })
        return res.end(renderPage(cards))
      }

      if (method === 'GET' && url === '/settings') {
        const keyStatus = await getKeyStatus(config)
        const opencode = getOpenCodeUiStatus(config)
        const effective = await getEffectiveConfig(config)
        const intervalMs = effective.radarScan?.intervalMs ?? 4 * 60 * 60 * 1000
        const scan = { enabled: effective.radarScan?.enabled !== false, intervalMin: Math.round(intervalMs / 60_000) }
        res.writeHead(200, { ...NO_STORE, 'content-type': 'text/html; charset=utf-8' })
        return res.end(renderSettingsPage(config, keyStatus, opencode, scan))
      }

      if (method === 'GET' && url === '/api/radar/cards') {
        const db = openRadarDatabase(config)
        const cards = listProblemCards(db, { limit: 50 })
        db.close()
        return json(res, 200, cards)
      }

      if (method === 'POST' && url === '/api/radar/scan') {
        void (async () => {
          try {
            const effective = await getEffectiveConfig(config)
            const signals = await fetchExternalSignals()
            const db = openRadarDatabase(effective)
            await runRadarPipeline(effective, db, signals)
            db.close()
          } catch { /* ignore */ }
        })()
        return json(res, 202, { status: 'scan started' })
      }

      if (method === 'POST' && url === '/api/radar/paste') {
        const body = await readBody(req)
        const parsed = JSON.parse(body) as { text?: string }
        const text = String(parsed.text ?? '').trim()
        if (text.length < 10) return json(res, 400, { error: 'text too short' })

        const id = makeSignalId('manual', `manual:${createHash('sha256').update(text).digest('hex').slice(0, 8)}`, text.slice(0, 120))
        const signal: ProblemSignal = {
          id,
          sourceType: 'manual',
          sourceName: 'manual',
          title: text.slice(0, 120),
          snippet: text.slice(0, 1200),
          fetchedAt: new Date().toISOString(),
        }
        const db = openRadarDatabase(config)
        upsertRawSignal(db, signal)
        db.close()

        void (async () => {
          try {
            const effective = await getEffectiveConfig(config)
            const db2 = openRadarDatabase(effective)
            await runRadarPipeline(effective, db2, [signal])
            db2.close()
          } catch { /* ignore */ }
        })()
        return json(res, 202, { status: 'signal ingested' })
      }

      if (method === 'GET' && (url === '/api/keys' || url === '/api/keys/status')) {
        const status = await getKeyStatus(config)
        return json(res, 200, status)
      }

      if (method === 'POST' && url === '/api/keys/import') {
        if (!isTrustedSettingsRequest(req)) return json(res, 403, { error: 'key import requires loopback, private LAN, or Tailscale access' })
        const body = await readBody(req)
        const { keys } = JSON.parse(body) as { keys?: string }
        if (!keys) return json(res, 400, { error: 'missing keys' })
        const summary = await importGeminiKeys(config, keys)
        return json(res, 200, summary)
      }

      if (method === 'POST' && url === '/api/keys/clear') {
        if (!isTrustedSettingsRequest(req)) return json(res, 403, { error: 'key clear requires loopback, private LAN, or Tailscale access' })
        const status = await clearStoredGeminiKeys(config)
        return json(res, 200, status)
      }

      if (method === 'GET' && url === '/api/settings/opencode') {
        return json(res, 200, getOpenCodeUiStatus(config))
      }

      if (method === 'POST' && url === '/api/settings/opencode') {
        const body = JSON.parse(await readBody(req)) as { servers?: unknown; textModel?: unknown }
        if (body.servers !== undefined) {
          // Store as a newline-delimited string. parseServers wraps each line
          // in { baseUrl }. A JSON array of bare URL strings would NOT survive
          // parseServers (it expects objects), so never JSON.stringify here.
          const serialized = Array.isArray(body.servers)
            ? body.servers.map((s) => String(s).trim()).filter(Boolean).join('\n')
            : String(body.servers ?? '')
          await setSetting(config, 'opencode_servers', serialized)
          await setSetting(config, 'opencode_url', '')
        }
        if (typeof body.textModel === 'string') await setSetting(config, 'opencode_text_model', body.textModel)
        invalidateProvider()
        return json(res, 201, { ok: true, status: getOpenCodeUiStatus(config) })
      }

      if (method === 'DELETE' && url === '/api/settings/opencode') {
        await setSetting(config, 'opencode_servers', '')
        await setSetting(config, 'opencode_text_model', '')
        await setSetting(config, 'opencode_url', '')
        invalidateProvider()
        return json(res, 200, { ok: true, status: getOpenCodeUiStatus(config) })
      }

      if (method === 'GET' && url === '/api/settings/opencode/models') {
        return json(res, 200, await listOpenCodeModels(config))
      }

      if (method === 'GET' && url === '/api/runtime-overrides') {
        const overrides = await loadRuntimeOverrides(config)
        return json(res, 200, { overrides, schema: RUNTIME_OVERRIDE_SCHEMA })
      }

      if (method === 'POST' && url === '/api/runtime-overrides') {
        const body = await readBody(req)
        const data = JSON.parse(body)
        try {
          const saved = await saveRuntimeOverrides(config, data)
          return json(res, 200, saved)
        } catch (err) {
          if (err instanceof RuntimeOverrideError) return json(res, 400, { error: err.message })
          throw err
        }
      }

      json(res, 404, { error: 'not found' })
    } catch (err) {
      json(res, 500, { error: err instanceof Error ? err.message : String(err) })
    }
  })
  return server
}

export async function startWebServer(config: AutopilotConfig): Promise<void> {
  const port = Number(process.env.PORT ?? DEFAULT_PORT)
  const server = createWebServer(config)
  server.listen(port, () => console.log(`World Problem Radar on :${port} [${config.environment}]`))
  await new Promise<void>((resolve) => server.on('close', resolve))
}
