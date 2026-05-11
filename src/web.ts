import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { createIdea, getIdea, listIdeas } from './ideas.js'
import { clearStoredGeminiKeys, getKeyStatus, importGeminiKeys } from './keys.js'
import { createObservationLoop, type ObservationLoop } from './observation-loop.js'
import { observe } from './observer.js'
import { createSupplement, listSupplements } from './supplements.js'
import type { AutopilotConfig, IdeaRecord, KeyStatusSummary, ObservationLoopState, ObservationReport, UserSupplement } from './types.js'
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
  const observationLoop = createObservationLoop(config)
  observationLoop.start()
  const server = createWebServer(config, observationLoop)

  await new Promise<void>((resolve) => {
    server.listen(port, '0.0.0.0', resolve)
  })

  console.log(`Kevin Autopilot ${APP_VERSION} web listening on http://localhost:${port}`)
}

export function createWebServer(config: AutopilotConfig, observationLoop?: ObservationLoop): Server {
  return createServer(async (request, response) => {
    try {
      await handleRequest(config, request, response, observationLoop)
    } catch (error) {
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      response.end(error instanceof Error ? error.message : String(error))
    }
  })
}

async function handleRequest(config: AutopilotConfig, request: IncomingMessage, response: ServerResponse, observationLoop?: ObservationLoop): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)

  if (url.pathname === '/health') {
    writeJson(response, { ok: true, version: APP_VERSION, environment: config.environment })
    return
  }

  if (url.pathname === '/api/observation-loop') {
    writeJson(response, observationLoop?.getState() ?? createManualLoopState())
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

  if (url.pathname === '/api/report') {
    const report = observationLoop ? observationLoop.getLastReport() ?? (await observationLoop.runOnce()) ?? (await observe(config)) : await observe(config)
    writeJson(response, report)
    return
  }

  if (url.pathname === '/') {
    const report = observationLoop ? observationLoop.getLastReport() ?? (await observationLoop.runOnce()) ?? (await observe(config)) : await observe(config)
    const ideas = await listIdeas(config, 8)
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...NO_STORE_HEADERS })
    response.end(renderPage(report, ideas, Boolean(config.ai?.enabled), observationLoop?.getState() ?? createManualLoopState()))
    return
  }

  const ideaDetailMatch = url.pathname.match(/^\/ideas\/(idea-[a-zA-Z0-9_.-]+)$/)
  if (ideaDetailMatch) {
    const idea = await getIdea(config, ideaDetailMatch[1] ?? '')
    if (!idea) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', ...NO_STORE_HEADERS })
      response.end('Idea not found')
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...NO_STORE_HEADERS })
    response.end(renderIdeaDetailPage(idea))
    return
  }

  if (url.pathname === '/settings') {
    const keyStatus = await getKeyStatus(config)
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...NO_STORE_HEADERS })
    response.end(renderSettingsPage(config, keyStatus))
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

