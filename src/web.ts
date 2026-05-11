import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { createIdea, listIdeas } from './ideas.js'
import { clearStoredGeminiKeys, getKeyStatus, importGeminiKeys } from './keys.js'
import { observe } from './observer.js'
import { createSupplement, listSupplements } from './supplements.js'
import type { AutopilotConfig, IdeaRecord, KeyStatusSummary, ObservationReport, UserSupplement } from './types.js'
import { APP_VERSION } from './version.js'

const DEFAULT_PORT = 3023
const MAX_REQUEST_BODY_BYTES = 64 * 1024
const NO_STORE_HEADERS = {
  'cache-control': 'no-store, max-age=0',
  pragma: 'no-cache',
  expires: '0',
}
const DISPLAY_TIME_ZONE = 'Asia/Taipei'

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

  if (url.pathname === '/api/main-agent/supplements' && request.method === 'GET') {
    writeJson(response, await listSupplements(config))
    return
  }

  if (url.pathname === '/api/main-agent/supplements' && request.method === 'POST') {
    if (!isTrustedSettingsRequest(request)) {
      writeText(response, 'Main-agent supplements require loopback, private LAN, Docker, or Tailscale access', 403)
      return
    }
    const body = JSON.parse(await readBody(request)) as { rawText?: unknown }
    let supplement: UserSupplement
    try {
      supplement = await createSupplement(config, typeof body.rawText === 'string' ? body.rawText : '')
    } catch (error) {
      writeText(response, error instanceof Error ? error.message : String(error), 400)
      return
    }
    writeJson(response, supplement, 201)
    return
  }

  if (url.pathname === '/api/keys/status' && request.method === 'GET') {
    writeJson(response, await getKeyStatus(config))
    return
  }

  if (url.pathname === '/api/keys/import' && request.method === 'POST') {
    if (!isTrustedSettingsRequest(request)) {
      writeText(response, 'Settings writes require loopback, private LAN, Docker, or Tailscale access', 403)
      return
    }
    const body = JSON.parse(await readBody(request)) as { rawText?: unknown; replace?: unknown }
    const summary = await importGeminiKeys(config, typeof body.rawText === 'string' ? body.rawText : '', body.replace === true)
    writeJson(response, summary, 201)
    return
  }

  if (url.pathname === '/api/keys' && request.method === 'DELETE') {
    if (!isTrustedSettingsRequest(request)) {
      writeText(response, 'Settings writes require loopback, private LAN, Docker, or Tailscale access', 403)
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
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...NO_STORE_HEADERS })
    response.end(renderPage(report, ideas, Boolean(config.ai?.enabled)))
    return
  }

  if (url.pathname === '/settings') {
    const keyStatus = await getKeyStatus(config)
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...NO_STORE_HEADERS })
    response.end(renderSettingsPage(report, keyStatus))
    return
  }

  response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  response.end('Not found')
}

function writeJson(response: ServerResponse, body: unknown, statusCode = 200): void {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8', ...NO_STORE_HEADERS })
  response.end(`${JSON.stringify(body, null, 2)}\n`)
}

function writeText(response: ServerResponse, body: string, statusCode = 200): void {
  response.writeHead(statusCode, { 'content-type': 'text/plain; charset=utf-8', ...NO_STORE_HEADERS })
  response.end(`${body}\n`)
}

export function isTrustedSettingsAddress(address: string): boolean {
  const normalized = address.replace(/^::ffff:/, '')
  if (normalized === '::1' || normalized === '127.0.0.1') return true
  const parts = normalized.split('.').map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const [a, b] = parts
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
}

export function isTrustedSettingsSource(remoteAddress: string, forwardedFor?: string | string[], realIp?: string | string[]): boolean {
  if (!isTrustedSettingsAddress(remoteAddress)) return false
  const forwardedAddresses = [...headerAddresses(forwardedFor), ...headerAddresses(realIp)]
  return forwardedAddresses.every(isTrustedSettingsAddress)
}

function isTrustedSettingsRequest(request: IncomingMessage): boolean {
  return isTrustedSettingsSource(
    request.socket.remoteAddress || '',
    request.headers['x-forwarded-for'],
    request.headers['x-real-ip'],
  )
}

