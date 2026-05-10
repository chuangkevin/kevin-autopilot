import { timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { createIdea, listIdeas } from './ideas.js'
import { clearStoredGeminiKeys, getKeyStatus, importGeminiKeys } from './keys.js'
import { observe } from './observer.js'
import type { AutopilotConfig, IdeaRecord, KeyStatusSummary, ObservationReport } from './types.js'
import { APP_VERSION } from './version.js'

const DEFAULT_PORT = 3023
const MAX_REQUEST_BODY_BYTES = 64 * 1024
const NO_STORE_HEADERS = {
  'cache-control': 'no-store, max-age=0',
  pragma: 'no-cache',
  expires: '0',
}
const KEY_IMPORT_TOKEN_ENV = 'AUTOPILOT_KEY_IMPORT_TOKEN'

export async function startWebServer(config: AutopilotConfig): Promise<void> {
  const port = Number(process.env.PORT ?? DEFAULT_PORT)
  const server = createWebServer(config)

  await new Promise<void>((resolve) => {
    server.listen(port, '0.0.0.0', resolve)
  })

  console.log(`Kevin Autopilot ${APP_VERSION} web listening on http://localhost:${port}`)
}

export function createWebServer(config: AutopilotConfig): Server {
  return createServer(async (request, response) => {
    try {
      await handleRequest(config, request, response)
    } catch (error) {
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      response.end(error instanceof Error ? error.message : String(error))
    }
  })
}

async function handleRequest(config: AutopilotConfig, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)

  if (url.pathname === '/health') {
    writeJson(response, { ok: true, version: APP_VERSION, environment: config.environment })
    return
  }

  if (url.pathname === '/api/ideas' && request.method === 'GET') {
    writeJson(response, await listIdeas(config))
    return
  }

  if (url.pathname === '/api/ideas' && request.method === 'POST') {
    const body = JSON.parse(await readBody(request)) as { rawText?: unknown }
    const idea = await createIdea(config, typeof body.rawText === 'string' ? body.rawText : '')
    writeJson(response, idea, 201)
    return
  }

  if (url.pathname === '/api/keys/status' && request.method === 'GET') {
    writeJson(response, await getKeyStatus(config))
    return
  }

  if (url.pathname === '/api/keys/import' && request.method === 'POST') {
    if (!getKeyManagementAccess(request).allowed) {
      writeText(response, `Key management writes require loopback access or ${KEY_IMPORT_TOKEN_ENV}`, 403)
      return
    }
    const body = JSON.parse(await readBody(request)) as { rawText?: unknown; replace?: unknown }
    const summary = await importGeminiKeys(config, typeof body.rawText === 'string' ? body.rawText : '', body.replace === true)
    writeJson(response, summary, 201)
    return
  }

  if (url.pathname === '/api/keys' && request.method === 'DELETE') {
    if (!getKeyManagementAccess(request).allowed) {
      writeText(response, `Key management writes require loopback access or ${KEY_IMPORT_TOKEN_ENV}`, 403)
      return
    }
    writeJson(response, await clearStoredGeminiKeys(config))
    return
  }

  const report = await observe(config)

  if (url.pathname === '/api/report') {
    writeJson(response, report)
    return
  }

  if (url.pathname === '/') {
    const ideas = await listIdeas(config, 8)
    const keyStatus = await getKeyStatus(config)
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...NO_STORE_HEADERS })
    response.end(renderPage(report, ideas, Boolean(config.ai?.enabled), keyStatus, getKeyManagementAccess(request)))
    return
  }

  response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  response.end('Not found')
}

export function isLoopbackAddress(address: string): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

export function isKeyManagementAllowed(address: string, providedToken?: string, configuredToken = process.env[KEY_IMPORT_TOKEN_ENV]): boolean {
  if (isLoopbackAddress(address)) return true
  return hasValidKeyImportToken(providedToken, configuredToken)
}

function getKeyManagementAccess(request: IncomingMessage): { allowed: boolean; remoteAuthAvailable: boolean } {
  return getKeyManagementAccessForValues(request.socket.remoteAddress ?? '', getProvidedToken(request), process.env[KEY_IMPORT_TOKEN_ENV])
}

export function getKeyManagementAccessForValues(address: string, providedToken?: string, configuredToken = process.env[KEY_IMPORT_TOKEN_ENV]): { allowed: boolean; remoteAuthAvailable: boolean } {
  return {
    allowed: isKeyManagementAllowed(address, providedToken, configuredToken),
    remoteAuthAvailable: hasConfiguredKeyImportToken(configuredToken),
  }
}