function createManualLoopState(): ObservationLoopState {
  return {
    mode: 'read-only-background-observation',
    enabled: false,
    intervalMs: 0,
    running: false,
    runCount: 0,
  }
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
  loopState: ObservationLoopState,
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
    .command-center { border-color: rgba(245,158,11,0.5); background: radial-gradient(circle at top left, rgba(245,158,11,0.2), transparent 34%), linear-gradient(180deg, rgba(255,255,255,0.09), rgba(255,255,255,0.035)); }
    .command-grid, .focus-grid { display: grid; grid-template-columns: minmax(0, 1.08fr) minmax(280px, 0.82fr); gap: 16px; align-items: start; }
    .mission { border: 1px solid rgba(96,165,250,0.28); border-left: 5px solid #60a5fa; border-radius: 16px; padding: 14px; background: rgba(30,64,175,0.16); margin-bottom: 16px; }
    .mission-title { margin: 0 0 6px; font-size: clamp(20px, 4vw, 28px); line-height: 1.15; }
    .mission p { margin: 6px 0 0; }
    .truth-box { border: 1px solid rgba(34,197,94,0.28); border-left: 5px solid #22c55e; border-radius: 16px; padding: 14px; background: rgba(20,83,45,0.18); margin-bottom: 16px; }
    .truth-box strong { display: block; margin-bottom: 6px; font-size: 18px; }
    .eyebrow { color: #fbbf24; font-size: 13px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; }
    .main-action { margin: 6px 0 10px; font-size: clamp(34px, 8vw, 64px); line-height: 1.02; letter-spacing: -0.07em; }
    .plain-answer { font-size: clamp(18px, 4vw, 24px); line-height: 1.45; color: #f8fafc; }
    .status-strip { display: grid; grid-template-columns: repeat(auto-fit, minmax(118px, 1fr)); gap: 10px; margin: 12px 0 0; }
    .status-item { border: 1px solid rgba(148,163,184,0.16); border-radius: 14px; padding: 10px; background: rgba(8,13,25,0.42); }
    .status-item strong { display: block; font-size: 20px; margin-top: 4px; }
    .primary-card, .side-panel, .detail-block { border: 1px solid rgba(148,163,184,0.18); border-radius: 16px; padding: 14px; background: rgba(15,23,42,0.5); }
    .primary-card { border-left: 5px solid #f59e0b; margin: 16px 0; }
    .side-panel { display: grid; gap: 12px; }
    .detail-block { margin: 14px 0; }
    .only-action { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-top: 12px; }
    .debug-note { color: #94a3b8; font-size: 13px; }
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
    .idea-desktop { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
    .idea { display: grid; grid-template-rows: auto 1fr auto; gap: 10px; min-height: 220px; text-decoration: none; color: inherit; border: 1px solid rgba(148,163,184,0.18); border-radius: 18px; padding: 14px; background: radial-gradient(circle at top right, rgba(245,158,11,0.12), transparent 36%), rgba(15,23,42,0.54); transition: border-color 150ms ease, transform 150ms ease, background 150ms ease; }
    .idea:hover { border-color: rgba(245,158,11,0.62); transform: translateY(-1px); background: radial-gradient(circle at top right, rgba(245,158,11,0.18), transparent 38%), rgba(15,23,42,0.7); }
    .idea-icon { display: inline-grid; place-items: center; width: 42px; height: 42px; border-radius: 14px; background: rgba(245,158,11,0.16); color: #fde68a; font: 800 20px/1 ui-monospace, "Cascadia Code", monospace; }
    .idea-title { font-weight: 800; font-size: 17px; line-height: 1.35; overflow-wrap: anywhere; }
    .idea-meta { color: #93a4bd; font-size: 13px; margin-top: 4px; overflow-wrap: anywhere; }
    .idea-status { border-top: 1px solid rgba(148,163,184,0.16); padding-top: 10px; }
    @media (max-width: 820px) { header { display: block; } .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .command-grid, .focus-grid, .agent-board { grid-template-columns: 1fr; } table { font-size: 13px; } }
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
    <div class="mission">
      <h2 class="mission-title">這頁的目標：幫你挑出下一件值得處理的事</h2>
      <p>它會看 read-only 訊號，挑一個候選，產生可貼到 OpenCode 的安全 prompt。</p>
      <p class="muted">它不是聊天頁、不是自動修復器，也不會自己改 repo、commit、push、部署。</p>
    </div>
    <div class="truth-box">
      <strong>背景分身已開始 read-only 觀察</strong>
      <div>${escapeHtml(renderLoopPlainStatus(loopState))}</div>
      <div class="muted">它只會自動觀察、產生報告與候選項；不會自己改 repo、commit、push、部署或執行 destructive action。</div>
      <div class="status-strip">
        <div class="status-item"><span class="label">背景狀態</span><strong>${loopState.running ? 'Running' : loopState.enabled ? 'Idle' : 'Off'}</strong></div>
        <div class="status-item"><span class="label">已跑次數</span><strong>${loopState.runCount}</strong></div>
        <div class="status-item"><span class="label">上次執行</span><strong>${escapeHtml(loopState.lastFinishedAt ? formatTaipeiTime(loopState.lastFinishedAt) : '-')}</strong></div>
        <div class="status-item"><span class="label">下次執行</span><strong>${escapeHtml(loopState.nextRunAt ? formatTaipeiTime(loopState.nextRunAt) : '-')}</strong></div>
      </div>
      ${loopState.lastError ? `<div class="muted">最近錯誤：${escapeHtml(loopState.lastError)}</div>` : ''}
    </div>
    <div class="eyebrow">今天只看這張</div>
    <h2 class="main-action">${topCandidate ? '現在重點：做這件' : '現在重點：先不要做'}</h2>
    <p class="plain-answer">${topCandidate ? escapeHtml(topCandidate.title) : '這輪沒有足夠明確的候選項。先維持觀察，或補充真正卡住的地方。'}</p>
    <p class="muted">為什麼：${escapeHtml(report.mainAgent.recommendation.reason)}</p>
    ${topCandidate ? renderPrimaryCandidate(topCandidate) : '<div class="primary-card"><strong>唯一動作</strong><div>如果這個判斷不對，在下方補一句修正下一輪推理。</div></div>'}
    <div class="focus-grid">
      <aside class="side-panel">
        <h2>修正這輪判斷</h2>
        <p class="muted">這裡不是提新產品目標，只是告訴 Autopilot 這次判斷哪裡不對。不要貼 key、token、.env。</p>
        <form id="supplement-form">
          <textarea id="supplement-text" placeholder="例：這個 dirty repo 是我正在做的，不要當成問題。這次先看 dashboard UX。"></textarea>
          <button type="submit">修正下一輪判斷</button>
        </form>
        <div id="supplement-result" class="muted"></div>
      </aside>
      <aside class="side-panel">
        <h2>目前訊號</h2>
        <div class="status-strip">
          <div class="status-item"><span class="label">候選</span><strong>${report.candidates.length}</strong></div>
          <div class="status-item"><span class="label">疑似 Bug</span><strong>${bugCandidates}</strong></div>
          <div class="status-item"><span class="label">Dirty</span><strong>${dirtyRepos}</strong></div>
          <div class="status-item"><span class="label">補充</span><strong>${report.supplements.length}</strong></div>
        </div>
        ${report.supplements.length === 0 ? '<p class="debug-note">目前沒有補充。</p>' : `<div class="agent-stack">${report.supplements.slice(0, 2).map(renderSupplement).join('')}</div>`}
      </aside>
    </div>
  </section>

  <details class="detail-block">
    <summary>除錯/證據/完整清單，不用先看</summary>
    <p class="muted">只有要追原因、複製其他 prompt、或檢查狀態時才展開。</p>
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
  </details>

  <details class="detail-block">
    <summary>提出新目標/新想法，不是修正這輪判斷</summary>
    <p class="muted">AI thinking: ${aiEnabled ? 'enabled via ai-core' : 'disabled / fallback'}。送出後只會收件、分類、列出下一步，不會開 repo、不會部署。</p>
    <form id="idea-form">
      <textarea id="idea-text" placeholder="把腦中的想法直接貼在這裡，例如：我想做一個每天自動幫我整理新專案想法、判斷要不要開 repo、部署在哪裡的工具..."></textarea>
      <button type="submit">交給 Autopilot 思考</button>
    </form>
    <div id="idea-result" class="muted"></div>
  </details>

  <details class="detail-block">
    <summary>想法桌面：每個想法都是可進入的卡片</summary>
    <p class="muted">每張卡片都顯示目前分身狀態、handoff 階段，以及是否像既有 HomeProject 專案。</p>
    ${ideas.length === 0 ? '<p class="muted">尚未收到想法。</p>' : `<div class="idea-desktop">${ideas.map(renderIdea).join('')}</div>`}
  </details>

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
      const container = button.closest('.prompt-block') || button.closest('details');
      const prompt = container ? container.querySelector('pre')?.textContent || '' : '';
      const status = container ? container.querySelector('.copy-status') : null;
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

function renderSettingsPage(config: AutopilotConfig, keyStatus: KeyStatusSummary): string {
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
    <div class="version">v${escapeHtml(APP_VERSION)} · ${escapeHtml(config.environment)} · ${escapeHtml(formatTaipeiTime(new Date().toISOString()))} · DB-backed Gemini keys</div>
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
    <strong>唯一主要操作</strong>
    <div>${escapeHtml(candidate.suggestedNextStep)}</div>
    <div class="muted">來源：${escapeHtml(candidate.sourceName)} · ${escapeHtml(candidate.category)} · ${escapeHtml(candidate.confidence)}${candidate.approvalRequired ? ' · 需要 approval' : ''}</div>
    <div class="prompt-block">
      <div class="only-action"><button type="button" class="copy-prompt">複製這個 Prompt</button><span class="copy-status" aria-live="polite"></span><span class="debug-note">複製後貼到 OpenCode。Autopilot 自己不會動 repo。</span></div>
      <details><summary>查看 prompt 內容</summary><pre>${escapeHtml(candidate.boundedPrompt)}</pre></details>
    </div>
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

function renderLoopPlainStatus(loopState: ObservationLoopState): string {
  if (!loopState.enabled) return '目前背景觀察已關閉；只有首頁或 /api/report 會手動觀察。'
  if (loopState.running) return '現在正在背景觀察。完成後會更新 last run / next run。'
  const nextRun = loopState.nextRunAt ? formatTaipeiTime(loopState.nextRunAt) : '排程中'
  const lastRun = loopState.lastFinishedAt ? formatTaipeiTime(loopState.lastFinishedAt) : '尚未完成第一次觀察'
  return `閒置時會每 ${Math.round(loopState.intervalMs / 60000)} 分鐘自動觀察一次。上次：${lastRun}；下次：${nextRun}。`
}

function renderIdea(idea: IdeaRecord): string {
  const handoff = idea.agentHandoff
  const projectHandoff = idea.projectHandoff
  const projectAnalysis = idea.existingProjectAnalysis
  return `<a class="idea" href="/ideas/${escapeHtml(idea.id)}">
    <div>
      <span class="idea-icon">${escapeHtml(ideaIcon(idea))}</span>
      <div class="idea-meta">${escapeHtml(formatTaipeiTime(idea.createdAt))}</div>
    </div>
    <div>
      <div class="idea-title">${escapeHtml(idea.title)}</div>
      <div class="idea-meta">分身狀態：${escapeHtml(ideaStatus(idea))}</div>
      <div class="muted">${escapeHtml(projectAnalysis.summary)}</div>
    </div>
    <div class="idea-status">
      <span class="pill">${escapeHtml(idea.classification)}</span>
      <span class="pill ${idea.approvalRequired ? 'warn' : 'ok'}">${idea.approvalRequired ? '需要 approval' : '可先探索'}</span>
      <div class="idea-meta">${escapeHtml(idea.thinking.mode)}${handoff ? ` · ${escapeHtml(handoff.decision)}` : ''}</div>
      ${projectHandoff ? `<div class="idea-meta">Handoff: ${escapeHtml(projectHandoff.repoName)} · ${escapeHtml(projectHandoff.firstArtifact)}</div>` : ''}
    </div>
  </a>`
}

function renderIdeaDetailPage(idea: IdeaRecord): string {
  const projectAnalysis = idea.existingProjectAnalysis
  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(idea.title)} · Kevin Autopilot</title>
  <style>
    :root { color-scheme: dark; font-family: "Noto Sans TC", "Microsoft JhengHei", system-ui, sans-serif; background: #080d19; color: #e5eefc; }
    * { box-sizing: border-box; }
    html, body { width: 100%; max-width: 100%; overflow-x: hidden; }
    body { margin: 0; padding: clamp(14px, 4vw, 32px); }
    main { width: 100%; max-width: 900px; margin: 0 auto; min-width: 0; }
    section { min-width: 0; background: linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.035)); border: 1px solid rgba(148,163,184,0.22); border-radius: 18px; padding: clamp(14px, 4vw, 18px); box-shadow: 0 18px 48px rgba(0,0,0,0.24); margin-bottom: 18px; }
    h1 { margin: 8px 0 10px; font-size: clamp(30px, 8vw, 52px); line-height: 1.04; letter-spacing: -0.06em; overflow-wrap: anywhere; }
    h2 { margin: 0 0 12px; font-size: 18px; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; background: rgba(15,23,42,0.9); border: 1px solid rgba(148,163,184,0.18); border-radius: 12px; padding: 12px; font-size: 13px; line-height: 1.45; }
    a.button { display: inline-block; text-decoration: none; margin-top: 10px; border: 0; border-radius: 999px; background: #60a5fa; color: #06111f; font-weight: 700; padding: 10px 16px; min-height: 44px; }
    .pill { display: inline-block; white-space: nowrap; border-radius: 999px; padding: 4px 9px; font-size: 12px; background: rgba(59,130,246,0.18); color: #bfdbfe; margin: 0 6px 6px 0; }
    .warn { background: rgba(245,158,11,0.16); color: #fde68a; }
    .ok { background: rgba(34,197,94,0.14); color: #bbf7d0; }
    .muted, .meta { color: #93a4bd; overflow-wrap: anywhere; }
    .status-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; }
    .status-box, .match { border: 1px solid rgba(148,163,184,0.16); border-radius: 14px; padding: 12px; background: rgba(15,23,42,0.5); }
    .status-box strong, .match strong { display: block; margin-bottom: 4px; }
  </style>
</head>
<body>
<main>
  <a class="button" href="/">回想法桌面</a>
  <section>
    <div class="meta">v${escapeHtml(APP_VERSION)} · ${escapeHtml(idea.environment)} · ${escapeHtml(formatTaipeiTime(idea.createdAt))}</div>
    <h1>${escapeHtml(idea.title)}</h1>
    <span class="pill">${escapeHtml(idea.classification)}</span>
    <span class="pill ${idea.approvalRequired ? 'warn' : 'ok'}">${idea.approvalRequired ? '需要 approval' : '可先探索'}</span>
    <p>分身目前在做什麼：${escapeHtml(ideaStatus(idea))}</p>
  </section>
  <section>
    <h2>既有專案相似度</h2>
    <p>${escapeHtml(projectAnalysis.summary)}</p>
    ${projectAnalysis.matches.length === 0 ? '<p class="muted">沒有找到可列出的相似 repo 或 service。</p>' : projectAnalysis.matches.map(renderProjectMatch).join('')}
  </section>
  <section>
    <h2>Handoff 狀態</h2>
    <div class="status-grid">
      <div class="status-box"><strong>Thinking</strong><span class="muted">${escapeHtml(idea.thinking.mode)} · ${idea.thinking.success ? 'success' : 'fallback'}</span></div>
      <div class="status-box"><strong>Agent</strong><span class="muted">${escapeHtml(idea.agentHandoff?.decision ?? '尚未建立 handoff')}</span></div>
      <div class="status-box"><strong>Project</strong><span class="muted">${escapeHtml(idea.projectHandoff?.firstArtifact ?? '尚未建立 project handoff')}</span></div>
    </div>
  </section>
  <section>
    <h2>原始想法</h2>
    <pre>${escapeHtml(idea.rawText)}</pre>
  </section>
  <section>
    <h2>建議下一步</h2>
    ${idea.suggestedNextSteps.map((step) => `<p>${escapeHtml(step)}</p>`).join('')}
  </section>
</main>
</body>
</html>`
}

function renderProjectMatch(match: IdeaRecord['existingProjectAnalysis']['matches'][number]): string {
  return `<div class="match">
    <strong>${escapeHtml(match.projectName)} · ${match.score}/100</strong>
    <div>${escapeHtml(match.reason)}</div>
    <div class="muted">來源：${escapeHtml(match.sourceType)} / ${escapeHtml(match.sourceName)}${match.domain ? ` · ${escapeHtml(match.domain)}` : ''}${match.path ? ` · ${escapeHtml(match.path)}` : ''}</div>
  </div>`
}

function ideaIcon(idea: IdeaRecord): string {
  if (idea.classification === 'blocked') return '!'
  if (idea.classification === 'prototype') return 'P'
  if (idea.classification === 'plan') return 'S'
  return '?'
}

function ideaStatus(idea: IdeaRecord): string {
  if (idea.classification === 'blocked') return '正在隔離風險並等待 approval gate'
  if (idea.projectHandoff) return `正在整理 ${idea.projectHandoff.firstArtifact}`
  if (idea.agentHandoff) return `正在做 ${idea.agentHandoff.decision}`
  return '正在收斂問題與缺少脈絡'
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