function headerAddresses(value: string | string[] | undefined): string[] {
  if (!value) return []
  const values = Array.isArray(value) ? value : [value]
  return values.flatMap((entry) => entry.split(',')).map((entry) => entry.trim()).filter(Boolean)
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
): string {
  const dirtyRepos = report.repositories.filter((repo) => repo.dirty).length
  const missingRuleFiles = report.ruleSources.reduce((sum, source) => sum + source.missingFiles.length, 0)
  const bugCandidates = report.candidates.filter((candidate) => candidate.category === 'bug_watch' || candidate.category === 'bug_fix_candidate').length
  const topCandidate = report.mainAgent.recommendation.candidateId
    ? report.candidates.find((candidate) => candidate.id === report.mainAgent.recommendation.candidateId)
    : undefined

  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Kevin Autopilot</title>
  <style>
    :root { color-scheme: dark; font-family: "Noto Sans TC", "Microsoft JhengHei", system-ui, sans-serif; background: #080d19; color: #e5eefc; }
    * { box-sizing: border-box; }
    html, body { width: 100%; max-width: 100%; overflow-x: hidden; }
    body { margin: 0; padding: clamp(14px, 4vw, 32px); }
    main { width: 100%; max-width: 1120px; margin: 0 auto; min-width: 0; }
    header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; margin-bottom: 24px; min-width: 0; }
    h1 { margin: 0; font-size: clamp(30px, 8vw, 48px); line-height: 1.02; letter-spacing: -0.06em; overflow-wrap: anywhere; }
    .version { color: #93a4bd; font-size: 14px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(132px, 1fr)); gap: 12px; margin-bottom: 20px; }
    .card, section { min-width: 0; background: linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.035)); border: 1px solid rgba(148,163,184,0.22); border-radius: 18px; padding: clamp(14px, 4vw, 18px); box-shadow: 0 18px 48px rgba(0,0,0,0.24); }
    .command-center { border-color: rgba(245,158,11,0.38); background: radial-gradient(circle at top left, rgba(245,158,11,0.18), transparent 34%), linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.035)); }
    .command-grid { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(280px, 0.75fr); gap: 16px; align-items: start; }
    .eyebrow { color: #fbbf24; font-size: 13px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; }
    .main-action { margin: 6px 0 10px; font-size: clamp(26px, 6vw, 42px); line-height: 1.08; letter-spacing: -0.05em; }
    .status-strip { display: grid; grid-template-columns: repeat(auto-fit, minmax(118px, 1fr)); gap: 10px; margin: 16px 0; }
    .status-item { border: 1px solid rgba(148,163,184,0.16); border-radius: 14px; padding: 10px; background: rgba(8,13,25,0.42); }
    .status-item strong { display: block; font-size: 22px; margin-top: 4px; }
    .primary-card, .side-panel, .detail-block { border: 1px solid rgba(148,163,184,0.18); border-radius: 16px; padding: 14px; background: rgba(15,23,42,0.5); }
    .primary-card { border-left: 4px solid #f59e0b; }
    .side-panel { display: grid; gap: 12px; }
    .detail-block { margin-top: 10px; }
    .label { color: #93a4bd; font-size: 13px; }
    .value { font-size: 30px; font-weight: 700; margin-top: 6px; }
    section { margin-bottom: 18px; }
    h2 { margin: 0 0 12px; font-size: 18px; }
    .table-scroll { width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; }
    table { width: 100%; min-width: 680px; border-collapse: collapse; font-size: 14px; }
    th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid rgba(148,163,184,0.16); vertical-align: top; }
    th { color: #93a4bd; font-weight: 600; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; background: rgba(15,23,42,0.9); border: 1px solid rgba(148,163,184,0.18); border-radius: 12px; padding: 12px; font-size: 13px; line-height: 1.45; }
    summary { cursor: pointer; color: #bfdbfe; font-weight: 700; }
    .steps { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; }
    .step { border: 1px solid rgba(148,163,184,0.16); border-radius: 14px; padding: 12px; background: rgba(15,23,42,0.44); }
    .step strong { display: block; margin-bottom: 4px; }
    .agent-board { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(260px, 0.85fr); gap: 14px; }
    .agent-rounds, .agent-stack { display: grid; gap: 10px; align-content: start; }
    .agent-round, .option, .checkpoint, .supplement { border: 1px solid rgba(245,158,11,0.2); border-left: 3px solid rgba(245,158,11,0.82); border-radius: 14px; padding: 12px; background: rgba(15,23,42,0.48); }
    .agent-round strong, .option strong, .checkpoint strong, .supplement strong { display: block; margin-bottom: 4px; }
    .agent-round .role, .option .tradeoff { color: #cbd5e1; font-size: 13px; }
    .checkpoint { border-color: rgba(148,163,184,0.18); border-left-color: rgba(148,163,184,0.6); }
    .checkpoint.completed { opacity: 0.72; }
    .checkpoint.in_progress { border-left-color: #60a5fa; }
    .checkpoint.pending { border-left-color: #f59e0b; }
    .checkpoint.cancelled { opacity: 0.55; text-decoration: line-through; }
    .recommendation { border-radius: 16px; padding: 14px; background: rgba(120,53,15,0.28); border: 1px solid rgba(245,158,11,0.28); }
    .recommendation strong { display: block; margin-bottom: 6px; }
    .candidate-action { margin-top: 8px; color: #cbd5e1; font-size: 13px; }
    .copy-status { display: inline-block; margin-left: 8px; color: #bbf7d0; font-size: 13px; }
    .pill { display: inline-block; white-space: nowrap; border-radius: 999px; padding: 4px 9px; font-size: 12px; background: rgba(59,130,246,0.18); color: #bfdbfe; }
    .warn { background: rgba(245,158,11,0.16); color: #fde68a; }
    .ok { background: rgba(34,197,94,0.14); color: #bbf7d0; }
    .muted { color: #93a4bd; overflow-wrap: anywhere; }
    textarea { width: 100%; min-height: 118px; box-sizing: border-box; resize: vertical; border-radius: 14px; border: 1px solid rgba(148,163,184,0.28); background: rgba(15,23,42,0.86); color: #e5eefc; padding: 14px; font: inherit; font-size: 16px; line-height: 1.5; }
    label { display: inline-flex; gap: 8px; align-items: center; color: #cbd5e1; margin-top: 10px; font-size: 14px; }
    input[type="checkbox"] { width: 16px; height: 16px; }
    a.button, button { display: inline-block; text-decoration: none; margin-top: 10px; border: 0; border-radius: 999px; background: #60a5fa; color: #06111f; font-weight: 700; padding: 10px 16px; cursor: pointer; }
    button.secondary { background: rgba(148,163,184,0.2); color: #e5eefc; margin-left: 8px; }
    .idea { border-top: 1px solid rgba(148,163,184,0.16); padding: 12px 0; }
    .idea:first-child { border-top: 0; }
    .idea-title { font-weight: 700; overflow-wrap: anywhere; }
    .idea-meta { color: #93a4bd; font-size: 13px; margin-top: 4px; overflow-wrap: anywhere; }
    @media (max-width: 820px) { header { display: block; } .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .command-grid, .agent-board { grid-template-columns: 1fr; } table { font-size: 13px; } }
    @media (max-width: 520px) { .grid { grid-template-columns: 1fr 1fr; } .value { font-size: 24px; } a.button, button { min-height: 44px; } }
  </style>
</head>
<body>
<main>
  <header>
    <div>
      <h1>Kevin Autopilot</h1>
      <div class="version">v${escapeHtml(report.version)} · ${escapeHtml(report.environment)} · ${escapeHtml(formatTaipeiTime(report.generatedAt))}</div>
      <a class="button" href="/settings">設定 Gemini Keys</a>
    </div>
    <div class="pill ok">Read-only observer</div>
  </header>

  <section class="command-center">
    <div class="command-grid">
      <div>
        <div class="eyebrow">現在先看這裡</div>
        <h2 class="main-action">${topCandidate ? `先處理：${escapeHtml(topCandidate.title)}` : '這輪先不要硬做'}</h2>
        <p>${escapeHtml(report.mainAgent.recommendation.reason)}</p>
        <p class="muted">下一步：${escapeHtml(report.mainAgent.recommendation.nextAction)}</p>
        <div class="status-strip">
          <div class="status-item"><span class="label">觀察候選</span><strong>${report.candidates.length}</strong></div>
          <div class="status-item"><span class="label">疑似 Bug</span><strong>${bugCandidates}</strong></div>
          <div class="status-item"><span class="label">Dirty repos</span><strong>${dirtyRepos}</strong></div>
          <div class="status-item"><span class="label">補充</span><strong>${report.supplements.length}</strong></div>
        </div>
        ${topCandidate ? renderPrimaryCandidate(topCandidate) : '<div class="primary-card"><strong>沒有明確候選項</strong><div class="muted">目前只保留觀察。你可以在右側補充真實卡點，讓下一輪排序更接近你的意圖。</div></div>'}
      </div>
      <aside class="side-panel">
        <div>
          <h2>如果判斷不對</h2>
          <p class="muted">直接補一句給下一輪。它只會寫進 Autopilot 自己的 data，不會改 target repo。</p>
        </div>
        <form id="supplement-form">
          <textarea id="supplement-text" placeholder="例如：這個 dirty repo 是我正在做的，不要當成問題。先優先看 dashboard UX，不要碰部署。"></textarea>
          <button type="submit">補充給下一輪推理</button>
        </form>
        <div id="supplement-result" class="muted"></div>
        ${report.supplements.length === 0 ? '<p class="muted">目前沒有補充。</p>' : `<div class="agent-stack">${report.supplements.slice(0, 3).map(renderSupplement).join('')}</div>`}
      </aside>
    </div>
  </section>

  <section>
    <h2>細節與證據</h2>
    <p class="muted">平常只看最上面的決策中心。需要追原因、複製其他 prompt、或檢查狀態時再展開這裡。</p>
    <details class="detail-block">
      <summary>Kevin 子人格自問自答</summary>
      <p class="muted">${escapeHtml(report.mainAgent.summary)}</p>
      <div class="agent-board">
        <div class="agent-rounds">
          ${report.mainAgent.rounds.map(renderMainAgentRound).join('')}
        </div>
        <div class="agent-stack">
          <div class="recommendation">
            <strong>主 agent 決策：${escapeHtml(report.mainAgent.recommendation.decision)}</strong>
            <div>${escapeHtml(report.mainAgent.recommendation.reason)}</div>
            <div class="muted">下一步：${escapeHtml(report.mainAgent.recommendation.nextAction)}</div>
          </div>
          <div>
            <h2>Active Task</h2>
            <p class="muted">${escapeHtml(report.mainAgent.activeTask.objective)}<br>目前步驟：${escapeHtml(report.mainAgent.activeTask.currentStep)}</p>
            ${report.mainAgent.activeTask.checkpoints.map(renderCheckpoint).join('')}
          </div>
          <div>
            <h2>可行方案</h2>
            ${report.mainAgent.feasibleOptions.map(renderFeasibleOption).join('')}
          </div>
        </div>
      </div>
    </details>

    <details class="detail-block">
      <summary>Observation Backlog：其他候選與 OpenCode prompts</summary>
      <p class="muted">需要操作時展開 prompt 複製給 OpenCode。這裡仍是 read-only handoff，不會自動改專案。</p>
      ${report.candidates.length === 0 ? '<p class="muted">目前沒有從 read-only signals 產生候選項。</p>' : `<div class="table-scroll"><table><thead><tr><th>類型</th><th>信心</th><th>來源</th><th>候選項與操作</th><th>下一步</th><th>Approval</th></tr></thead><tbody>
        ${report.candidates.map((candidate) => `<tr><td><span class="pill">${escapeHtml(candidate.category)}</span></td><td>${escapeHtml(candidate.confidence)}</td><td>${escapeHtml(candidate.sourceName)}</td><td>${escapeHtml(candidate.title)}<div class="muted">${escapeHtml(candidate.evidence[0] ?? '')}</div><div class="candidate-action">你可以：先複製 prompt 給 OpenCode 做 read-only 釐清。</div><details><summary>OpenCode prompt</summary><button type="button" class="secondary copy-prompt">複製 Prompt</button><span class="copy-status" aria-live="polite"></span><pre>${escapeHtml(candidate.boundedPrompt)}</pre></details></td><td>${escapeHtml(candidate.suggestedNextStep)}</td><td>${candidate.approvalRequired ? '<span class="pill warn">需要</span>' : '<span class="pill ok">不需要</span>'}</td></tr>`).join('')}
      </tbody></table></div>`}
    </details>

    <details class="detail-block">
      <summary>服務與 Repository 狀態</summary>
      <div class="table-scroll"><table><thead><tr><th>服務</th><th>Host</th><th>Domain</th><th>Port</th><th>Health</th></tr></thead><tbody>
        ${report.services.map((service) => `<tr><td>${escapeHtml(service.name)}</td><td>${escapeHtml(service.host ?? '-')}</td><td>${escapeHtml(service.domain ?? '-')}</td><td>${escapeHtml(String(service.port ?? '-'))}</td><td><span class="pill">${escapeHtml(service.healthStatus)}</span></td></tr>`).join('')}
      </tbody></table></div>
      <div class="table-scroll"><table><thead><tr><th>Repo</th><th>Branch</th><th>Status</th><th>Recent commits</th></tr></thead><tbody>
        ${report.repositories.map((repo) => `<tr><td>${escapeHtml(repo.name)}</td><td>${escapeHtml(repo.branch ?? '-')}</td><td><span class="pill ${repo.dirty ? 'warn' : 'ok'}">${repo.dirty ? 'dirty' : 'clean'}</span></td><td>${repo.recentCommits.length}</td></tr>`).join('')}
      </tbody></table></div>
    </details>

    <details class="detail-block">
      <summary>安全邊界</summary>
      <p class="muted">不讀 secrets、不部署、不 commit、不 push、不修復服務。補充內容會先擋常見 secret-like 字串，寫入也只允許 trusted/private 來源。</p>
    </details>
  </section>

  <section>
    <h2>新想法入口</h2>
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

</main>
<script>
  document.getElementById('supplement-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const rawText = document.getElementById('supplement-text').value;
    const result = document.getElementById('supplement-result');
    result.textContent = '儲存補充中...';
    const response = await fetch('/api/main-agent/supplements', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rawText })
    });
    if (!response.ok) {
      result.textContent = await response.text();
      return;
    }
    const supplement = await response.json();
    result.textContent = '已納入下一輪推理：' + supplement.summary;
    document.getElementById('supplement-text').value = '';
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

  document.querySelectorAll('.copy-prompt').forEach((button) => {
    button.addEventListener('click', async () => {
      const details = button.closest('details');
      const prompt = details ? details.querySelector('pre')?.textContent || '' : '';
      const status = details ? details.querySelector('.copy-status') : null;
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(prompt);
        } else {
          const textArea = document.createElement('textarea');
          textArea.value = prompt;
          textArea.style.position = 'fixed';
          textArea.style.left = '-9999px';
          document.body.appendChild(textArea);
          textArea.focus();
          textArea.select();
          document.execCommand('copy');
          textArea.remove();
        }
        if (status) status.textContent = '已複製';
      } catch {
        if (status) status.textContent = '複製失敗，請手動選取';
      }
    });
  });
</script>
</body>
</html>`
}

function renderSettingsPage(report: ObservationReport, keyStatus: KeyStatusSummary): string {
  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Kevin Autopilot Settings</title>
  <style>
    :root { color-scheme: dark; font-family: "Noto Sans TC", "Microsoft JhengHei", system-ui, sans-serif; background: #080d19; color: #e5eefc; }
    * { box-sizing: border-box; }
    html, body { width: 100%; max-width: 100%; overflow-x: hidden; }
    body { margin: 0; padding: clamp(14px, 4vw, 32px); }
    main { width: 100%; max-width: 860px; margin: 0 auto; min-width: 0; }
    section { min-width: 0; background: linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.035)); border: 1px solid rgba(148,163,184,0.22); border-radius: 18px; padding: clamp(14px, 4vw, 18px); box-shadow: 0 18px 48px rgba(0,0,0,0.24); margin-bottom: 18px; }
    h1 { margin: 0 0 6px; font-size: clamp(30px, 8vw, 44px); line-height: 1.06; letter-spacing: -0.06em; overflow-wrap: anywhere; }
    h2 { margin: 0 0 12px; font-size: 18px; }
    .version, .muted { color: #93a4bd; }
    textarea { width: 100%; min-height: 160px; box-sizing: border-box; resize: vertical; border-radius: 14px; border: 1px solid rgba(148,163,184,0.28); background: rgba(15,23,42,0.86); color: #e5eefc; padding: 14px; font: inherit; font-size: 16px; line-height: 1.5; }
    label { display: inline-flex; gap: 8px; align-items: center; color: #cbd5e1; margin-top: 10px; font-size: 14px; }
    input[type="checkbox"] { width: 16px; height: 16px; }
    a.button, button { display: inline-block; text-decoration: none; margin-top: 10px; border: 0; border-radius: 999px; background: #60a5fa; color: #06111f; font-weight: 700; padding: 10px 16px; cursor: pointer; }
    button.secondary { background: rgba(148,163,184,0.2); color: #e5eefc; margin-left: 8px; }
    @media (max-width: 520px) { a.button, button { min-height: 44px; } button.secondary { margin-left: 0; display: block; } }
  </style>
</head>
<body>
<main>
  <header>
    <h1>Autopilot Settings</h1>
    <div class="version">v${escapeHtml(report.version)} · ${escapeHtml(report.environment)} · ${escapeHtml(formatTaipeiTime(report.generatedAt))} · DB-backed Gemini keys</div>
    <a class="button" href="/">回 Dashboard</a>
  </header>
  ${renderKeySection(keyStatus)}
</main>
<script>
  document.getElementById('key-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const rawText = document.getElementById('key-text').value;
    const replace = document.getElementById('key-replace').checked;
    const result = document.getElementById('key-result');
    result.textContent = '匯入 DB 中...';
    const response = await fetch('/api/keys/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rawText, replace })
    });
    if (!response.ok) {
      result.textContent = await response.text();
      return;
    }
    const summary = await response.json();
    result.textContent = '已匯入 ' + summary.imported + ' 把，忽略 ' + summary.ignored + ' 筆；DB 目前 ' + summary.status.storedCount + ' 把。';
    document.getElementById('key-text').value = '';
    setTimeout(() => location.reload(), 700);
  });

  document.getElementById('key-clear').addEventListener('click', async () => {
    const result = document.getElementById('key-result');
    result.textContent = '清除 DB keys 中...';
    const response = await fetch('/api/keys', { method: 'DELETE' });
    if (!response.ok) {
      result.textContent = await response.text();
      return;
    }
    const status = await response.json();
    result.textContent = '已清除 DB keys；目前可用 ' + status.totalAvailable + ' 把。';
    setTimeout(() => location.reload(), 700);
  });
</script>
</body>
</html>`
}

function renderKeySection(keyStatus: KeyStatusSummary): string {
  const statusText = `目前可用 ${keyStatus.totalAvailable} 把；本地儲存 ${keyStatus.storedCount} 把${keyStatus.storedSuffixes.length > 0 ? ` (${escapeHtml(keyStatus.storedSuffixes.join(', '))})` : ''}，環境變數 ${keyStatus.envCount} 把${keyStatus.envSuffixes.length > 0 ? ` (${escapeHtml(keyStatus.envSuffixes.join(', '))})` : ''}。只接受 Gemini API key，不會顯示完整 key。`
  return `<section>
    <h2>Gemini Key 匯入</h2>
    <p class="muted">${statusText}</p>
    <p class="muted">這個設定頁會把 Gemini keys 存進 Autopilot 自己的 SQLite DB：<code>data/autopilot.db</code>。頁面和 API 只顯示 masked suffix。</p>
    <form id="key-form">
      <textarea id="key-text" autocomplete="off" spellcheck="false" placeholder="貼上 Gemini API keys，可用逗號或換行，也可貼 GEMINI_API_KEY=... 或 export GEMINI_API_KEY=..."></textarea>
      <label><input id="key-replace" type="checkbox">取代既有本地 key</label><br>
      <button type="submit">匯入 Key</button><button id="key-clear" class="secondary" type="button">清除本地 Key</button>
    </form>
    <div id="key-result" class="muted"></div>
  </section>`
}

function renderPrimaryCandidate(candidate: ObservationReport['candidates'][number]): string {
  return `<div class="primary-card">
    <strong>本輪建議候選：${escapeHtml(candidate.title)}</strong>
    <div class="muted">${escapeHtml(candidate.category)} · ${escapeHtml(candidate.confidence)} · ${escapeHtml(candidate.sourceName)}${candidate.approvalRequired ? ' · 需要 approval' : ''}</div>
    <div>${escapeHtml(candidate.suggestedNextStep)}</div>
    <details open><summary>OpenCode prompt</summary><button type="button" class="secondary copy-prompt">複製 Prompt</button><span class="copy-status" aria-live="polite"></span><pre>${escapeHtml(candidate.boundedPrompt)}</pre></details>
  </div>`
}

function renderMainAgentRound(round: ObservationReport['mainAgent']['rounds'][number]): string {
  return `<div class="agent-round">
    <strong>${escapeHtml(round.agent)}</strong>
    <div class="role">${escapeHtml(round.role)}</div>
    <div class="muted">觀察：${escapeHtml(round.observation)}</div>
    <div>${escapeHtml(round.argument)}</div>
    <div class="muted">輸出：${escapeHtml(round.output)}</div>
  </div>`
}

function renderCheckpoint(checkpoint: ObservationReport['mainAgent']['activeTask']['checkpoints'][number]): string {
  return `<div class="checkpoint ${escapeHtml(checkpoint.status)}">
    <strong>${escapeHtml(checkpoint.content)}</strong>
    <div class="muted">${escapeHtml(checkpoint.status)} · ${escapeHtml(checkpoint.priority)}</div>
  </div>`
}

function renderFeasibleOption(option: ObservationReport['mainAgent']['feasibleOptions'][number]): string {
  return `<div class="option">
    <strong>${escapeHtml(option.label)}${option.approvalRequired ? ' · 需要 approval' : ''}</strong>
    <div>${escapeHtml(option.why)}</div>
    <div class="muted">第一步：${escapeHtml(option.firstStep)}</div>
    <div class="tradeoff">取捨：${escapeHtml(option.tradeoff)}</div>
  </div>`
}

function renderSupplement(supplement: ObservationReport['supplements'][number]): string {
  return `<div class="supplement">
    <strong>${escapeHtml(formatTaipeiTime(supplement.createdAt))}</strong>
    <div>${escapeHtml(supplement.summary)}</div>
    <div class="muted">來源：${escapeHtml(supplement.source)} · 套用：${escapeHtml(supplement.appliesTo)}</div>
  </div>`
}

function renderIdea(idea: IdeaRecord): string {
  const handoff = idea.agentHandoff
  const projectHandoff = idea.projectHandoff
  return `<div class="idea">
    <div class="idea-title">${escapeHtml(idea.title)}</div>
    <div class="idea-meta">${escapeHtml(formatTaipeiTime(idea.createdAt))} · ${escapeHtml(idea.classification)} · ${escapeHtml(idea.thinking.mode)}${idea.approvalRequired ? ' · requires approval' : ''}</div>
    <div class="muted">${escapeHtml(idea.reasons[0] ?? '無分類原因')}</div>
    ${handoff ? `<div class="idea-meta">Superpowers: ${escapeHtml(handoff.superpowers.join(', '))} · ${escapeHtml(handoff.decision)}</div>` : ''}
    ${projectHandoff ? `<div class="idea-meta">Handoff: ${escapeHtml(projectHandoff.repoName)} · ${escapeHtml(projectHandoff.firstArtifact)} · gates ${projectHandoff.approvalGates.length}</div>` : ''}
  </div>`
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
}

export function formatTaipeiTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const formatted = new Intl.DateTimeFormat('zh-TW', {
    timeZone: DISPLAY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date).replace(/\s+/g, ' ')
  return `${formatted} GMT+8`
}