function getProvidedToken(request: IncomingMessage): string | undefined {
  const headerToken = getSingleHeader(request.headers['x-autopilot-admin-token'])
  if (headerToken) return headerToken
  const authorization = getSingleHeader(request.headers.authorization)
  return authorization?.match(/^Bearer\s+(.+)$/i)?.[1]
}

function getSingleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function hasConfiguredKeyImportToken(configuredToken: string | undefined): configuredToken is string {
  return typeof configuredToken === 'string' && configuredToken.trim().length >= 12
}

function hasValidKeyImportToken(providedToken: string | undefined, configuredToken: string | undefined): boolean {
  if (!hasConfiguredKeyImportToken(configuredToken) || typeof providedToken !== 'string') return false
  const expectedToken = configuredToken.trim()
  const expected = Buffer.from(expectedToken)
  const actual = Buffer.from(providedToken.trim())
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function writeJson(response: ServerResponse, body: unknown, statusCode = 200): void {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8', ...NO_STORE_HEADERS })
  response.end(`${JSON.stringify(body, null, 2)}\n`)
}

function writeText(response: ServerResponse, body: string, statusCode = 200): void {
  response.writeHead(statusCode, { 'content-type': 'text/plain; charset=utf-8', ...NO_STORE_HEADERS })
  response.end(`${body}\n`)
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
    if (Buffer.concat(chunks).length > MAX_REQUEST_BODY_BYTES) {
      throw new Error('Request body too large')
    }
  }
  return Buffer.concat(chunks).toString('utf8')
}

