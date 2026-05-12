import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import {
  dismissBacklogItem,
  effectiveStatus,
  listBacklog,
  openBacklogDatabase,
  resolveBacklogItem,
  snoozeBacklogItem,
} from './backlog.js'
import { createIdea, getIdea, listIdeas } from './ideas.js'
import {
  extendIdeaGraphNode,
  findIdeaGraphNodeRelationships,
  getIdeaGraph,
  getIdeaGraphNodeDetail,
  markIdeaGraphNodeInteresting,
  stopExploringIdeaGraphNode,
} from './idea-graph.js'
import { clearStoredGeminiKeys, getKeyStatus, importGeminiKeys } from './keys.js'
import { createObservationLoop, type ObservationLoop } from './observation-loop.js'
import { observe } from './observer.js'
import { createSupplement, listSupplements } from './supplements.js'
import type {
  AutopilotConfig,
  BacklogItem,
  BacklogStatus,
  BacklogStatusFilter,
  IdeaGraph,
  IdeaGraphNode,
  IdeaRecord,
  KeyStatusSummary,
  ObservationLoopState,
  ObservationReport,
  UserSupplement,
} from './types.js'
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

interface BacklogPanelData {
  items: BacklogItem[]
  counts: Record<BacklogStatus | 'all', number>
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

  if (url.pathname === '/api/main-agent/thinking') {
    const report = await getVisibleReport(config, observationLoop)
    writeJson(response, {
      generatedAt: report.generatedAt,
      environment: report.environment,
      loop: observationLoop?.getState() ?? createManualLoopState(),
      mainAgent: report.mainAgent,
      projectRadar: report.projectRadar,
      candidates: report.candidates,
      note: 'This is an auditable reasoning trace, not private chain-of-thought.',
    })
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
    const report = await getVisibleReport(config, observationLoop)
    writeJson(response, report)
    return
  }

  if (url.pathname === '/api/graph' && request.method === 'GET') {
    const report = await getVisibleReport(config, observationLoop)
    const ideas = await listIdeas(config, 40)
    writeJson(response, await getIdeaGraph(config, report, ideas))
    return
  }

  const graphNodeMatch = url.pathname.match(/^\/api\/graph\/nodes\/([^/]+)$/)
  if (graphNodeMatch && request.method === 'GET') {
    const report = await getVisibleReport(config, observationLoop)
    const ideas = await listIdeas(config, 40)
    const detail = await getIdeaGraphNodeDetail(config, report, ideas, decodeURIComponent(graphNodeMatch[1] ?? ''))
    if (!detail) {
      writeText(response, 'Graph node not found', 404)
      return
    }
    writeJson(response, detail)
    return
  }

  const graphActionMatch = url.pathname.match(/^\/api\/graph\/nodes\/([^/]+)\/(extend|find-relationships|mark-interesting|stop-exploring)$/)
  if (graphActionMatch && request.method === 'POST') {
    if (!isTrustedSettingsRequest(request)) {
      writeText(response, 'Graph actions require loopback, private LAN, Docker, or Tailscale access', 403)
      return
    }
    const report = await getVisibleReport(config, observationLoop)
    const ideas = await listIdeas(config, 40)
    const id = decodeURIComponent(graphActionMatch[1] ?? '')
    const action = graphActionMatch[2]
    const detail = action === 'extend'
      ? await extendIdeaGraphNode(config, report, ideas, id)
      : action === 'find-relationships'
        ? await findIdeaGraphNodeRelationships(config, report, ideas, id)
        : action === 'mark-interesting'
          ? await markIdeaGraphNodeInteresting(config, report, ideas, id)
          : await stopExploringIdeaGraphNode(config, report, ideas, id)
    if (!detail) {
      writeText(response, 'Graph node not found', 404)
      return
    }
    writeJson(response, detail, 201)
    return
  }

  if (url.pathname === '/api/backlog' && request.method === 'GET') {
    const filter = parseBacklogFilter(url.searchParams.get('status'))
    writeJson(response, loadBacklogResponse(config, filter))
    return
  }

  const backlogActionMatch = url.pathname.match(/^\/api\/backlog\/([^/]+)\/(dismiss|snooze|resolve)$/)
  if (backlogActionMatch && request.method === 'POST') {
    if (!isTrustedSettingsRequest(request)) {
      writeText(response, 'Backlog actions require loopback, private LAN, Docker, or Tailscale access', 403)
      return
    }
    const id = decodeURIComponent(backlogActionMatch[1] ?? '')
    const action = backlogActionMatch[2] as 'dismiss' | 'snooze' | 'resolve'
    const db = openBacklogDatabase(config)
    const now = new Date()
    try {
      let item: BacklogItem | null = null
      if (action === 'dismiss') {
        item = dismissBacklogItem(db, id, now)
      } else if (action === 'resolve') {
        item = resolveBacklogItem(db, id, now)
      } else {
        let body: { days?: unknown }
        try {
          const rawBody = await readBody(request)
          body = rawBody.trim() ? JSON.parse(rawBody) as { days?: unknown } : {}
        } catch {
          writeText(response, 'snooze request body must be JSON with days 1, 7, or 30', 400)
          return
        }
        const days = typeof body.days === 'number' ? body.days : Number(body.days)
        if (!Number.isFinite(days) || ![1, 7, 30].includes(days)) {
          writeText(response, 'snooze days must be 1, 7, or 30', 400)
          return
        }
        item = snoozeBacklogItem(db, id, days, now)
      }
      if (!item) {
        writeText(response, 'Backlog item not found', 404)
        return
      }
      writeJson(response, item)
    } finally {
      db.close()
    }
    return
  }

  if (url.pathname === '/') {
    const report = await getVisibleReport(config, observationLoop)
    const ideas = await listIdeas(config, 12)
    const graph = await getIdeaGraph(config, report, ideas)
    const backlog = loadBacklogResponse(config, 'active')
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...NO_STORE_HEADERS })
    response.end(renderPage(report, ideas, Boolean(config.ai?.enabled), observationLoop?.getState() ?? createManualLoopState(), graph, backlog))
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

