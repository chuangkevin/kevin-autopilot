import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { createHash } from 'node:crypto'
import { getKeyStatus, importGeminiKeys, clearStoredGeminiKeys } from './keys.js'
import { loadRuntimeOverrides, saveRuntimeOverrides, RUNTIME_OVERRIDE_SCHEMA, RuntimeOverrideError, getEffectiveConfig } from './runtime-overrides.js'
import { openRadarDatabase, listProblemCards, upsertRawSignal, makeSignalId } from './problem-cards.js'
import { fetchExternalSignals } from './external-sources.js'
import { runRadarPipeline } from './radar.js'
import { APP_VERSION } from './version.js'
import type { AutopilotConfig, ProblemCard, ProblemSignal } from './types.js'

const DEFAULT_PORT = 3023
const MAX_BODY_BYTES = 32 * 1024
const NO_STORE = { 'cache-control': 'no-store, max-age=0', pragma: 'no-cache', expires: '0' }

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
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
  <button class="scan-btn" onclick="triggerScan(this)">Scan Now</button>
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

      if (method === 'GET' && url.startsWith('/api/keys')) {
        const status = await getKeyStatus(config)
        return json(res, 200, status)
      }

      if (method === 'POST' && url === '/api/keys/import') {
        const body = await readBody(req)
        const { keys } = JSON.parse(body) as { keys?: string }
        if (!keys) return json(res, 400, { error: 'missing keys' })
        const summary = await importGeminiKeys(config, keys)
        return json(res, 200, summary)
      }

      if (method === 'POST' && url === '/api/keys/clear') {
        const status = await clearStoredGeminiKeys(config)
        return json(res, 200, status)
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