function renderPage(
  report: ObservationReport,
  ideas: IdeaRecord[],
  aiEnabled: boolean,
  keyStatus: KeyStatusSummary,
  keyAccess: { allowed: boolean; remoteAuthAvailable: boolean },
): string {
  const dirtyRepos = report.repositories.filter((repo) => repo.dirty).length
  const missingRuleFiles = report.ruleSources.reduce((sum, source) => sum + source.missingFiles.length, 0)

  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Kevin Autopilot</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, "Microsoft JhengHei", system-ui, sans-serif; background: #0b1020; color: #e5eefc; }
    body { margin: 0; padding: 32px; }
    main { max-width: 1120px; margin: 0 auto; }
    header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; margin-bottom: 28px; }
    h1 { margin: 0; font-size: 36px; letter-spacing: -0.04em; }
    .version { color: #93a4bd; font-size: 14px; }
    .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-bottom: 24px; }
    .card, section { background: linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.04)); border: 1px solid rgba(148,163,184,0.22); border-radius: 18px; padding: 18px; box-shadow: 0 18px 48px rgba(0,0,0,0.28); }
    .label { color: #93a4bd; font-size: 13px; }
    .value { font-size: 30px; font-weight: 700; margin-top: 6px; }
    section { margin-bottom: 18px; }
    h2 { margin: 0 0 12px; font-size: 18px; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid rgba(148,163,184,0.16); }
    th { color: #93a4bd; font-weight: 600; }
    .pill { display: inline-block; border-radius: 999px; padding: 4px 9px; font-size: 12px; background: rgba(59,130,246,0.18); color: #bfdbfe; }
    .warn { background: rgba(245,158,11,0.16); color: #fde68a; }
    .ok { background: rgba(34,197,94,0.14); color: #bbf7d0; }
    .muted { color: #93a4bd; }
    textarea { width: 100%; min-height: 118px; box-sizing: border-box; resize: vertical; border-radius: 14px; border: 1px solid rgba(148,163,184,0.28); background: rgba(15,23,42,0.86); color: #e5eefc; padding: 14px; font: inherit; font-size: 16px; line-height: 1.5; }
    label { display: inline-flex; gap: 8px; align-items: center; color: #cbd5e1; margin-top: 10px; font-size: 14px; }
    input[type="checkbox"] { width: 16px; height: 16px; }
    button { margin-top: 10px; border: 0; border-radius: 999px; background: #60a5fa; color: #06111f; font-weight: 700; padding: 10px 16px; cursor: pointer; }
    button.secondary { background: rgba(148,163,184,0.2); color: #e5eefc; margin-left: 8px; }
    .idea { border-top: 1px solid rgba(148,163,184,0.16); padding: 12px 0; }
    .idea:first-child { border-top: 0; }
    .idea-title { font-weight: 700; }
    .idea-meta { color: #93a4bd; font-size: 13px; margin-top: 4px; }
    @media (max-width: 820px) { body { padding: 18px; } header { display: block; } .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } table { font-size: 13px; } }
  </style>
</head>
<body>
<main>
  <header>
    <div>
      <h1>Kevin Autopilot</h1>
      <div class="version">v${escapeHtml(report.version)} · ${escapeHtml(report.environment)} · ${escapeHtml(report.generatedAt)}</div>
    </div>
    <div class="pill ok">Read-only observer</div>
  </header>

  <div class="grid">
    <div class="card"><div class="label">服務</div><div class="value">${report.services.length}</div></div>
    <div class="card"><div class="label">Repos</div><div class="value">${report.repositories.length}</div></div>
    <div class="card"><div class="label">Dirty repos</div><div class="value">${dirtyRepos}</div></div>
    <div class="card"><div class="label">缺少規則檔</div><div class="value">${missingRuleFiles}</div></div>
  </div>

  ${renderKeySection(keyStatus, keyAccess)}

  <section>
    <h2>想法接手</h2>
    <p class="muted">AI thinking: ${aiEnabled ? 'enabled via ai-core' : 'disabled / fallback'}。送出後只會收件、分類、列出下一步，不會開 repo、不會部署。</p>
    <form id="idea-form">
      <textarea id="idea-text" placeholder="把腦中的想法直接貼在這裡，例如：我想做一個每天自動幫我整理新專案想法、判斷要不要開 repo、部署在哪裡的工具..."></textarea>
      <button type="submit">交給 Autopilot 思考</button>
    </form>
    <div id="idea-result" class="muted"></div>
  </section>

  <section>
    <h2>最近想法</h2>
    ${ideas.length === 0 ? '<p class="muted">尚未收到想法。</p>' : ideas.map(renderIdea).join('')}
  </section>

  <section>
    <h2>服務觀察</h2>
    <table><thead><tr><th>服務</th><th>Host</th><th>Domain</th><th>Port</th><th>Health</th></tr></thead><tbody>
      ${report.services.map((service) => `<tr><td>${escapeHtml(service.name)}</td><td>${escapeHtml(service.host ?? '-')}</td><td>${escapeHtml(service.domain ?? '-')}</td><td>${escapeHtml(String(service.port ?? '-'))}</td><td><span class="pill">${escapeHtml(service.healthStatus)}</span></td></tr>`).join('')}
    </tbody></table>
  </section>

  <section>
    <h2>Repository</h2>
    <table><thead><tr><th>Repo</th><th>Branch</th><th>Status</th><th>Recent commits</th></tr></thead><tbody>
      ${report.repositories.map((repo) => `<tr><td>${escapeHtml(repo.name)}</td><td>${escapeHtml(repo.branch ?? '-')}</td><td><span class="pill ${repo.dirty ? 'warn' : 'ok'}">${repo.dirty ? 'dirty' : 'clean'}</span></td><td>${repo.recentCommits.length}</td></tr>`).join('')}
    </tbody></table>
  </section>

  <section>
    <h2>安全邊界</h2>
    <p class="muted">不讀 secrets、不部署、不 commit、不 push、不修復服務。Health check 目前預設關閉。</p>
  </section>
</main>
<script>
  let autopilotAdminToken = '';
  const keyForm = document.getElementById('key-form');
  if (keyForm) keyForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const rawText = document.getElementById('key-text').value;
    const replace = document.getElementById('key-replace').checked;
    const adminToken = document.getElementById('key-admin-token')?.value ?? autopilotAdminToken;
    const result = document.getElementById('key-result');
    result.textContent = '匯入中...';
    if (adminToken) autopilotAdminToken = adminToken;
    const response = await fetch('/api/keys/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-autopilot-admin-token': adminToken },
      body: JSON.stringify({ rawText, replace })
    });
    if (!response.ok) {
      result.textContent = await response.text();
      return;
    }
    const summary = await response.json();
    result.textContent = '已匯入 ' + summary.imported + ' 把，忽略 ' + summary.ignored + ' 筆；目前本地 ' + summary.status.storedCount + ' 把。';
    document.getElementById('key-text').value = '';
    setTimeout(() => location.reload(), 700);
  });

  const keyClear = document.getElementById('key-clear');
  if (keyClear) keyClear.addEventListener('click', async () => {
    const result = document.getElementById('key-result');
    const adminToken = document.getElementById('key-admin-token')?.value ?? autopilotAdminToken;
    result.textContent = '清除中...';
    if (adminToken) autopilotAdminToken = adminToken;
    const response = await fetch('/api/keys', { method: 'DELETE', headers: { 'x-autopilot-admin-token': adminToken } });
    if (!response.ok) {
      result.textContent = await response.text();
      return;
    }
    const status = await response.json();
    result.textContent = '已清除本地 key；目前可用 ' + status.totalAvailable + ' 把。';
    setTimeout(() => location.reload(), 700);
  });

  document.getElementById('idea-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const rawText = document.getElementById('idea-text').value;
    const result = document.getElementById('idea-result');
    result.textContent = '思考中...';
    const response = await fetch('/api/ideas', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rawText })
    });
    if (!response.ok) {
      result.textContent = await response.text();
      return;
    }
    const idea = await response.json();
    result.textContent = '已收件：' + idea.title + ' / ' + idea.classification + ' / ' + idea.thinking.mode;
    setTimeout(() => location.reload(), 700);
  });
</script>
</body>
</html>`
}

function renderKeySection(keyStatus: KeyStatusSummary, keyAccess: { allowed: boolean; remoteAuthAvailable: boolean }): string {
  const statusText = `目前可用 ${keyStatus.totalAvailable} 把；本地儲存 ${keyStatus.storedCount} 把${keyStatus.storedSuffixes.length > 0 ? ` (${escapeHtml(keyStatus.storedSuffixes.join(', '))})` : ''}，環境變數 ${keyStatus.envCount} 把${keyStatus.envSuffixes.length > 0 ? ` (${escapeHtml(keyStatus.envSuffixes.join(', '))})` : ''}。只接受 Gemini API key，不會顯示完整 key。`
  if (!keyAccess.allowed && !keyAccess.remoteAuthAvailable) {
    return `<section>
    <h2>Gemini Key 狀態</h2>
    <p class="muted">${statusText}</p>
    <p class="muted">遠端 key 匯入尚未啟用。請先在部署環境設定 ${KEY_IMPORT_TOKEN_ENV}，domain 才會顯示受 token 保護的匯入欄位。</p>
  </section>`
  }

  const tokenInput = keyAccess.allowed ? '' : `<input id="key-admin-token" type="password" autocomplete="current-password" placeholder="Admin token" style="width:100%;box-sizing:border-box;border-radius:14px;border:1px solid rgba(148,163,184,0.28);background:rgba(15,23,42,0.86);color:#e5eefc;padding:12px;margin-bottom:10px;font:inherit;">`
  const helpText = keyAccess.allowed
    ? '目前來源可直接管理 key。'
    : `遠端匯入已啟用；請先輸入 ${KEY_IMPORT_TOKEN_ENV} token。token 只存在目前頁面的 JS 記憶體，不會寫入 Autopilot records。`

  return `<section>
    <h2>Gemini Key 匯入</h2>
    <p class="muted">${statusText}</p>
    <p class="muted">${escapeHtml(helpText)}</p>
    <form id="key-form">
      ${tokenInput}
      <textarea id="key-text" autocomplete="off" spellcheck="false" placeholder="貼上 Gemini API keys，可用逗號或換行，也可貼 GEMINI_API_KEY=... 或 export GEMINI_API_KEY=..."></textarea>
      <label><input id="key-replace" type="checkbox">取代既有本地 key</label><br>
      <button type="submit">匯入 Key</button><button id="key-clear" class="secondary" type="button">清除本地 Key</button>
    </form>
    <div id="key-result" class="muted"></div>
  </section>`
}

function renderIdea(idea: IdeaRecord): string {
  const handoff = idea.agentHandoff
  const projectHandoff = idea.projectHandoff
  return `<div class="idea">
    <div class="idea-title">${escapeHtml(idea.title)}</div>
    <div class="idea-meta">${escapeHtml(idea.createdAt)} · ${escapeHtml(idea.classification)} · ${escapeHtml(idea.thinking.mode)}${idea.approvalRequired ? ' · requires approval' : ''}</div>
    <div class="muted">${escapeHtml(idea.reasons[0] ?? '無分類原因')}</div>
    ${handoff ? `<div class="idea-meta">Superpowers: ${escapeHtml(handoff.superpowers.join(', '))} · ${escapeHtml(handoff.decision)}</div>` : ''}
    ${projectHandoff ? `<div class="idea-meta">Handoff: ${escapeHtml(projectHandoff.repoName)} · ${escapeHtml(projectHandoff.firstArtifact)} · gates ${projectHandoff.approvalGates.length}</div>` : ''}
  </div>`
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
}