async function getVisibleReport(config: AutopilotConfig, observationLoop?: ObservationLoop): Promise<ObservationReport> {
  if (!observationLoop) return observe(config)
  return observationLoop.getLastReport() ?? (await observationLoop.runOnce()) ?? (await observe(config))
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

function parseBacklogFilter(raw: string | null): BacklogStatusFilter {
  const allowed: BacklogStatusFilter[] = ['active', 'snoozed', 'resolved', 'dismissed', 'all']
  if (raw && (allowed as string[]).includes(raw)) return raw as BacklogStatusFilter
  return 'active'
}

function loadBacklogResponse(config: AutopilotConfig, filter: BacklogStatusFilter): BacklogPanelData {
  const db = openBacklogDatabase(config)
  const now = new Date()
  try {
    const all = listBacklog(db, 'all', now)
    const counts: Record<BacklogStatus | 'all', number> = {
      active: 0,
      snoozed: 0,
      resolved: 0,
      dismissed: 0,
      all: all.length,
    }
    for (const item of all) counts[effectiveStatus(item, now)] += 1
    const items = filter === 'all' ? all : all.filter((item) => effectiveStatus(item, now) === filter)
    return { items, counts }
  } finally {
    db.close()
  }
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
  graph: IdeaGraph,
  backlog: BacklogPanelData,
): string {
  const dirtyRepos = report.repositories.filter((repo) => repo.dirty).length
  const bugCandidates = report.candidates.filter((candidate) => candidate.category === 'bug_watch' || candidate.category === 'bug_fix_candidate').length

  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Kevin Autopilot</title>
  <style>
    :root { color-scheme: dark; font-family: "Noto Sans TC", "Microsoft JhengHei", "PingFang TC", system-ui, sans-serif; background: #0b0907; color: #f5ead7; }
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
    .neural-cockpit { position: relative; overflow: hidden; border-color: rgba(251,191,36,0.42); background: radial-gradient(circle at 20% 10%, rgba(251,191,36,0.18), transparent 28%), radial-gradient(circle at 80% 18%, rgba(45,212,191,0.13), transparent 26%), linear-gradient(135deg, rgba(41,25,13,0.96), rgba(13,18,20,0.94)); }
    .neural-cockpit::before { content: ""; position: absolute; inset: 0; pointer-events: none; background-image: linear-gradient(rgba(245,234,215,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(245,234,215,0.035) 1px, transparent 1px); background-size: 34px 34px; mask-image: radial-gradient(circle at center, black, transparent 74%); }
    .neural-shell { position: relative; display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(290px, 0.75fr); gap: 16px; align-items: start; }
    .neural-stage { position: relative; height: clamp(520px, 62vh, 720px); border: 1px solid rgba(251,191,36,0.18); border-radius: 28px; overflow: hidden; background: radial-gradient(circle at center, rgba(251,191,36,0.12), rgba(8,13,25,0.2) 42%, rgba(8,13,25,0.68)); }
    .cockpit-panel { max-height: clamp(520px, 62vh, 720px); overflow-y: auto; overflow-x: hidden; touch-action: pan-y; }
    .neural-map { position: absolute; inset: 0; width: 100%; height: 100%; }
    .neural-edge { stroke: rgba(245,234,215,0.22); stroke-width: 1.4; }
    .neural-edge.strong { stroke: rgba(45,212,191,0.55); stroke-width: 2.2; }
    .brain-node { position: absolute; z-index: 1; transform: translate(-50%, -50%); display: grid; place-items: center; width: clamp(82px, 12vw, 126px); min-height: 72px; max-height: 132px; overflow: hidden; border: 1px solid rgba(245,234,215,0.24); border-radius: 26px; padding: 10px; background: rgba(11,9,7,0.74); color: #fef3c7; text-align: center; box-shadow: 0 0 34px rgba(251,191,36,0.14); backdrop-filter: blur(10px); cursor: pointer; transition: border-color 160ms ease, background 160ms ease, box-shadow 160ms ease; }
    .brain-node:hover, .brain-node.active { z-index: 5; border-color: rgba(251,191,36,0.85); background: rgba(42,28,13,0.94); box-shadow: 0 0 42px rgba(251,191,36,0.36); }
    .brain-node.double { width: clamp(138px, 20vw, 190px); min-height: 104px; max-height: 160px; border-radius: 999px; background: radial-gradient(circle, rgba(251,191,36,0.28), rgba(11,9,7,0.82)); }
    .brain-node.keyword { border-style: dashed; color: #fde68a; }
    .brain-node.project { color: #bbf7d0; }
    .brain-node.signal { color: #fecaca; }
    .brain-node.research, .brain-node.extension { color: #99f6e4; }
    .brain-node.task { color: #bfdbfe; }
    .node-type { display: block; font: 800 10px/1 ui-monospace, "Cascadia Code", monospace; letter-spacing: 0.12em; text-transform: uppercase; color: #a8a29e; margin-bottom: 5px; }
    .node-title { display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; font-weight: 900; line-height: 1.25; overflow-wrap: anywhere; }
    .cockpit-panel { border: 1px solid rgba(245,234,215,0.16); border-radius: 24px; padding: 16px; background: rgba(11,9,7,0.72); min-width: 0; width: 100%; max-width: 100%; }
    .cockpit-panel h2 { font-size: 24px; line-height: 1.18; margin-bottom: 8px; }
    .thought-line { font-size: clamp(18px, 3vw, 26px); line-height: 1.38; color: #fef3c7; }
    .node-drawer { display: grid; gap: 10px; margin-top: 12px; min-width: 0; width: 100%; max-width: 100%; overflow-x: hidden; touch-action: pan-y; }
    .node-drawer > * { min-width: 0; max-width: 100%; overflow-wrap: anywhere; }
    .node-actions { position: sticky; top: 0; z-index: 8; display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-start; padding: 0 0 10px; background: linear-gradient(180deg, rgba(11,9,7,0.96), rgba(11,9,7,0.78)); backdrop-filter: blur(10px); }
    .node-actions button, .node-actions .node-action-disabled { margin: 0; max-width: 100%; white-space: normal; text-align: left; }
    .node-actions button:disabled { opacity: 0.44; cursor: not-allowed; }
    .node-action-disabled { display: inline-flex; flex-direction: column; gap: 2px; border-radius: 999px; padding: 8px 13px; background: rgba(148,163,184,0.12); color: #94a3b8; font-weight: 700; }
    .node-action-disabled small { font-size: 11px; font-weight: 600; color: #64748b; }
    .capture-strip { position: relative; margin-top: 16px; border: 1px solid rgba(251,191,36,0.2); border-radius: 22px; padding: 14px; background: rgba(11,9,7,0.56); }
    .capture-strip textarea { min-height: 86px; background: rgba(0,0,0,0.2); }
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
    .thinking-trace { border-color: rgba(34,197,94,0.34); background: radial-gradient(circle at top left, rgba(34,197,94,0.13), transparent 34%), linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.035)); }
    .thinking-grid { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(250px, 0.9fr); gap: 14px; align-items: start; }
    .trace-step { border: 1px solid rgba(34,197,94,0.2); border-left: 4px solid rgba(34,197,94,0.78); border-radius: 14px; padding: 12px; background: rgba(15,23,42,0.5); margin-bottom: 10px; }
    .trace-step strong { display: block; margin-bottom: 5px; }
    .trace-note { border: 1px solid rgba(148,163,184,0.18); border-radius: 14px; padding: 12px; background: rgba(8,13,25,0.42); }
    .candidate-action { margin-top: 8px; color: #cbd5e1; font-size: 13px; }
    .workbench { border-color: rgba(96,165,250,0.32); background: radial-gradient(circle at top right, rgba(96,165,250,0.14), transparent 34%), linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.035)); }
    .workbench-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 12px; }
    .workbench-card { display: grid; gap: 10px; border: 1px solid rgba(148,163,184,0.18); border-top: 4px solid #64748b; border-radius: 18px; padding: 14px; background: rgba(15,23,42,0.52); min-width: 0; }
    .workbench-card.issue-critical { border-top-color: #f87171; }
    .workbench-card.issue-watch { border-top-color: #f59e0b; }
    .workbench-card.issue-normal { border-top-color: #60a5fa; }
    .workbench-head { display: flex; gap: 10px; align-items: flex-start; }
    .source-badge { flex: 0 0 auto; display: inline-grid; place-items: center; min-width: 34px; height: 34px; padding: 0 8px; border-radius: 12px; background: rgba(96,165,250,0.18); color: #dbeafe; font: 800 13px/1 ui-monospace, "Cascadia Code", monospace; }
    .workbench-title { font-weight: 800; line-height: 1.28; overflow-wrap: anywhere; }
    .workbench-meta { display: flex; flex-wrap: wrap; gap: 6px; min-width: 0; max-width: 100%; overflow: hidden; }
    .durable-backlog { border-color: rgba(45,212,191,0.34); background: radial-gradient(circle at top left, rgba(45,212,191,0.13), transparent 34%), linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.035)); }
    .backlog-toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 12px 0; }
    .backlog-filter { background: rgba(148,163,184,0.18); color: #e5eefc; margin: 0; }
    .backlog-filter.active { background: #2dd4bf; color: #042f2e; }
    .backlog-list { display: grid; gap: 12px; }
    .backlog-card { display: grid; gap: 12px; border: 1px solid rgba(45,212,191,0.22); border-left: 5px solid #2dd4bf; border-radius: 18px; padding: 14px; background: rgba(15,23,42,0.54); min-width: 0; }
    .backlog-card.medium { border-left-color: #fbbf24; }
    .backlog-card.strong { border-left-color: #f87171; }
    .backlog-title { font-weight: 900; font-size: 17px; line-height: 1.3; overflow-wrap: anywhere; }
    .backlog-evidence { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .evidence-box { border: 1px solid rgba(148,163,184,0.16); border-radius: 14px; padding: 10px; background: rgba(8,13,25,0.42); min-width: 0; }
    .evidence-box strong { display: block; margin-bottom: 6px; }
    .backlog-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .backlog-actions button { margin: 0; }
    .backlog-result { min-height: 20px; }
    .radar-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
    .radar-card { border: 1px solid rgba(148,163,184,0.18); border-left: 5px solid #64748b; border-radius: 16px; padding: 14px; background: rgba(15,23,42,0.5); min-width: 0; }
    .radar-card.needs_attention { border-left-color: #f87171; }
    .radar-card.watching { border-left-color: #f59e0b; }
    .radar-card.healthy { border-left-color: #22c55e; }
    .radar-card.unknown { border-left-color: #94a3b8; }
    .radar-title { display: flex; justify-content: space-between; gap: 8px; align-items: flex-start; margin-bottom: 8px; }
    .radar-title strong { overflow-wrap: anywhere; }
    .radar-signals { margin: 8px 0 0; padding-left: 18px; color: #cbd5e1; font-size: 13px; }
    .radar-signals li { margin: 3px 0; overflow-wrap: anywhere; }
    .copy-status { display: inline-block; margin-left: 8px; color: #bbf7d0; font-size: 13px; }
    .pill { display: inline-block; white-space: nowrap; border-radius: 999px; padding: 4px 9px; font-size: 12px; background: rgba(59,130,246,0.18); color: #bfdbfe; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
    .node-drawer .pill { white-space: normal; overflow-wrap: anywhere; text-overflow: clip; }
    .warn { background: rgba(245,158,11,0.16); color: #fde68a; }
    .ok { background: rgba(34,197,94,0.14); color: #bbf7d0; }
    .muted { color: #93a4bd; overflow-wrap: anywhere; }
    textarea { width: 100%; min-height: 118px; box-sizing: border-box; resize: vertical; border-radius: 14px; border: 1px solid rgba(148,163,184,0.28); background: rgba(15,23,42,0.86); color: #e5eefc; padding: 14px; font: inherit; font-size: 16px; line-height: 1.5; }
    label { display: inline-flex; gap: 8px; align-items: center; color: #cbd5e1; margin-top: 10px; font-size: 14px; }
    input[type="checkbox"] { width: 16px; height: 16px; }
    a.button, button { display: inline-block; text-decoration: none; margin-top: 10px; border: 0; border-radius: 999px; background: #60a5fa; color: #06111f; font-weight: 700; padding: 10px 16px; cursor: pointer; }
    button.secondary { background: rgba(148,163,184,0.2); color: #e5eefc; margin-left: 8px; }
    .idea-desktop { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
    a.idea { display: grid; grid-template-rows: auto 1fr auto; gap: 10px; min-height: 220px; text-decoration: none; color: inherit; border: 1px solid rgba(148,163,184,0.18); border-radius: 18px; padding: 14px; background: radial-gradient(circle at top right, rgba(245,158,11,0.12), transparent 36%), rgba(15,23,42,0.54); transition: border-color 150ms ease, transform 150ms ease, background 150ms ease; }
    a.idea:hover { border-color: rgba(245,158,11,0.62); transform: translateY(-1px); background: radial-gradient(circle at top right, rgba(245,158,11,0.18), transparent 38%), rgba(15,23,42,0.7); }
    .idea-icon { display: inline-grid; place-items: center; width: 42px; height: 42px; border-radius: 14px; background: rgba(245,158,11,0.16); color: #fde68a; font: 800 20px/1 ui-monospace, "Cascadia Code", monospace; }
    .idea-title { font-weight: 800; font-size: 17px; line-height: 1.35; overflow-wrap: anywhere; }
    .idea-meta { color: #93a4bd; font-size: 13px; margin-top: 4px; overflow-wrap: anywhere; }
    .idea-status { border-top: 1px solid rgba(148,163,184,0.16); padding-top: 10px; }
    @media (max-width: 820px) { header { display: block; } .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .command-grid, .focus-grid, .agent-board, .thinking-grid, .neural-shell, .backlog-evidence { grid-template-columns: minmax(0, 1fr); } .neural-stage { min-height: 430px; } table { font-size: 13px; } }
    @media (max-width: 520px) { .grid { grid-template-columns: 1fr 1fr; } .value { font-size: 24px; } a.button, button { min-height: 44px; } .cockpit-panel { max-height: 72vh; padding: 12px; } .node-actions { margin: -2px 0 2px; } }
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

  ${renderNeuralCockpit(graph, loopState)}

  ${renderDurableBacklogPanel(backlog)}

  <details class="detail-block">
    <summary>補充或修正分身這輪判斷</summary>
    <div class="focus-grid">
      <aside class="side-panel">
        <h2>修正這輪判斷</h2>
        <p class="muted">這裡不是提新產品目標，只是告訴 Autopilot 這次判斷哪裡不對。不要貼 key、token、.env。</p>
        <form id="supplement-form">
          <textarea id="supplement-text" placeholder="例：這個 dirty repo 是我正在做的，不要當成問題。這次先看 Neural Cockpit UX。"></textarea>
          <button type="submit">修正下一輪判斷</button>
        </form>
        <div id="supplement-result" class="muted"></div>
      </aside>
      <aside class="side-panel">
        <h2>目前訊號</h2>
        <div class="status-strip">
          <div class="status-item"><span class="label">圖節點</span><strong>${graph.nodes.length}</strong></div>
          <div class="status-item"><span class="label">候選</span><strong>${report.candidates.length}</strong></div>
          <div class="status-item"><span class="label">疑似 Bug</span><strong>${bugCandidates}</strong></div>
          <div class="status-item"><span class="label">Dirty</span><strong>${dirtyRepos}</strong></div>
        </div>
        ${report.supplements.length === 0 ? '<p class="debug-note">目前沒有補充。</p>' : `<div class="agent-stack">${report.supplements.slice(0, 2).map(renderSupplement).join('')}</div>`}
      </aside>
    </div>
  </details>

  <details class="detail-block">
    <summary>舊版觀察報表 / 雷達 / 思考 trace，先收起來</summary>
    <p class="muted">Neural Cockpit 是主畫面；這些是完整觀察證據，需要追細節時再打開。</p>
    ${renderObservationWorkbench(report)}
    ${renderThinkingTrace(report)}
    ${renderProjectRadar(report)}
  </details>

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
    <summary>想法桌面：每個想法都是可進入的卡片</summary>
    <p class="muted">每張卡片都顯示目前分身狀態、handoff 階段，以及是否像既有 HomeProject 專案。</p>
    ${ideas.length === 0 ? '<p class="muted">尚未收到想法。</p>' : `<div class="idea-desktop">${ideas.map(renderIdea).join('')}</div>`}
  </details>

</main>
<script>
  const supplementForm = document.getElementById('supplement-form');
  if (supplementForm) supplementForm.addEventListener('submit', async (event) => {
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

  const ideaForm = document.getElementById('idea-form');
  if (ideaForm) ideaForm.addEventListener('submit', async (event) => {
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

  const initialLoopData = JSON.parse(document.getElementById('loop-data')?.textContent || '{}');
  setInterval(async () => {
    const status = document.getElementById('graph-refresh-status');
    try {
      const response = await fetch('/api/observation-loop', { cache: 'no-store' });
      if (!response.ok) return;
      const loop = await response.json();
      if (status) {
        status.textContent = loop.running
          ? '分身正在背景觀察，完成後會自動刷新腦圖。'
          : '頁面每分鐘會檢查分身腦圖是否長出新節點；有新圖會自動刷新。';
      }
      if (loop.lastGraphAt && loop.lastGraphAt !== initialLoopData.lastGraphAt) {
        location.reload();
      }
    } catch {
      if (status) status.textContent = '暫時讀不到背景狀態；下一分鐘會再試。';
    }
  }, 60000);

  document.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const nodeButton = target.closest('.brain-node');
    if (nodeButton) {
      const nodeId = nodeButton.getAttribute('data-node-id');
      if (!nodeId) return;
      document.querySelectorAll('.brain-node').forEach((item) => item.classList.remove('active'));
      nodeButton.classList.add('active');
      const response = await fetch('/api/graph/nodes/' + encodeURIComponent(nodeId));
      if (!response.ok) return;
      renderNodeDrawer(await response.json());
      return;
    }

    const actionButton = target.closest('.node-action');
    if (actionButton) {
      const action = actionButton.getAttribute('data-action');
      const nodeId = actionButton.getAttribute('data-node-id');
      if (['extend', 'find-relationships', 'mark-interesting', 'stop-exploring'].includes(action) && nodeId) {
        actionButton.textContent = graphActionProgressText(action);
        const response = await fetch('/api/graph/nodes/' + encodeURIComponent(nodeId) + '/' + action, { method: 'POST' });
        if (!response.ok) {
          actionButton.textContent = await response.text();
          return;
        }
        renderNodeDrawer(await response.json());
        setTimeout(() => location.reload(), 900);
        return;
      }
      if (action === 'copy-opencode-prompt') {
        const prompt = document.getElementById('node-drawer')?.querySelector('pre')?.textContent || '';
        if (!prompt) {
          actionButton.textContent = '目前沒有 prompt';
          return;
        }
        await copyText(prompt);
        actionButton.textContent = 'Prompt 已複製';
      }
      return;
    }

    const copyButton = target.closest('.copy-prompt');
    if (copyButton) {
      const button = copyButton;
      const container = button.closest('.prompt-block') || button.closest('details');
      const prompt = container ? container.querySelector('pre')?.textContent || '' : '';
      const status = container ? container.querySelector('.copy-status') : null;
      try {
        await copyText(prompt);
        if (status) status.textContent = '已複製';
      } catch {
        if (status) status.textContent = '複製失敗，請手動選取';
      }
      return;
    }

    const backlogFilter = target.closest('.backlog-filter');
    if (backlogFilter) {
      const status = backlogFilter.getAttribute('data-status') || 'active';
      await loadBacklog(status);
      return;
    }

    const backlogAction = target.closest('.backlog-action');
    if (backlogAction) {
      const id = backlogAction.getAttribute('data-id');
      const action = backlogAction.getAttribute('data-action');
      if (!id || !action) return;
      const result = document.getElementById('backlog-result');
      if (result) result.textContent = '更新 durable backlog 中...';
      const body = action === 'snooze' ? JSON.stringify({ days: Number(backlogAction.getAttribute('data-days') || '7') }) : undefined;
      const response = await fetch('/api/backlog/' + encodeURIComponent(id) + '/' + action, {
        method: 'POST',
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body
      });
      if (!response.ok) {
        if (result) result.textContent = await response.text();
        return;
      }
      if (result) result.textContent = '已更新；這只改 Autopilot 自己的 backlog metadata。';
      await loadBacklog(currentBacklogStatus);
    }
  });

  let currentBacklogStatus = 'active';

  async function loadBacklog(status) {
    currentBacklogStatus = status;
    const result = document.getElementById('backlog-result');
    if (result) result.textContent = '讀取 durable backlog...';
    const response = await fetch('/api/backlog?status=' + encodeURIComponent(status), { cache: 'no-store' });
    if (!response.ok) {
      if (result) result.textContent = await response.text();
      return;
    }
    const payload = await response.json();
    renderBacklog(payload.items || [], payload.counts || {});
    updateBacklogCounts(payload.counts || {});
    document.querySelectorAll('.backlog-filter').forEach((button) => button.classList.toggle('active', button.getAttribute('data-status') === status));
    if (result) result.textContent = payload.items.length === 0 ? '這個狀態目前沒有 backlog item。' : '排序：最近再次看見的線索在前面。';
  }

  function renderBacklog(items) {
    const list = document.getElementById('backlog-list');
    if (!list) return;
    if (items.length === 0) {
      list.innerHTML = '<p class="muted">目前沒有符合這個狀態的 durable backlog。</p>';
      return;
    }
    list.innerHTML = items.map(renderBacklogItem).join('');
  }

  function updateBacklogCounts(counts) {
    document.querySelectorAll('[data-backlog-count]').forEach((node) => {
      const key = node.getAttribute('data-backlog-count');
      node.textContent = String(counts[key] ?? 0);
    });
  }

  function renderBacklogItem(item) {
    const effective = item.status === 'snoozed' && item.snoozedUntil && item.snoozedUntil <= new Date().toISOString() ? 'active' : item.status;
    return '<article class="backlog-card ' + htmlEscape(item.strength) + '">' +
      '<div><div class="backlog-title">' + htmlEscape(item.title) + '</div>' +
      '<div class="workbench-meta"><span class="pill">' + htmlEscape(item.kind) + '</span><span class="pill ' + (effective === 'active' ? 'ok' : 'warn') + '">' + htmlEscape(effective) + '</span><span class="pill">strength ' + htmlEscape(item.strength) + '</span><span class="pill">seen ' + htmlEscape(item.seenCount) + '</span><span class="pill">miss ' + htmlEscape(item.missCount) + '</span></div></div>' +
      '<div>' + htmlEscape(item.summary) + '</div>' +
      '<div class="muted">來源：' + htmlEscape(item.sourceType) + ' / ' + htmlEscape(item.sourceName) + ' · 第一次：' + htmlEscape(item.firstSeenAt) + ' · 最近：' + htmlEscape(item.lastSeenAt) + (item.snoozedUntil ? ' · snooze 到：' + htmlEscape(item.snoozedUntil) : '') + '</div>' +
      '<div class="backlog-evidence">' + renderEvidenceBox('這次看到的證據', item.evidence) + renderEvidenceBox('上次留下的證據', item.prevEvidence || []) + '</div>' +
      '<div class="backlog-actions"><button type="button" class="secondary backlog-action" data-action="snooze" data-days="1" data-id="' + htmlEscape(item.id) + '">Snooze 1 天</button><button type="button" class="secondary backlog-action" data-action="snooze" data-days="7" data-id="' + htmlEscape(item.id) + '">Snooze 7 天</button><button type="button" class="secondary backlog-action" data-action="snooze" data-days="30" data-id="' + htmlEscape(item.id) + '">Snooze 30 天</button><button type="button" class="secondary backlog-action" data-action="resolve" data-id="' + htmlEscape(item.id) + '">標成已處理</button><button type="button" class="secondary backlog-action" data-action="dismiss" data-id="' + htmlEscape(item.id) + '">不要再提醒</button></div>' +
      '</article>';
  }

  function renderEvidenceBox(title, evidence) {
    const rows = evidence.length === 0 ? '<p class="muted">沒有留下上一版證據。</p>' : '<ul class="radar-signals">' + evidence.slice(0, 5).map((entry) => '<li>' + htmlEscape(entry) + '</li>').join('') + '</ul>';
    return '<div class="evidence-box"><strong>' + htmlEscape(title) + '</strong>' + rows + '</div>';
  }

  function renderBrowserNodeAction(nodeId, action) {
    if (action.enabled) {
      return '<button type="button" class="secondary node-action" data-action="' + htmlEscape(action.id) + '" data-node-id="' + htmlEscape(nodeId) + '">' + htmlEscape(action.label) + '</button>';
    }
    return '<span class="node-action-disabled" title="' + htmlEscape(action.description) + '">' + htmlEscape(action.label) + '<small>' + htmlEscape(nodeActionDisabledReason(action.id)) + '</small></span>';
  }

  function nodeActionDisabledReason(actionId) {
    if (actionId === 'extend') return '任務節點已經是 handoff prompt';
    if (actionId === 'copy-opencode-prompt') return '這個節點沒有 prompt';
    if (actionId === 'find-relationships') return '任務節點不再展開關聯';
    if (actionId === 'mark-interesting') return '已保留給分身';
    if (actionId === 'stop-exploring') return '中心節點不可隱藏';
    return '這個動作目前不可用';
  }

  function graphActionProgressText(actionId) {
    if (actionId === 'extend') return '延伸中...';
    if (actionId === 'find-relationships') return '找關聯中...';
    if (actionId === 'mark-interesting') return '標記中...';
    if (actionId === 'stop-exploring') return '隱藏中...';
    return '處理中...';
  }

  function renderNodeDrawer(detail) {
    const drawer = document.getElementById('node-drawer');
    const thought = document.getElementById('node-understanding');
    if (!drawer || !detail || !detail.node) return;
    const node = detail.node;
    if (thought) thought.textContent = node.thinking.understanding;
    const keywordHtml = node.keywords.length === 0 ? '<span class="muted">尚未抽到關鍵字</span>' : node.keywords.map((keyword) => '<span class="pill">' + htmlEscape(keyword) + '</span>').join('');
    const connectedHtml = detail.connectedNodes.length === 0 ? '<p class="muted">目前沒有相連節點。</p>' : '<div class="workbench-meta">' + detail.connectedNodes.slice(0, 6).map((item) => '<span class="pill">' + htmlEscape(item.title) + '</span>').join('') + '</div>';
    const actionHtml = node.actions.map((action) => renderBrowserNodeAction(node.id, action)).join('');
    const promptHtml = node.prompt ? '<details><summary>OpenCode prompt</summary><button type="button" class="secondary copy-prompt">複製 Prompt</button><span class="copy-status" aria-live="polite"></span><pre>' + htmlEscape(node.prompt) + '</pre></details>' : '';
    const evidenceHtml = node.thinking.evidence.length === 0 ? '<p class="muted">目前沒有證據。</p>' : '<ul class="radar-signals">' + node.thinking.evidence.slice(0, 4).map((item) => '<li>' + htmlEscape(item) + '</li>').join('') + '</ul>';
    const missingHtml = node.thinking.missingEvidence.length === 0 ? '<p class="muted">目前沒有明確缺口。</p>' : '<ul class="radar-signals">' + node.thinking.missingEvidence.slice(0, 4).map((item) => '<li>' + htmlEscape(item) + '</li>').join('') + '</ul>';
    drawer.innerHTML = '<div class="node-actions">' + actionHtml + '</div><div class="recommendation"><strong>' + htmlEscape(node.title) + '</strong><div>' + htmlEscape(node.summary) + '</div><div class="muted">' + htmlEscape(node.type) + ' · ' + htmlEscape(node.confidence) + ' · ' + htmlEscape(node.source) + '</div></div><div class="trace-note"><strong>我怎麼理解它</strong><div>' + htmlEscape(node.thinking.understanding) + '</div><div class="muted">為什麼有關：' + htmlEscape(node.thinking.whyItMatters) + '</div><div class="muted">下一步：' + htmlEscape(node.thinking.nextExploration) + '</div></div><div><strong>關鍵字</strong><div class="workbench-meta">' + keywordHtml + '</div></div><div><strong>相連節點</strong>' + connectedHtml + '</div><div><strong>證據</strong>' + evidenceHtml + '</div><div><strong>缺的證據</strong>' + missingHtml + '</div>' + promptHtml;
  }

  function htmlEscape(value) {
    return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }

  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    document.execCommand('copy');
    textArea.remove();
  }
</script>
</body>
</html>`
}

function renderDurableBacklogPanel(backlog: BacklogPanelData): string {
  return `<section class="durable-backlog" id="durable-backlog">
    <div class="eyebrow">Durable Backlog</div>
    <h2 class="mission-title">過去反覆看過的問題</h2>
    <p class="muted">這裡不是重要性排名；它只把分身多輪觀察留下的線索累積起來，讓你看到「已經看過幾次、最近是否還出現、上一輪證據有沒有變」。動作只改 Autopilot 自己的 <code>data/autopilot.db</code> metadata，不會動 target repo、commit、push、部署。</p>
    <div class="status-strip">
      <div class="status-item"><span class="label">Active</span><strong data-backlog-count="active">${backlog.counts.active}</strong></div>
      <div class="status-item"><span class="label">Snoozed</span><strong data-backlog-count="snoozed">${backlog.counts.snoozed}</strong></div>
      <div class="status-item"><span class="label">Resolved</span><strong data-backlog-count="resolved">${backlog.counts.resolved}</strong></div>
      <div class="status-item"><span class="label">All</span><strong data-backlog-count="all">${backlog.counts.all}</strong></div>
    </div>
    <div class="backlog-toolbar" aria-label="Durable backlog filters">
      ${(['active', 'snoozed', 'resolved', 'dismissed', 'all'] as BacklogStatusFilter[]).map((status) => `<button type="button" class="backlog-filter${status === 'active' ? ' active' : ''}" data-status="${status}">${escapeHtml(backlogFilterLabel(status))} <span data-backlog-count="${status}">${backlog.counts[status]}</span></button>`).join('')}
    </div>
    <div id="backlog-result" class="muted backlog-result" aria-live="polite">排序：最近再次看見的線索在前面。</div>
    <div class="backlog-list" id="backlog-list">
      ${backlog.items.length === 0 ? '<p class="muted">目前沒有 active durable backlog；下一輪觀察會繼續累積。</p>' : backlog.items.map((item) => renderBacklogCard(item)).join('')}
    </div>
  </section>`
}

function renderBacklogCard(item: BacklogItem): string {
  const status = effectiveStatus(item, new Date())
  return `<article class="backlog-card ${escapeHtml(item.strength)}">
    <div>
      <div class="backlog-title">${escapeHtml(item.title)}</div>
      <div class="workbench-meta">
        <span class="pill">${escapeHtml(item.kind)}</span>
        <span class="pill ${status === 'active' ? 'ok' : 'warn'}">${escapeHtml(backlogStatusLabel(status))}</span>
        <span class="pill">strength ${escapeHtml(item.strength)}</span>
        <span class="pill">seen ${item.seenCount}</span>
        <span class="pill">miss ${item.missCount}</span>
      </div>
    </div>
    <div>${escapeHtml(item.summary)}</div>
    <div class="muted">來源：${escapeHtml(item.sourceType)} / ${escapeHtml(item.sourceName)} · 第一次：${escapeHtml(formatTaipeiTime(item.firstSeenAt))} · 最近：${escapeHtml(formatTaipeiTime(item.lastSeenAt))}${item.snoozedUntil ? ` · snooze 到：${escapeHtml(formatTaipeiTime(item.snoozedUntil))}` : ''}</div>
    <div class="backlog-evidence">
      ${renderBacklogEvidence('這次看到的證據', item.evidence)}
      ${renderBacklogEvidence('上次留下的證據', item.prevEvidence ?? [])}
    </div>
    <div class="backlog-actions">
      <button type="button" class="secondary backlog-action" data-action="snooze" data-days="1" data-id="${escapeHtml(item.id)}">Snooze 1 天</button>
      <button type="button" class="secondary backlog-action" data-action="snooze" data-days="7" data-id="${escapeHtml(item.id)}">Snooze 7 天</button>
      <button type="button" class="secondary backlog-action" data-action="snooze" data-days="30" data-id="${escapeHtml(item.id)}">Snooze 30 天</button>
      <button type="button" class="secondary backlog-action" data-action="resolve" data-id="${escapeHtml(item.id)}">標成已處理</button>
      <button type="button" class="secondary backlog-action" data-action="dismiss" data-id="${escapeHtml(item.id)}">不要再提醒</button>
    </div>
  </article>`
}

function renderBacklogEvidence(title: string, evidence: string[]): string {
  return `<div class="evidence-box"><strong>${escapeHtml(title)}</strong>${evidence.length === 0 ? '<p class="muted">沒有留下上一版證據。</p>' : `<ul class="radar-signals">${evidence.slice(0, 5).map((entry) => `<li>${escapeHtml(entry)}</li>`).join('')}</ul>`}</div>`
}

function backlogFilterLabel(status: BacklogStatusFilter): string {
  if (status === 'active') return '正在看'
  if (status === 'snoozed') return '暫停'
  if (status === 'resolved') return '已處理'
  if (status === 'dismissed') return '不提醒'
  return '全部'
}

function backlogStatusLabel(status: BacklogStatus): string {
  if (status === 'active') return '正在看'
  if (status === 'snoozed') return '暫停'
  if (status === 'resolved') return '已處理'
  return '不提醒'
}

function renderNeuralCockpit(graph: IdeaGraph, loopState: ObservationLoopState): string {
  const layout = createGraphLayout(graph)
  const firstNode = graph.nodes.find((node) => node.id === graph.centerNodeId) ?? graph.nodes[0]
  return `<section class="neural-cockpit">
    <div class="eyebrow">Kevin Autopilot Neural Cockpit</div>
    <h2 class="main-action">打開分身的大腦</h2>
    <p class="plain-answer">我會把想法、關鍵字、專案異常、研究種子，還有像作夢一樣的半醒聯想接成一張圖。你可以不輸入，只看我今天長出什麼；也可以點一個節點讓我繼續延伸。</p>
    <div class="neural-shell">
      <div class="neural-stage" id="neural-stage" aria-label="Kevin Autopilot neural graph">
        <svg class="neural-map" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          ${graph.edges.map((edge) => {
            const from = layout.get(edge.from)
            const to = layout.get(edge.to)
            if (!from || !to) return ''
            return `<line class="neural-edge ${edge.confidence === 'strong' ? 'strong' : ''}" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"><title>${escapeHtml(edge.rationale)}</title></line>`
          }).join('')}
        </svg>
        ${graph.nodes.map((node) => {
          const point = layout.get(node.id) ?? { x: 50, y: 50 }
          return `<button type="button" class="brain-node ${escapeHtml(node.type)}${node.id === firstNode?.id ? ' active' : ''}" data-node-id="${escapeHtml(node.id)}" style="left:${point.x}%;top:${point.y}%">
            <span class="node-type">${escapeHtml(node.type)}</span>
            <span class="node-title">${escapeHtml(node.title)}</span>
          </button>`
        }).join('')}
      </div>
      <aside class="cockpit-panel">
        <div class="eyebrow">分身現在在想</div>
        <h2>${escapeHtml(firstNode?.title ?? 'Kevin Autopilot')}</h2>
        <p class="thought-line" id="node-understanding">${escapeHtml(firstNode?.thinking.understanding ?? graph.focus.headline)}</p>
        <div class="status-strip">
          <div class="status-item"><span class="label">背景</span><strong>${loopState.running ? '思考中' : loopState.enabled ? '醒著' : '手動'}</strong></div>
          <div class="status-item"><span class="label">節點</span><strong>${graph.nodes.length}</strong></div>
          <div class="status-item"><span class="label">關聯</span><strong>${graph.edges.length}</strong></div>
        </div>
        <p class="muted">${escapeHtml(renderLoopPlainStatus(loopState))}</p>
        <p class="muted" id="graph-refresh-status">頁面每分鐘會檢查分身腦圖是否長出新節點；有新圖會自動刷新。</p>
        <p class="muted">安全邊界：我可以做夢、聯想、觀察、整理、延伸、產生 prompt；但夢不是事實，我也不會自己改 repo、commit、push、部署或讀 secrets。</p>
        <div class="node-drawer" id="node-drawer">
          ${firstNode ? renderSelectedNode(firstNode, graph) : '<p class="muted">目前還沒有節點。</p>'}
        </div>
      </aside>
    </div>
    <div class="capture-strip">
      <div class="eyebrow">快速丟一段文字，不必整理格式</div>
      <form id="idea-form">
        <textarea id="idea-text" placeholder="把爆炸想法貼這裡。例：我想要 Autopilot 像另一個 Kevin 的大腦，可以自己找新東西、長出關聯圖、延伸成 OpenCode 任務..."></textarea>
        <button type="submit">丟給分身整理成節點</button>
      </form>
      <div id="idea-result" class="muted"></div>
    </div>
    <script id="graph-data" type="application/json">${jsonForScript(graph)}</script>
    <script id="loop-data" type="application/json">${jsonForScript({ lastGraphAt: loopState.lastGraphAt ?? '', lastReportAt: loopState.lastReportAt ?? '' })}</script>
  </section>`
}

function renderSelectedNode(node: IdeaGraphNode, graph: IdeaGraph): string {
  const connected = graph.edges
    .filter((edge) => edge.from === node.id || edge.to === node.id)
    .slice(0, 5)
    .map((edge) => graph.nodes.find((item) => item.id === (edge.from === node.id ? edge.to : edge.from)))
    .filter((item): item is IdeaGraphNode => Boolean(item))
  return `<div class="node-actions">
    ${node.actions.map((action) => renderNodeAction(node.id, action)).join('')}
  </div>
  <div class="recommendation">
    <strong>${escapeHtml(node.title)}</strong>
    <div>${escapeHtml(node.summary)}</div>
    <div class="muted">${escapeHtml(node.type)} · ${escapeHtml(node.confidence)} · ${escapeHtml(node.source)}</div>
  </div>
  <div class="trace-note">
    <strong>我怎麼理解它</strong>
    <div>${escapeHtml(node.thinking.understanding)}</div>
    <div class="muted">為什麼有關：${escapeHtml(node.thinking.whyItMatters)}</div>
    <div class="muted">下一步：${escapeHtml(node.thinking.nextExploration)}</div>
  </div>
  <div>
    <strong>關鍵字</strong>
    <div class="workbench-meta">${node.keywords.length === 0 ? '<span class="muted">尚未抽到關鍵字</span>' : node.keywords.map((keyword) => `<span class="pill">${escapeHtml(keyword)}</span>`).join('')}</div>
  </div>
  <div>
    <strong>相連節點</strong>
    ${connected.length === 0 ? '<p class="muted">目前沒有相連節點。</p>' : `<div class="workbench-meta">${connected.map((item) => `<span class="pill">${escapeHtml(item.title)}</span>`).join('')}</div>`}
  </div>
  <div>
    <strong>證據</strong>
    ${node.thinking.evidence.length === 0 ? '<p class="muted">目前沒有證據。</p>' : `<ul class="radar-signals">${node.thinking.evidence.slice(0, 4).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`}
  </div>
  <div>
    <strong>缺的證據</strong>
    ${node.thinking.missingEvidence.length === 0 ? '<p class="muted">目前沒有明確缺口。</p>' : `<ul class="radar-signals">${node.thinking.missingEvidence.slice(0, 4).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`}
  </div>
  ${node.prompt ? `<details><summary>OpenCode prompt</summary><button type="button" class="secondary copy-prompt">複製 Prompt</button><span class="copy-status" aria-live="polite"></span><pre>${escapeHtml(node.prompt)}</pre></details>` : ''}`
}

function renderNodeAction(nodeId: string, action: IdeaGraphNode['actions'][number]): string {
  if (action.enabled) {
    return `<button type="button" class="secondary node-action" data-action="${escapeHtml(action.id)}" data-node-id="${escapeHtml(nodeId)}">${escapeHtml(action.label)}</button>`
  }
  return `<span class="node-action-disabled" title="${escapeHtml(action.description)}">${escapeHtml(action.label)}<small>${escapeHtml(nodeActionDisabledReason(action.id))}</small></span>`
}

function nodeActionDisabledReason(actionId: IdeaGraphNode['actions'][number]['id']): string {
  if (actionId === 'extend') return '任務節點已經是 handoff prompt'
  if (actionId === 'copy-opencode-prompt') return '這個節點沒有 prompt'
  if (actionId === 'find-relationships') return '任務節點不再展開關聯'
  if (actionId === 'mark-interesting') return '已保留給分身'
  if (actionId === 'stop-exploring') return '中心節點不可隱藏'
  return '這個動作目前不可用'
}

function createGraphLayout(graph: IdeaGraph): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>()
  const centerIndex = Math.max(0, graph.nodes.findIndex((node) => node.id === graph.centerNodeId))
  const center = graph.nodes[centerIndex]
  if (center) positions.set(center.id, { x: 50, y: 50 })
  const others = graph.nodes.filter((node) => node.id !== center?.id)
  others.forEach((node, index) => {
    const ring = index < 12 ? 1 : 2
    const ringIndex = ring === 1 ? index : index - 12
    const ringCount = ring === 1 ? Math.min(12, others.length) : Math.max(1, others.length - 12)
    const angle = (Math.PI * 2 * ringIndex) / ringCount - Math.PI / 2
    const radiusX = ring === 1 ? 32 : 43
    const radiusY = ring === 1 ? 31 : 41
    positions.set(node.id, {
      x: Math.round((50 + Math.cos(angle) * radiusX) * 10) / 10,
      y: Math.round((50 + Math.sin(angle) * radiusY) * 10) / 10,
    })
  })
  return positions
}

function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('&', '\\u0026')
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

function renderObservationWorkbench(report: ObservationReport): string {
  const candidates = report.candidates
  const bugCount = candidates.filter((candidate) => candidate.category === 'bug_watch' || candidate.category === 'bug_fix_candidate').length
  const evidenceCount = candidates.filter(needsEvidenceFirst).length
  return `<section class="workbench">
    <div class="eyebrow">Observation Workbench</div>
    <h2 class="mission-title">一次看多件，每件都保留位置</h2>
    <p class="muted">這裡不是重要性排名；它是把過去問題、目前觀察、後續發想放在同一張桌面。弱訊號先補證據，較強訊號才展開 read-only handoff prompt。</p>
    <div class="status-strip">
      <div class="status-item"><span class="label">列出候選</span><strong>${candidates.length}</strong></div>
      <div class="status-item"><span class="label">疑似 Bug</span><strong>${bugCount}</strong></div>
      <div class="status-item"><span class="label">先補證據</span><strong>${evidenceCount}</strong></div>
      <div class="status-item"><span class="label">全部候選</span><strong>${report.candidates.length}</strong></div>
    </div>
    ${candidates.length === 0 ? '<p class="muted">目前沒有候選項；先看 Project Radar、補充想法，或建立 research 方向。</p>' : `<div class="workbench-grid">${candidates.map((candidate, index) => renderWorkbenchCandidate(candidate, index + 1)).join('')}</div>`}
  </section>`
}

function renderWorkbenchCandidate(candidate: ObservationReport['candidates'][number], index: number): string {
  const mode = needsEvidenceFirst(candidate) ? '先補證據' : 'Read-only handoff'
  const issueClass = candidate.risk === 'high' || candidate.category === 'bug_fix_candidate' ? 'issue-critical' : candidate.category === 'bug_watch' || candidate.approvalRequired ? 'issue-watch' : 'issue-normal'
  return `<article class="workbench-card ${issueClass}">
    <div class="workbench-head">
      <span class="source-badge">${escapeHtml(candidate.sourceType)} ${index}</span>
      <div>
        <div class="workbench-title">${escapeHtml(candidate.title)}</div>
        <div class="workbench-meta">
          <span class="pill">${escapeHtml(candidate.category)}</span>
          <span class="pill ${candidate.confidence === 'suspected' ? 'warn' : 'ok'}">${escapeHtml(candidate.confidence)}</span>
          <span class="pill ${candidate.risk === 'high' || candidate.risk === 'medium' ? 'warn' : 'ok'}">risk ${escapeHtml(candidate.risk)}</span>
          ${candidate.approvalRequired ? '<span class="pill warn">需要 approval</span>' : ''}
        </div>
      </div>
    </div>
    <div>${escapeHtml(candidate.suggestedNextStep)}</div>
    <div class="muted">來源：${escapeHtml(candidate.sourceType)} / ${escapeHtml(candidate.sourceName)}</div>
    <div class="candidate-action">建議模式：${mode}</div>
    <details><summary>證據與 prompt</summary><div class="muted">${candidate.evidence.map(escapeHtml).join('<br>')}</div><button type="button" class="secondary copy-prompt">複製 Prompt</button><span class="copy-status" aria-live="polite"></span><pre>${escapeHtml(candidate.boundedPrompt)}</pre></details>
  </article>`
}

function needsEvidenceFirst(candidate: ObservationReport['candidates'][number]): boolean {
  return candidate.confidence === 'suspected' || (candidate.category === 'improvement_candidate' && candidate.risk === 'low')
}

function renderProjectRadar(report: ObservationReport): string {
  const attentionCount = report.projectRadar.filter((project) => project.status === 'needs_attention').length
  const watchingCount = report.projectRadar.filter((project) => project.status === 'watching').length
  const unknownCount = report.projectRadar.filter((project) => project.status === 'unknown').length
  return `<section>
    <div class="eyebrow">Project Radar</div>
    <h2 class="mission-title">所有專案都在雷達上</h2>
    <p class="muted">這裡列出每個 configured repo 或 service；Autopilot 會看整個 HomeProject 表面，不替你判斷哪個想法比較重要。</p>
    <div class="status-strip">
      <div class="status-item"><span class="label">總數</span><strong>${report.projectRadar.length}</strong></div>
      <div class="status-item"><span class="label">需注意</span><strong>${attentionCount}</strong></div>
      <div class="status-item"><span class="label">觀察中</span><strong>${watchingCount}</strong></div>
      <div class="status-item"><span class="label">待補 mapping</span><strong>${unknownCount}</strong></div>
    </div>
    <div class="radar-grid">
      ${report.projectRadar.length === 0 ? '<p class="muted">目前沒有 configured project/service。</p>' : report.projectRadar.map(renderProjectRadarItem).join('')}
    </div>
  </section>`
}

function renderProjectRadarItem(project: ObservationReport['projectRadar'][number]): string {
  const serviceText = project.services.length === 0
    ? '沒有 service mapping'
    : project.services.map((service) => `${service.name}: ${service.healthStatus}`).join(' · ')
  return `<article class="radar-card ${escapeHtml(project.status)}">
    <div class="radar-title">
      <strong>${escapeHtml(project.name)}</strong>
      <span class="pill ${project.status === 'needs_attention' || project.status === 'watching' ? 'warn' : project.status === 'healthy' ? 'ok' : ''}">${escapeHtml(project.status)}</span>
    </div>
    <div class="muted">Repo：${escapeHtml(project.repository ? `${project.repository.exists ? project.repository.branch ?? 'unknown branch' : 'missing'}${project.repository.dirty ? ' · dirty' : ''}` : 'not configured')}</div>
    <div class="muted">Services：${escapeHtml(serviceText)}</div>
    <ul class="radar-signals">
      ${project.signals.slice(0, 4).map((signal) => `<li>${escapeHtml(signal)}</li>`).join('')}
    </ul>
    <div class="candidate-action">下一步：${escapeHtml(project.nextObservation)}</div>
  </article>`
}

function renderPrimaryCandidate(report: ObservationReport, candidate: ObservationReport['candidates'][number]): string {
  if (report.mainAgent.recommendation.decision === 'collect-more-evidence') {
    return `<div class="primary-card">
      <strong>唯一主要操作：先補證據</strong>
      <div>${escapeHtml(report.mainAgent.recommendation.nextAction)}</div>
      <div class="muted">目前還沒有達到 Kevin-quality handoff 門檻，所以不提供實作 prompt 當主操作。</div>
      ${report.mainAgent.qualityReview.gaps.slice(0, 2).map(renderQualityGap).join('')}
    </div>`
  }

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

function renderThinkingTrace(report: ObservationReport): string {
  const mainAgent = report.mainAgent
  const topCandidates = report.candidates.slice(0, 3)
  return `<section class="thinking-trace">
    <div class="eyebrow">分身思考過程</div>
    <h2 class="mission-title">我怎麼判斷下一步</h2>
    <p class="muted">這裡顯示可審核的推理紀錄：觀察、角色自問自答、候選方案、決策與證據。這不是模型私有 chain-of-thought。</p>
    <div class="thinking-grid">
      <div>
        <div class="trace-step">
          <strong>目前任務</strong>
          <div>${escapeHtml(mainAgent.activeTask.objective)}</div>
          <div class="muted">正在做：${escapeHtml(mainAgent.activeTask.currentStep)}</div>
        </div>
        ${mainAgent.rounds.map(renderTraceRound).join('')}
      </div>
      <aside class="trace-note">
        <h2>目前結論</h2>
        <div class="recommendation">
          <strong>${escapeHtml(mainAgent.recommendation.decision)}${mainAgent.recommendation.approvalRequired ? ' · 需要 approval' : ''}</strong>
          <div>${escapeHtml(mainAgent.recommendation.reason)}</div>
          <div class="muted">下一步：${escapeHtml(mainAgent.recommendation.nextAction)}</div>
        </div>
        <h2>像 Kevin 嗎？</h2>
        <div class="recommendation">
          <strong>${escapeHtml(renderQualityVerdict(mainAgent.qualityReview.verdict))} · ${mainAgent.qualityReview.score}/100</strong>
          <div>${escapeHtml(mainAgent.qualityReview.summary)}</div>
        </div>
        ${mainAgent.qualityReview.checks.map(renderQualityCheck).join('')}
        <h2>差在哪</h2>
        ${mainAgent.qualityReview.gaps.length === 0 ? '<p class="muted">目前沒有品質缺口。</p>' : mainAgent.qualityReview.gaps.map(renderQualityGap).join('')}
        <h2>可行方案</h2>
        ${mainAgent.feasibleOptions.slice(0, 3).map(renderFeasibleOption).join('')}
        <h2>證據摘要</h2>
        ${topCandidates.length === 0 ? '<p class="muted">目前沒有候選證據。</p>' : topCandidates.map((candidate) => `<div class="checkpoint"><strong>${escapeHtml(candidate.title)}</strong><div class="muted">${escapeHtml(candidate.sourceName)} · ${escapeHtml(candidate.confidence)} · ${escapeHtml(candidate.evidence[0] ?? '')}</div></div>`).join('')}
        <p class="muted">完整 JSON：<code>/api/main-agent/thinking</code></p>
      </aside>
    </div>
  </section>`
}

function renderTraceRound(round: ObservationReport['mainAgent']['rounds'][number]): string {
  return `<div class="trace-step">
    <strong>${escapeHtml(round.agent)} · ${escapeHtml(round.role)}</strong>
    <div class="muted">觀察：${escapeHtml(round.observation)}</div>
    <div>判斷：${escapeHtml(round.argument)}</div>
    <div class="muted">輸出：${escapeHtml(round.output)}</div>
  </div>`
}

function renderQualityCheck(check: ObservationReport['mainAgent']['qualityReview']['checks'][number]): string {
  return `<div class="checkpoint ${check.status === 'pass' ? 'completed' : check.status === 'warn' ? 'pending' : 'cancelled'}">
    <strong>${escapeHtml(check.label)} · ${escapeHtml(check.status)}</strong>
    <div class="muted">${escapeHtml(check.evidence)}</div>
  </div>`
}

function renderQualityGap(gap: ObservationReport['mainAgent']['qualityReview']['gaps'][number]): string {
  return `<div class="checkpoint ${gap.severity === 'high' ? 'cancelled' : gap.severity === 'medium' ? 'pending' : 'completed'}">
    <strong>${escapeHtml(gap.gap)} · ${escapeHtml(gap.severity)}</strong>
    <div>${escapeHtml(gap.neededEvidence)}</div>
    <div class="muted">升級條件：${escapeHtml(gap.upgradeCondition)}</div>
  </div>`
}

function renderQualityVerdict(verdict: ObservationReport['mainAgent']['qualityReview']['verdict']): string {
  if (verdict === 'qualified') return '合格'
  if (verdict === 'needs_more_context') return '需要補強'
  return '不合格'
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
