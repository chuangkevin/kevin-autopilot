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
import {
  countPendingAiIdeas,
  createIdea,
  DismissError,
  dismissIdea,
  getIdea,
  listIdeas,
} from './ideas.js'
import {
  archiveIdeaGraphNode,
  ArchiveCenterNodeError,
  deleteIdeaGraphNode,
  DeleteCenterNodeError,
  extendIdeaGraphNode,
  findIdeaGraphNodeRelationships,
  getIdeaGraph,
  getIdeaGraphNodeDetail,
  listArchivedNodes,
  markIdeaGraphNodeInteresting,
  unarchiveIdeaGraphNode,
} from './idea-graph.js'
import { clearStoredGeminiKeys, getKeyStatus, importGeminiKeys } from './keys.js'
import { isBoostRunning, runBoost } from './boost.js'
import { isDeliberationRunning, loadLatestDeliberation, runDeliberation } from './deliberation.js'
import { recomputePreferences } from './preferences.js'
import { createObservationLoop, readReflectionState, type ObservationLoop } from './observation-loop.js'
import { isReflectionRewriteFresh } from './reflection.js'
import { observe } from './observer.js'
import {
  getEffectiveConfig,
  loadRuntimeOverrides,
  RUNTIME_OVERRIDE_SCHEMA,
  RuntimeOverrideError,
  saveRuntimeOverrides,
} from './runtime-overrides.js'
import { createSupplement, listSupplements } from './supplements.js'
import type {
  AutopilotConfig,
  BacklogItem,
  BacklogStatus,
  BacklogStatusFilter,
  DeliberationRecord,
  DeliberationState,
  IdeaGraph,
  IdeaGraphNode,
  IdeaRecord,
  KeyStatusSummary,
  ObservationLoopState,
  ObservationReport,
  RuntimeOverrides,
  UserSupplement,
} from './types.js'
import { APP_VERSION } from './version.js'
import { loadGraphPositions, saveGraphPositions, type GraphPositions } from './graph-positions.js'

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
    writeJson(response, observationLoop ? await observationLoop.getEffectiveState() : createManualLoopState())
    return
  }

  if (url.pathname === '/api/deliberation/latest') {
    const record = await loadLatestDeliberation(config)
    const deliberationState: DeliberationState = {
      status: isDeliberationRunning() ? 'running' : 'idle',
      record,
    }
    writeJson(response, deliberationState)
    return
  }

  if (url.pathname === '/api/deliberation' && request.method === 'POST') {
    if (!isTrustedSettingsRequest(request)) {
      writeText(response, '強制思考需要 loopback、私有 LAN、Docker 或 Tailscale 連線', 403)
      return
    }
    if (isDeliberationRunning()) {
      writeJson(response, { status: 'already_running' }, 409)
      return
    }
    let anchorNodeId: string | null = null
    try {
      const rawBody = await readBody(request)
      if (rawBody.trim()) {
        const body = JSON.parse(rawBody) as { anchorNodeId?: unknown }
        if (typeof body.anchorNodeId === 'string' && body.anchorNodeId.trim()) {
          anchorNodeId = body.anchorNodeId.trim()
        }
      }
    } catch {
      // malformed body is treated as no anchor
    }
    const report = await getVisibleReport(config, observationLoop)
    const ideas = await listIdeas(config, 40)
    const graph = await getIdeaGraph(config, report, ideas)
    if (anchorNodeId) {
      const anchor = graph.nodes.find((item) => item.id === anchorNodeId)
      if (!anchor) {
        writeJson(response, { error: 'unknown anchor node' }, 400)
        return
      }
      if (anchor.archived === true) {
        writeJson(response, { error: 'anchor is archived' }, 400)
        return
      }
    }
    const db = openBacklogDatabase(config)
    let backlog: BacklogItem[]
    try { backlog = listBacklog(db, 'all', new Date()) } finally { db.close() }
    void runDeliberation(config, report, graph, backlog, { anchorNodeId }).catch((error) => {
      console.error('deliberation failed:', error instanceof Error ? error.message : String(error))
    })
    writeJson(response, { status: 'started' }, 202)
    return
  }

  if (url.pathname === '/api/main-agent/thinking') {
    const report = await getVisibleReport(config, observationLoop)
    writeJson(response, {
      generatedAt: report.generatedAt,
      environment: report.environment,
      loop: observationLoop ? await observationLoop.getEffectiveState() : createManualLoopState(),
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

  if (url.pathname === '/api/runtime-overrides' && request.method === 'GET') {
    if (!isTrustedSettingsRequest(request)) {
      writeText(response, 'Runtime overrides require loopback, private LAN, Docker, or Tailscale access', 403)
      return
    }
    writeJson(response, await buildRuntimeOverrideResponse(config))
    return
  }

  if (url.pathname === '/api/runtime-overrides' && request.method === 'PUT') {
    if (!isTrustedSettingsRequest(request)) {
      writeText(response, 'Runtime overrides require loopback, private LAN, Docker, or Tailscale access', 403)
      return
    }
    try {
      const bodyText = await readBody(request)
      const body = bodyText.trim() ? JSON.parse(bodyText) as unknown : {}
      await saveRuntimeOverrides(config, body)
      writeJson(response, await buildRuntimeOverrideResponse(config))
    } catch (error) {
      if (error instanceof RuntimeOverrideError) {
        writeText(response, error.message, 400)
        return
      }
      writeText(response, error instanceof Error ? error.message : String(error), 400)
    }
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
    const reflection = await readReflectionState(config)
    if (isReflectionRewriteFresh(reflection)) {
      const rewrite = reflection.nextExplorationRewrites.find((entry) => entry.nodeId === detail.node.id)
      if (rewrite) {
        detail.node = {
          ...detail.node,
          thinking: {
            ...detail.node.thinking,
            nextExploration: rewrite.nextExploration,
            nextExplorationAi: true,
          },
        }
      }
    }
    writeJson(response, detail)
    return
  }

  if (url.pathname === '/api/reflection/state' && request.method === 'GET') {
    const effectiveConfig = await getEffectiveConfig(config)
    const reflection = await readReflectionState(config)
    const pendingAiIdeasCap = effectiveConfig.aiReflection?.maxPendingAiIdeas ?? 5
    const pendingAiIdeaCount = await countPendingAiIdeas(config)
    if (!reflection) {
      writeJson(response, {
        generatedAt: new Date(0).toISOString(),
        skipped: true,
        reason: 'never-run',
        pendingAiIdeaCount,
        pendingAiIdeasCap,
      })
      return
    }
    writeJson(response, { ...reflection, pendingAiIdeasCap })
    return
  }

  const dismissIdeaMatch = url.pathname.match(/^\/api\/ideas\/([^/]+)\/dismiss$/)
  if (dismissIdeaMatch && request.method === 'POST') {
    if (!isTrustedSettingsRequest(request)) {
      writeText(response, 'Idea dismiss requires loopback, private LAN, Docker, or Tailscale access', 403)
      return
    }
    const id = decodeURIComponent(dismissIdeaMatch[1] ?? '')
    try {
      const dismissed = await dismissIdea(config, id)
      writeJson(response, dismissed, 201)
    } catch (error) {
      if (error instanceof DismissError) {
        if (error.code === 'not-found') writeText(response, error.message, 404)
        else writeText(response, error.message, 400)
        return
      }
      writeText(response, error instanceof Error ? error.message : String(error), 500)
    }
    return
  }

  const graphActionMatch = url.pathname.match(/^\/api\/graph\/nodes\/([^/]+)\/(extend|find-relationships|mark-interesting)$/)
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
        : await markIdeaGraphNodeInteresting(config, report, ideas, id)
    if (!detail) {
      writeText(response, 'Graph node not found', 404)
      return
    }
    writeJson(response, detail, 201)
    return
  }

  if (url.pathname === '/api/idea/archived' && request.method === 'GET') {
    writeJson(response, await listArchivedNodes(config))
    return
  }

  const boostMatch = url.pathname.match(/^\/api\/idea\/([^/]+)\/boost$/)
  if (boostMatch && request.method === 'POST') {
    if (!isTrustedSettingsRequest(request)) {
      writeText(response, 'Boost requires loopback, private LAN, Docker, or Tailscale access', 403)
      return
    }
    const id = decodeURIComponent(boostMatch[1] ?? '')
    const report = await getVisibleReport(config, observationLoop)
    const ideas = await listIdeas(config, 40)
    const graph = await getIdeaGraph(config, report, ideas)
    const node = graph.nodes.find((item) => item.id === id)
    if (!node) {
      writeText(response, 'Idea node not found', 404)
      return
    }
    if (isBoostRunning(id)) {
      writeJson(response, { status: 'already_running' }, 409)
      return
    }
    const db = openBacklogDatabase(config)
    let backlog: BacklogItem[]
    try { backlog = listBacklog(db, 'all', new Date()) } finally { db.close() }
    void runBoost(config, id, report, ideas, backlog).catch((error) => {
      console.error('boost failed for', id, ':', error instanceof Error ? error.message : String(error))
    })
    writeJson(response, { status: 'started' }, 202)
    return
  }

  const boostStatusMatch = url.pathname.match(/^\/api\/idea\/([^/]+)\/boost-status$/)
  if (boostStatusMatch && request.method === 'GET') {
    const id = decodeURIComponent(boostStatusMatch[1] ?? '')
    const report = await getVisibleReport(config, observationLoop)
    const ideas = await listIdeas(config, 40)
    const graph = await getIdeaGraph(config, report, ideas)
    const node = graph.nodes.find((item) => item.id === id)
    writeJson(response, { status: isBoostRunning(id) ? 'running' : 'idle', updatedAt: node?.updatedAt ?? null })
    return
  }

  const archiveMatch = url.pathname.match(/^\/api\/idea\/([^/]+)\/archive$/)
  if (archiveMatch && request.method === 'POST') {
    if (!isTrustedSettingsRequest(request)) {
      writeText(response, 'Archive requires loopback, private LAN, Docker, or Tailscale access', 403)
      return
    }
    const id = decodeURIComponent(archiveMatch[1] ?? '')
    const report = await getVisibleReport(config, observationLoop)
    const ideas = await listIdeas(config, 40)
    try {
      const detail = await archiveIdeaGraphNode(config, report, ideas, id)
      if (!detail) {
        writeText(response, 'Idea node not found', 404)
        return
      }
      void recomputePreferences(config).catch((err) => {
        console.warn('preferences: recompute after archive failed:', err instanceof Error ? err.message : String(err))
      })
      writeJson(response, detail)
    } catch (error) {
      if (error instanceof ArchiveCenterNodeError) {
        writeJson(response, { error: 'cannot archive center node' }, 400)
        return
      }
      writeText(response, error instanceof Error ? error.message : String(error), 500)
    }
    return
  }

  const unarchiveMatch = url.pathname.match(/^\/api\/idea\/([^/]+)\/unarchive$/)
  if (unarchiveMatch && request.method === 'POST') {
    if (!isTrustedSettingsRequest(request)) {
      writeText(response, 'Unarchive requires loopback, private LAN, Docker, or Tailscale access', 403)
      return
    }
    const id = decodeURIComponent(unarchiveMatch[1] ?? '')
    const report = await getVisibleReport(config, observationLoop)
    const ideas = await listIdeas(config, 40)
    const detail = await unarchiveIdeaGraphNode(config, report, ideas, id)
    if (!detail) {
      writeText(response, 'Idea node not found', 404)
      return
    }
    void recomputePreferences(config).catch((err) => {
      console.warn('preferences: recompute after unarchive failed:', err instanceof Error ? err.message : String(err))
    })
    writeJson(response, detail)
    return
  }

  const deleteMatch = url.pathname.match(/^\/api\/idea\/([^/]+)$/)
  if (deleteMatch && request.method === 'DELETE') {
    if (!isTrustedSettingsRequest(request)) {
      writeText(response, 'Delete requires loopback, private LAN, Docker, or Tailscale access', 403)
      return
    }
    const id = decodeURIComponent(deleteMatch[1] ?? '')
    try {
      const deleted = await deleteIdeaGraphNode(config, id)
      if (!deleted) {
        writeText(response, 'Idea node not found', 404)
        return
      }
      writeJson(response, { id, deleted: true })
    } catch (error) {
      if (error instanceof DeleteCenterNodeError) {
        writeJson(response, { error: 'cannot delete center node' }, 400)
        return
      }
      writeText(response, error instanceof Error ? error.message : String(error), 500)
    }
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

  if (url.pathname === '/api/graph/positions' && request.method === 'GET') {
    const positions = await loadGraphPositions(config)
    writeJson(response, { positions })
    return
  }

  if (url.pathname === '/api/graph/positions' && request.method === 'PUT') {
    let body: { positions?: unknown }
    try {
      const rawBody = await readBody(request)
      body = rawBody.trim() ? (JSON.parse(rawBody) as { positions?: unknown }) : {}
    } catch {
      writeText(response, 'positions request body must be JSON', 400)
      return
    }
    if (!body.positions || typeof body.positions !== 'object' || Array.isArray(body.positions)) {
      writeText(response, 'positions must be an object mapping nodeId to {x, y}', 400)
      return
    }
    const positions: GraphPositions = {}
    for (const [id, pos] of Object.entries(body.positions as Record<string, unknown>)) {
      if (
        pos !== null &&
        typeof pos === 'object' &&
        !Array.isArray(pos) &&
        'x' in pos &&
        'y' in pos &&
        typeof (pos as { x: unknown }).x === 'number' &&
        typeof (pos as { y: unknown }).y === 'number'
      ) {
        positions[id] = { x: (pos as { x: number }).x, y: (pos as { y: number }).y }
      }
    }
    await saveGraphPositions(config, positions)
    writeJson(response, { ok: true })
    return
  }

  if (url.pathname === '/') {
    const report = await getVisibleReport(config, observationLoop)
    const ideas = await listIdeas(config, 12)
    const graph = await getIdeaGraph(config, report, ideas)
    const backlog = loadBacklogResponse(config, 'active')
    const latestDeliberation = await loadLatestDeliberation(config)
    const deliberationState: DeliberationState = {
      status: isDeliberationRunning() ? 'running' : 'idle',
      record: latestDeliberation,
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...NO_STORE_HEADERS })
    response.end(renderPage(report, ideas, Boolean(config.ai?.enabled), observationLoop ? await observationLoop.getEffectiveState() : createManualLoopState(), graph, backlog, deliberationState))
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
    const runtimeOverrides = await loadRuntimeOverrides(config)
    const effectiveConfig = await getEffectiveConfig(config)
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...NO_STORE_HEADERS })
    response.end(renderSettingsPage(config, keyStatus, runtimeOverrides, effectiveConfig))
    return
  }

  response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  response.end('Not found')
}

async function buildRuntimeOverrideResponse(config: AutopilotConfig): Promise<{ overrides: RuntimeOverrides; schema: typeof RUNTIME_OVERRIDE_SCHEMA; effective: Record<string, boolean | number | undefined>; fileConfig: Record<string, boolean | number | undefined> }> {
  const overrides = await loadRuntimeOverrides(config)
  const effectiveConfig = await getEffectiveConfig(config)
  return {
    overrides,
    schema: RUNTIME_OVERRIDE_SCHEMA,
    effective: flattenRuntimeConfig(effectiveConfig),
    fileConfig: flattenRuntimeConfig(config),
  }
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
    currentIntervalMs: 0,
    baseIntervalMs: 0,
    lastExcitementScore: 0,
    excitementMode: 'normal',
    running: false,
    runCount: 0,
  }
}

function flattenRuntimeConfig(config: AutopilotConfig): Record<string, boolean | number | undefined> {
  return {
    'aiReflection.enabled': config.aiReflection?.enabled,
    'aiReflection.maxOutputTokens': config.aiReflection?.maxOutputTokens,
    'aiReflection.maxPendingAiIdeas': config.aiReflection?.maxPendingAiIdeas,
    'backgroundObservation.enabled': config.backgroundObservation?.enabled,
    'backgroundObservation.intervalMs': config.backgroundObservation?.intervalMs,
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
  deliberationState: DeliberationState,
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
:root {
  --bg: #050505;
  --bg-card: #0a0a0a;
  --bg-card2: rgba(255,255,255,0.03);
  --accent: #00ffff;
  --accent-dim: rgba(0,255,255,0.12);
  --accent-border: rgba(0,255,255,0.25);
  --pink: #ff00ff;
  --pink-dim: rgba(255,0,255,0.12);
  --pink-border: rgba(255,0,255,0.3);
  --warn: #ef4444;
  --amber: #f59e0b;
  --muted: rgba(255,255,255,0.25);
  --muted2: rgba(255,255,255,0.08);
  --cy-h: 48dvh;
  color-scheme: dark;
  font-family: 'Courier New', monospace;
  background: var(--bg);
  color: #e0e0e0;
}
* { box-sizing: border-box; }
html, body { width: 100%; max-width: 100%; overflow-x: hidden; margin: 0; padding: 0; }
body { background: var(--bg); }

/* Scanline overlay on main */
main::before {
  content: '';
  position: fixed;
  inset: 0;
  background: repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,255,255,0.012) 3px, rgba(0,255,255,0.012) 4px);
  pointer-events: none;
  z-index: 100;
}

main { position: relative; width: 100%; max-width: 480px; margin: 0 auto; min-height: 100dvh; display: flex; flex-direction: column; }

/* Header */
.cp-header {
  padding: 14px 16px 10px;
  border-bottom: 1px solid var(--accent-border);
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: rgba(0,0,0,0.9);
  position: sticky;
  top: 0;
  z-index: 50;
}
.cp-title { font-size: 13px; font-weight: bold; color: var(--accent); text-shadow: 0 0 8px rgba(0,255,255,0.5); letter-spacing: 0.1em; text-transform: uppercase; margin: 0; }
.cp-title-group { display: inline-flex; align-items: baseline; gap: 8px; }
.cp-version { font-size: 11px; color: rgba(0,255,255,0.55); font-weight: 600; letter-spacing: 0.04em; font-family: ui-monospace, "Cascadia Code", monospace; }
.cp-settings-link { font-size: 10px; color: rgba(0,255,255,0.5); border: 1px solid var(--accent-border); padding: 3px 8px; border-radius: 4px; text-decoration: none; letter-spacing: 0.05em; }
.cp-settings-link:hover { color: var(--accent); border-color: var(--accent); }

/* Tab content panels */
.tab-panels { flex: 1; overflow-y: auto; padding: 12px; padding-bottom: 80px; }
.tab-panel[hidden] { display: none; }

/* Bottom tab bar */
.tab-bar {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr 1fr;
  border-top: 1px solid var(--accent-border);
  background: rgba(0,0,0,0.95);
  position: fixed;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 100%;
  max-width: 480px;
  z-index: 50;
}
.tab-btn {
  padding: 8px 4px;
  text-align: center;
  font-size: 8px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted);
  background: transparent;
  border: none;
  cursor: pointer;
  font-family: 'Courier New', monospace;
  transition: color 120ms ease;
}
.tab-btn:hover { color: rgba(0,255,255,0.6); }
.tab-btn.active { color: var(--accent); text-shadow: 0 0 8px rgba(0,255,255,0.5); }
.tab-btn .tab-icon { font-size: 15px; display: block; margin-bottom: 2px; }

/* Cards */
.cp-card {
  background: var(--bg-card);
  border: 1px solid var(--accent-border);
  border-radius: 12px;
  padding: 14px;
  margin-bottom: 10px;
}
.cp-card.pink { border-color: var(--pink-border); }
.cp-card.dim { border-color: rgba(255,255,255,0.08); }

/* Labels */
.sys-label { font-size: 9px; color: rgba(0,255,255,0.4); letter-spacing: 0.18em; text-transform: uppercase; margin-bottom: 6px; }
.sys-label.pink { color: rgba(255,0,255,0.4); }

/* Brain state */
.brain-mode { font-size: 22px; font-weight: bold; color: var(--accent); text-shadow: 0 0 12px var(--accent), 0 0 24px rgba(0,255,255,0.3); letter-spacing: 0.05em; }
.brain-mode.dim { color: #334155; text-shadow: none; }
.brain-sub { font-size: 10px; color: var(--pink); text-shadow: 0 0 6px var(--pink); margin-top: 2px; margin-bottom: 10px; }
.brain-sub.dim { color: #475569; text-shadow: none; }

/* Stats row */
.stats-row { display: flex; gap: 8px; margin-bottom: 10px; }
.stat-box { flex: 1; background: var(--accent-dim); border: 1px solid var(--accent-border); border-radius: 6px; padding: 6px; text-align: center; }
.stat-label { font-size: 8px; color: rgba(0,255,255,0.4); letter-spacing: 0.1em; text-transform: uppercase; }
.stat-val { font-size: 16px; font-weight: bold; color: var(--accent); text-shadow: 0 0 8px rgba(0,255,255,0.4); }
.stat-val.dim { color: #334155; text-shadow: none; }

/* Seeds */
.seeds-box { background: var(--bg-card2); border: 1px solid rgba(0,255,255,0.1); border-radius: 8px; padding: 10px; }
.seed-bullet { color: var(--pink); text-shadow: 0 0 4px var(--pink); margin-right: 6px; }

/* Deliberation */
.deliberation-btn { background: linear-gradient(135deg,rgba(0,255,255,0.08),rgba(255,0,255,0.08)); border: 1px solid var(--accent-border); color: var(--accent); padding: 7px 14px; border-radius: 6px; cursor: pointer; font-family: 'Courier New',monospace; font-size: 11px; font-weight: bold; letter-spacing: 0.05em; transition: all 0.2s; }
.deliberation-btn:hover { border-color: var(--accent); box-shadow: 0 0 10px rgba(0,255,255,0.3); }
.deliberation-btn:disabled { opacity: 0.4; cursor: not-allowed; box-shadow: none; }
.persona-chip { display: inline-block; background: rgba(255,0,255,0.1); border: 1px solid rgba(255,0,255,0.3); border-radius: 12px; padding: 2px 8px; font-size: 10px; color: var(--pink); margin: 2px; }
.deliberation-round { background: var(--bg-card2); border: 1px solid rgba(255,255,255,0.07); border-radius: 8px; padding: 8px; margin-bottom: 6px; }
.deliberation-insight { color: rgba(0,255,255,0.7); font-size: 10px; padding: 2px 0; }
.synthesis-box { background: linear-gradient(135deg,rgba(0,255,255,0.05),rgba(255,0,255,0.05)); border: 1px solid var(--accent-border); border-radius: 10px; padding: 12px; margin-top: 8px; }

/* Signal list */
.signal-list { display: flex; flex-direction: column; gap: 5px; margin-top: 4px; }
.signal-item { background: var(--bg-card2); border: 1px solid rgba(255,255,255,0.07); border-radius: 6px; padding: 7px 10px; display: flex; align-items: center; gap: 8px; font-size: 10px; }
.signal-text { flex: 1; color: #94a3b8; }
.signal-time { color: var(--muted); font-size: 9px; }

/* Backlog */
.filter-pills { display: flex; gap: 6px; margin-bottom: 10px; }
.filter-pill { background: var(--muted2); border: 1px solid rgba(255,255,255,0.1); border-radius: 20px; padding: 3px 10px; font-size: 10px; color: var(--muted); cursor: pointer; font-family: 'Courier New', monospace; }
.filter-pill.active { background: var(--accent-dim); border-color: var(--accent-border); color: var(--accent); }
.bl-item { border-radius: 8px; padding: 10px; margin-bottom: 6px; font-size: 11px; }
.bl-item.high { background: rgba(239,68,68,0.06); border-left: 2px solid var(--warn); box-shadow: -2px 0 8px rgba(239,68,68,0.15); }
.bl-item.med { background: rgba(245,158,11,0.05); border-left: 2px solid var(--amber); box-shadow: -2px 0 8px rgba(245,158,11,0.12); }
.bl-item.low { background: var(--bg-card2); border-left: 2px solid #334155; }
.bl-title { color: #e2e8f0; }
.bl-meta { color: var(--muted); font-size: 9px; margin-top: 2px; }
.bl-actions { display: flex; gap: 4px; margin-top: 6px; }
.bl-btn { font-size: 9px; padding: 3px 8px; border-radius: 4px; border: 1px solid var(--accent-border); background: transparent; color: rgba(0,255,255,0.5); cursor: pointer; font-family: 'Courier New', monospace; }
.bl-btn:hover { border-color: var(--accent); color: var(--accent); }

/* Neural graph */
.cy-container { background: #020202; border: 1px solid var(--accent-border); border-radius: 12px; height: min(54dvh, 520px); min-height: 300px; overflow: hidden; touch-action: none; }
.node-drawer { background: rgba(0,0,0,0.95); border-top: 1px solid var(--accent-border); padding: 10px 14px; }

/* Idea input */
.idea-textarea {
  width: 100%; background: var(--bg-card2); border: 1px solid var(--accent-border); border-radius: 8px; padding: 10px; color: #c0e8ff; font-size: 12px; font-family: 'Courier New', monospace; resize: none; min-height: 90px; margin-bottom: 8px;
}
.idea-textarea::placeholder { color: rgba(0,255,255,0.2); }
.idea-textarea:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 10px rgba(0,255,255,0.1); }
.transmit-btn { width: 100%; padding: 11px; background: transparent; border: 1px solid rgba(0,255,255,0.5); border-radius: 8px; color: var(--accent); font-weight: bold; font-size: 12px; font-family: 'Courier New', monospace; letter-spacing: 0.1em; text-shadow: 0 0 8px rgba(0,255,255,0.4); box-shadow: 0 0 15px rgba(0,255,255,0.08); cursor: pointer; }
.transmit-btn:hover { background: var(--accent-dim); }
.idea-item { background: var(--bg-card2); border: 1px solid rgba(255,255,255,0.06); border-radius: 6px; padding: 7px 9px; margin-bottom: 5px; display: flex; justify-content: space-between; align-items: center; }
.idea-name { font-size: 11px; color: #94a3b8; }
.idea-status { font-size: 9px; color: rgba(0,255,255,0.4); }

/* Desktop sidebar layout */
.desktop-layout { display: grid; grid-template-columns: 300px 1fr 300px; gap: 16px; align-items: start; }
@media (min-width: 768px) {
  main { max-width: 1400px; padding: 0 20px; }
  #mobile-panels { display: none; }
  #desktop-panels { display: grid !important; }
  .tab-bar { display: none; }
}

/* Muted / utilities */
.muted { color: var(--muted); font-size: 11px; }
a, a:visited { color: var(--accent); }
button, a.button { cursor: pointer; }

/* Legacy classes kept for existing render helpers */
.cockpit-panel { max-height: clamp(520px, 62vh, 720px); overflow-y: auto; overflow-x: hidden; touch-action: pan-y; }
.node-action-bar.primary { position: sticky; top: 0; z-index: 2; background: rgba(11,9,7,0.92); backdrop-filter: blur(6px); margin: 0 -16px 12px; padding: 8px 16px; display: flex; flex-wrap: wrap; gap: 8px; border-bottom: 1px solid rgba(245,234,215,0.08); }
.kw-strip { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0 14px; }
.kw-strip .pill { white-space: normal; overflow-wrap: anywhere; text-overflow: clip; max-width: 100%; font-size: 14px; padding: 5px 11px; background: rgba(34,211,238,0.16); border: 1px solid rgba(34,211,238,0.42); color: #cffafe; font-weight: 600; }
@media (min-width: 768px) { .kw-strip .pill { font-size: 13px; } }
.node-drawer .thought-line, .node-drawer .trace-note > div, .node-drawer .radar-signals li, .node-drawer .recommendation > div { overflow-wrap: anywhere; word-break: break-word; -webkit-line-clamp: unset; text-overflow: clip; white-space: normal; }
.vault-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; margin-left: 8px; border-radius: 999px; background: rgba(165,243,252,0.16); color: #cffafe; border: 1px solid rgba(165,243,252,0.42); font-size: 12px; font-weight: 700; cursor: pointer; }
.vault-chip:hover { background: rgba(165,243,252,0.26); }
.vault-row { padding: 12px; margin-bottom: 8px; border: 1px solid rgba(245,234,215,0.16); border-radius: 14px; background: rgba(15,23,42,0.42); }
.vault-row strong { display: block; margin-bottom: 4px; }
.vault-actions { margin-top: 8px; display: flex; gap: 8px; flex-wrap: wrap; }
.vault-back { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; margin-bottom: 12px; border-radius: 999px; background: rgba(148,163,184,0.18); color: #e5eefc; border: 1px solid rgba(148,163,184,0.28); cursor: pointer; font-weight: 600; }
.detail-collapse { margin-top: 12px; }
.detail-collapse > summary { cursor: pointer; padding: 6px 0; color: var(--muted); font-size: 13px; font-weight: 600; list-style: none; }
.detail-collapse > summary::before { content: '🔬 詳情 ▾'; }
.detail-collapse[open] > summary::before { content: '🔬 詳情 ▴'; }
.detail-meta { font-size: 12px; color: var(--muted); margin: 6px 0 10px; }
.detail-actions { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0; }
.neural-map { position: absolute; inset: 0; width: 100%; height: 100%; }
.neural-edge { stroke: rgba(245,234,215,0.22); stroke-width: 1.4; }
.neural-edge.strong { stroke: rgba(45,212,191,0.55); stroke-width: 2.2; }
.neural-edge.focused { stroke: rgba(251,191,36,0.78); stroke-width: 2.2; }
.neural-edge-label { fill: #fde68a; font-size: 2.4px; font-weight: 700; paint-order: stroke; stroke: rgba(11,9,7,0.92); stroke-width: 0.6px; pointer-events: none; }
.brain-node { position: absolute; z-index: 1; transform: translate(-50%, -50%); display: grid; place-items: center; width: clamp(82px, 12vw, 126px); min-height: 72px; max-height: 132px; overflow: hidden; border: 1px solid rgba(245,234,215,0.24); border-radius: 26px; padding: 10px; background: rgba(11,9,7,0.74); color: #fef3c7; text-align: center; box-shadow: 0 0 34px rgba(251,191,36,0.14); backdrop-filter: blur(10px); cursor: pointer; transition: border-color 160ms ease, background 160ms ease, box-shadow 160ms ease; }
.brain-node:hover, .brain-node.active { z-index: 5; border-color: rgba(251,191,36,0.85); background: rgba(42,28,13,0.94); box-shadow: 0 0 42px rgba(251,191,36,0.36); }
.brain-node.faded { opacity: 0.32; filter: saturate(0.6); }
.brain-node.faded:hover { opacity: 0.9; }
.neural-hidden-chip { position: absolute; right: 12px; bottom: 10px; padding: 6px 12px; border-radius: 999px; background: rgba(11,9,7,0.78); color: #fde68a; font-size: 12px; font-weight: 700; border: 1px solid rgba(251,191,36,0.32); pointer-events: none; }
.focus-hint { display: inline-block; margin: 0 0 6px; padding: 4px 10px; border-radius: 999px; background: rgba(251,191,36,0.16); border: 1px solid rgba(251,191,36,0.4); color: #fde68a; font-size: 12px; font-weight: 700; }
.focus-hint[hidden] { display: none; }
.ai-pill { background: rgba(168,85,247,0.22); color: #e9d5ff; border: 1px solid rgba(168,85,247,0.42); font-weight: 800; }
.ai-tag { display: inline-block; margin-left: 6px; padding: 2px 8px; border-radius: 999px; background: rgba(168,85,247,0.22); color: #e9d5ff; border: 1px solid rgba(168,85,247,0.42); font-size: 11px; font-weight: 700; vertical-align: middle; }
.brain-node.double { width: clamp(138px, 20vw, 190px); min-height: 104px; max-height: 160px; border-radius: 999px; background: radial-gradient(circle, rgba(251,191,36,0.28), rgba(11,9,7,0.82)); }
.brain-node.keyword { border-style: dashed; color: #fde68a; }
.brain-node.project { color: #bbf7d0; }
.brain-node.signal { color: #fecaca; }
.brain-node.research, .brain-node.extension { color: #99f6e4; }
.brain-node.task { color: #bfdbfe; }
.node-type { display: block; font: 800 10px/1 ui-monospace, "Cascadia Code", monospace; letter-spacing: 0.12em; text-transform: uppercase; color: #a8a29e; margin-bottom: 5px; }
.node-title { display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; font-weight: 900; line-height: 1.25; overflow-wrap: anywhere; }
.node-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-start; padding: 0 0 10px; }
.node-action-bar { margin: 0 0 12px; border-bottom: 1px solid rgba(148,163,184,0.14); }
.node-actions button, .node-actions .node-action-disabled { margin: 0; max-width: 100%; white-space: normal; text-align: left; }
.node-actions button:disabled { opacity: 0.44; cursor: not-allowed; }
.node-action-disabled { display: inline-flex; flex-direction: column; gap: 2px; border-radius: 999px; padding: 8px 13px; background: rgba(148,163,184,0.12); color: #94a3b8; font-weight: 700; }
.node-action-disabled small { font-size: 11px; font-weight: 600; color: #64748b; }
.eyebrow { color: #fbbf24; font-size: 13px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; }
.thought-line { font-size: clamp(18px, 3vw, 26px); line-height: 1.38; color: #fef3c7; }
.status-strip { display: grid; grid-template-columns: repeat(auto-fit, minmax(118px, 1fr)); gap: 10px; margin: 12px 0 0; }
.status-item { border: 1px solid rgba(148,163,184,0.16); border-radius: 14px; padding: 10px; background: rgba(8,13,25,0.42); }
.status-item strong { display: block; font-size: 20px; margin-top: 4px; }
.label { color: #93a4bd; font-size: 13px; }
.recommendation { border-radius: 16px; padding: 14px; background: rgba(120,53,15,0.28); border: 1px solid rgba(245,158,11,0.28); }
.recommendation strong { display: block; margin-bottom: 6px; }
.trace-note { border: 1px solid rgba(148,163,184,0.18); border-radius: 14px; padding: 12px; background: rgba(8,13,25,0.42); }
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
.workbench-card { display: grid; gap: 10px; border: 1px solid rgba(148,163,184,0.18); border-top: 4px solid #64748b; border-radius: 18px; padding: 14px; background: rgba(15,23,42,0.52); min-width: 0; }
.workbench-card.issue-critical { border-top-color: #f87171; }
.workbench-card.issue-watch { border-top-color: #f59e0b; }
.workbench-card.issue-normal { border-top-color: #60a5fa; }
.workbench-head { display: flex; gap: 10px; align-items: flex-start; }
.source-badge { flex: 0 0 auto; display: inline-grid; place-items: center; min-width: 34px; height: 34px; padding: 0 8px; border-radius: 12px; background: rgba(96,165,250,0.18); color: #dbeafe; font: 800 13px/1 ui-monospace, "Cascadia Code", monospace; }
.workbench-title { font-weight: 800; line-height: 1.28; overflow-wrap: anywhere; }
.debug-note { color: #94a3b8; font-size: 13px; }
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
.thinking-trace { border-color: rgba(34,197,94,0.34); background: radial-gradient(circle at top left, rgba(34,197,94,0.13), transparent 34%), linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.035)); }
.thinking-grid { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(250px, 0.9fr); gap: 14px; align-items: start; }
.trace-step { border: 1px solid rgba(34,197,94,0.2); border-left: 4px solid rgba(34,197,94,0.78); border-radius: 14px; padding: 12px; background: rgba(15,23,42,0.5); margin-bottom: 10px; }
.trace-step strong { display: block; margin-bottom: 5px; }
.candidate-action { margin-top: 8px; color: #cbd5e1; font-size: 13px; }
.workbench { border-color: rgba(96,165,250,0.32); background: radial-gradient(circle at top right, rgba(96,165,250,0.14), transparent 34%), linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.035)); }
.workbench-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 12px; }
.detail-block { border: 1px solid rgba(148,163,184,0.18); border-radius: 16px; padding: 14px; background: rgba(15,23,42,0.5); }
.primary-card { border: 1px solid rgba(148,163,184,0.18); border-radius: 16px; padding: 14px; background: rgba(15,23,42,0.5); border-left: 5px solid #f59e0b; margin: 16px 0; }
.side-panel { border: 1px solid rgba(148,163,184,0.18); border-radius: 16px; padding: 14px; background: rgba(15,23,42,0.5); display: grid; gap: 12px; }
.detail-block { margin: 14px 0; }
.only-action { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-top: 12px; }
.mission { border: 1px solid rgba(96,165,250,0.28); border-left: 5px solid #60a5fa; border-radius: 16px; padding: 14px; background: rgba(30,64,175,0.16); margin-bottom: 16px; }
.mission-title { margin: 0 0 6px; font-size: clamp(20px, 4vw, 28px); line-height: 1.15; }
.mission p { margin: 6px 0 0; }
.capability-rail { border: 1px solid rgba(148,163,184,0.22); border-radius: 18px; padding: clamp(14px, 4vw, 18px); border-color: rgba(96,165,250,0.36); background: radial-gradient(circle at top left, rgba(96,165,250,0.16), transparent 32%), linear-gradient(180deg, rgba(255,255,255,0.075), rgba(255,255,255,0.035)); }
.capability-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; margin-top: 12px; }
.capability-card { border: 1px solid rgba(148,163,184,0.18); border-radius: 16px; padding: 12px; background: rgba(15,23,42,0.48); }
.capability-card strong { display: block; margin-bottom: 5px; color: #f8fafc; }
.truth-box { border: 1px solid rgba(34,197,94,0.28); border-left: 5px solid #22c55e; border-radius: 16px; padding: 14px; background: rgba(20,83,45,0.18); margin-bottom: 16px; }
.truth-box strong { display: block; margin-bottom: 6px; font-size: 18px; }
.main-action { margin: 6px 0 10px; font-size: clamp(34px, 8vw, 64px); line-height: 1.02; letter-spacing: -0.07em; }
.plain-answer { font-size: clamp(18px, 4vw, 24px); line-height: 1.45; color: #f8fafc; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(132px, 1fr)); gap: 12px; margin-bottom: 20px; }
.card { min-width: 0; background: linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.035)); border: 1px solid rgba(148,163,184,0.22); border-radius: 18px; padding: clamp(14px, 4vw, 18px); box-shadow: 0 18px 48px rgba(0,0,0,0.24); }
.neural-stage { position: relative; height: clamp(520px, 62vh, 720px); border: 1px solid rgba(251,191,36,0.18); border-radius: 28px; overflow: hidden; background: radial-gradient(circle at center, rgba(251,191,36,0.12), rgba(8,13,25,0.2) 42%, rgba(8,13,25,0.68)); }
.neural-shell { position: relative; display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(290px, 0.75fr); gap: 16px; align-items: start; }
.neural-cockpit { position: relative; overflow: hidden; border: 1px solid rgba(148,163,184,0.22); border-radius: 18px; padding: clamp(14px, 4vw, 18px); border-color: rgba(251,191,36,0.42); background: radial-gradient(circle at 20% 10%, rgba(251,191,36,0.18), transparent 28%), radial-gradient(circle at 80% 18%, rgba(45,212,191,0.13), transparent 26%), linear-gradient(135deg, rgba(41,25,13,0.96), rgba(13,18,20,0.94)); }
.neural-cockpit::before { content: ""; position: absolute; inset: 0; pointer-events: none; background-image: linear-gradient(rgba(245,234,215,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(245,234,215,0.035) 1px, transparent 1px); background-size: 34px 34px; mask-image: radial-gradient(circle at center, black, transparent 74%); }
.capture-strip { position: relative; margin-top: 16px; border: 1px solid rgba(251,191,36,0.2); border-radius: 22px; padding: 14px; background: rgba(11,9,7,0.56); }
.capture-strip textarea { min-height: 86px; background: rgba(0,0,0,0.2); }
.command-grid, .focus-grid { display: grid; grid-template-columns: minmax(0, 1.08fr) minmax(280px, 0.82fr); gap: 16px; align-items: start; }
.cockpit-panel h2 { font-size: 24px; line-height: 1.18; margin-bottom: 8px; }
.cockpit-panel { border: 1px solid rgba(245,234,215,0.16); border-radius: 24px; padding: 16px; background: rgba(11,9,7,0.72); min-width: 0; width: 100%; max-width: 100%; }
@media (max-width: 820px) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .command-grid, .focus-grid, .agent-board, .thinking-grid, .neural-shell, .backlog-evidence { grid-template-columns: minmax(0, 1fr); } .neural-stage { min-height: 430px; } table { font-size: 13px; } }
@media (max-width: 520px) { .grid { grid-template-columns: 1fr 1fr; } .value { font-size: 24px; } a.button, button { min-height: 44px; } .cockpit-panel { height: calc(100dvh - var(--cy-h, 48dvh) - 160px); max-height: none; overflow-y: auto; padding: 12px; } .node-action-bar { margin: 0 0 12px; } .tab-panels { padding: 10px; padding-bottom: 74px; } .cy-container { height: min(48dvh, 430px); min-height: 280px; border-radius: 10px; } .node-drawer { padding: 9px 12px; } }
  </style>
  <script src="https://unpkg.com/cytoscape@3.30.4/dist/cytoscape.min.js"></script>
</head>
<body>
<main>
  <header class="cp-header">
    <div class="cp-title-group">
      <h1 class="cp-title">Kevin Autopilot</h1>
      <span class="cp-version" title="App version">v${escapeHtml(APP_VERSION)}</span>
    </div>
    <a class="cp-settings-link" href="/settings">SYS ⚙</a>
  </header>

  <!-- Mobile: individual tab panels; default tab = graph (神經圖) -->
  <div id="mobile-panels" class="tab-panels">
    <div class="tab-panel" id="tab-graph">${renderGraphTab(graph, loopState)}</div>
    <div class="tab-panel" id="tab-brain" hidden>${renderBrainTab(loopState, graph, deliberationState)}</div>
    <div class="tab-panel" id="tab-backlog" hidden>${renderBacklogTab(backlog)}</div>
    <div class="tab-panel" id="tab-idea" hidden>${renderIdeaTab(ideas)}</div>
  </div>
  <!-- Desktop: always-visible three-column layout -->
  <div id="desktop-panels" class="desktop-layout" style="display:none">
    <div>${renderBrainTab(loopState, graph, deliberationState)}</div>
    <div>${renderGraphTab(graph, loopState)}</div>
    <div>
      ${renderBacklogTab(backlog)}
      <div style="margin-top:10px">${renderIdeaTab(ideas)}</div>
    </div>
  </div>

  <nav class="tab-bar">
    <button class="tab-btn active" data-tab="graph" onclick="switchTab('graph')">
      <span class="tab-icon">🕸</span>圖
    </button>
    <button class="tab-btn" data-tab="brain" onclick="switchTab('brain')">
      <span class="tab-icon">🧠</span>分身
    </button>
    <button class="tab-btn" data-tab="backlog" onclick="switchTab('backlog')">
      <span class="tab-icon">📋</span>Backlog
    </button>
    <button class="tab-btn" data-tab="idea" onclick="switchTab('idea')">
      <span class="tab-icon">✏️</span>想法
    </button>
  </nav>
</main>
<script>
function switchTab(name) {
  document.querySelectorAll('#mobile-panels .tab-panel').forEach(function(el) { el.hidden = true; });
  document.querySelectorAll('.tab-btn').forEach(function(el) { el.classList.remove('active'); });
  var panel = document.getElementById('tab-' + name);
  if (panel) panel.hidden = false;
  var btn = document.querySelector('[data-tab="' + name + '"]');
  if (btn) btn.classList.add('active');
  history.replaceState(null, '', '#' + name);
}
(function() {
  var hash = location.hash.slice(1);
  if (['brain','backlog','graph','idea'].indexOf(hash) !== -1) switchTab(hash);
})();
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

  const initialGraphData = JSON.parse(document.getElementById('graph-data')?.textContent || '{}');
  let focusedNodeId = (initialGraphData && typeof initialGraphData.centerNodeId === 'string') ? initialGraphData.centerNodeId : null;
  const NEURAL_OUTER_RING_LIMIT = 8;

  const initialLoopData = JSON.parse(document.getElementById('loop-data')?.textContent || '{}');

  function formatHm(value) {
    if (!value) return '—';
    try {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '—';
      return new Intl.DateTimeFormat('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Taipei' }).format(date);
    } catch { return '—'; }
  }

  async function refreshReflectionStatus() {
    const status = document.getElementById('reflection-status');
    if (!status) return;
    try {
      const response = await fetch('/api/reflection/state', { cache: 'no-store' });
      if (!response.ok) {
        status.textContent = '反思狀態暫時讀不到。';
        return;
      }
      const record = await response.json();
      const pending = record.pendingAiIdeaCount ?? 0;
      const cap = record.pendingAiIdeasCap ?? 5;
      if (record.skipped === true) {
        if (record.reason === 'never-run') {
          status.textContent = '分身還沒做過反思 · pending AI 想法 ' + pending + '/' + cap;
        } else if (record.reason === 'unchanged') {
          status.textContent = '上次反思：' + formatHm(record.generatedAt) + ' · 圖未變化 · pending ' + pending + '/' + cap;
        } else if (record.reason === 'disabled') {
          status.textContent = '反思離線：' + (record.detail || 'disabled') + ' · pending ' + pending + '/' + cap;
        } else {
          status.textContent = '反思離線（' + record.reason + '）：' + (record.detail || '') + ' · pending ' + pending + '/' + cap;
        }
      } else {
        const seeds = (record.newIdeaSeeds && record.newIdeaSeeds.length) || 0;
        const rewrites = (record.nextExplorationRewrites && record.nextExplorationRewrites.length) || 0;
        status.textContent = '上次反思：' + formatHm(record.generatedAt) + ' · 新 idea ' + seeds + ' · 改寫 ' + rewrites + ' · pending ' + pending + '/' + cap;
      }
    } catch {
      status.textContent = '反思狀態暫時讀不到。';
    }
  }

  refreshReflectionStatus();

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
    refreshReflectionStatus();
  }, 60000);

  async function resetFocusToCenter() {
    const defaultFocus = initialGraphData?.centerNodeId ?? null;
    if (!defaultFocus || focusedNodeId === defaultFocus) return;
    focusedNodeId = defaultFocus;
    await refreshGraphInPlace(focusedNodeId);
    try {
      const response = await fetch('/api/graph/nodes/' + encodeURIComponent(defaultFocus));
      if (response.ok) renderNodeDrawer(await response.json());
    } catch {}
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      resetFocusToCenter();
      (window._cyInstances || []).forEach(function(cy) { cy.nodes().removeClass('cy-selected'); });
      var drawer = document.getElementById('node-drawer');
      if (drawer) drawer.style.display = 'none';
    }
  });

  document.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const stage = document.getElementById('neural-stage');
    const nodeButton = target.closest('.brain-node');
    if (nodeButton) {
      const nodeId = nodeButton.getAttribute('data-node-id');
      if (!nodeId) return;
      const previousFocus = focusedNodeId;
      const defaultFocus = initialGraphData?.centerNodeId ?? null;
      const togglingOff = previousFocus === nodeId && defaultFocus && nodeId !== defaultFocus;
      const targetNodeId = togglingOff ? defaultFocus : nodeId;
      focusedNodeId = targetNodeId;
      document.querySelectorAll('.brain-node').forEach((item) => item.classList.remove('active'));
      nodeButton.classList.add('active');
      await refreshGraphInPlace(focusedNodeId);
      refreshCyGraph();
      const response = await fetch('/api/graph/nodes/' + encodeURIComponent(targetNodeId));
      if (!response.ok) return;
      renderNodeDrawer(await response.json());
      return;
    }
    if (stage && (target === stage || stage.contains(target))) {
      if (!target.closest('button') && !target.closest('a')) {
        await resetFocusToCenter();
        return;
      }
    }

    const actionButton = target.closest('.node-action');
    if (actionButton) {
      const action = actionButton.getAttribute('data-action');
      const nodeId = actionButton.getAttribute('data-node-id');
      if (['extend', 'find-relationships', 'mark-interesting'].includes(action) && nodeId) {
        actionButton.textContent = graphActionProgressText(action);
        const response = await fetch('/api/graph/nodes/' + encodeURIComponent(nodeId) + '/' + action, { method: 'POST' });
        if (!response.ok) {
          actionButton.textContent = await response.text();
          return;
        }
        const detail = await response.json();
        renderNodeDrawer(detail);
        focusedNodeId = detail.node.id;
        await refreshGraphInPlace(focusedNodeId);
        refreshCyGraph();
        return;
      }
      if (action === 'archive' && nodeId) {
        actionButton.textContent = graphActionProgressText(action);
        const response = await fetch('/api/idea/' + encodeURIComponent(nodeId) + '/archive', { method: 'POST' });
        if (!response.ok) {
          actionButton.textContent = await response.text();
          return;
        }
        location.reload();
        return;
      }
      if (action === 'boost' && nodeId) {
        actionButton.disabled = true;
        actionButton.textContent = graphActionProgressText(action);
        const post = await fetch('/api/idea/' + encodeURIComponent(nodeId) + '/boost', { method: 'POST' });
        if (post.status === 409) {
          actionButton.textContent = '已經在想了…';
          return;
        }
        if (!post.ok) {
          actionButton.textContent = await post.text();
          actionButton.disabled = false;
          return;
        }
        pollBoost(nodeId, actionButton);
        return;
      }
      if (action === 'deliberate' && nodeId) {
        actionButton.disabled = true;
        actionButton.textContent = graphActionProgressText(action);
        const post = await fetch('/api/deliberation', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ anchorNodeId: nodeId }),
        });
        if (post.status === 409) {
          actionButton.textContent = '已經在想了…';
          return;
        }
        if (!post.ok) {
          actionButton.textContent = await post.text();
          actionButton.disabled = false;
          return;
        }
        // Existing deliberation polling will refresh page on completion.
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

    const dismissAiIdeaButton = target.closest('.dismiss-ai-idea');
    if (dismissAiIdeaButton) {
      event.preventDefault();
      const ideaId = dismissAiIdeaButton.getAttribute('data-id');
      if (!ideaId) return;
      dismissAiIdeaButton.textContent = '略過中...';
      try {
        const response = await fetch('/api/ideas/' + encodeURIComponent(ideaId) + '/dismiss', { method: 'POST' });
        if (!response.ok) {
          dismissAiIdeaButton.textContent = await response.text();
          return;
        }
        const card = document.getElementById('idea-card-' + ideaId);
        if (card) card.remove();
        refreshReflectionStatus();
      } catch (error) {
        dismissAiIdeaButton.textContent = '略過失敗';
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
    if (actionId === 'boost') return '中心節點不可深化';
    if (actionId === 'deliberate') return '中心節點不能當辯論主軸';
    if (actionId === 'archive') return '中心節點不可冷凍';
    if (actionId === 'extend') return '任務節點已經是 handoff prompt';
    if (actionId === 'copy-opencode-prompt') return '這個節點沒有 prompt';
    if (actionId === 'find-relationships') return '任務節點不再展開關聯';
    if (actionId === 'mark-interesting') return '已保留給分身';
    return '這個動作目前不可用';
  }

  function graphActionProgressText(actionId) {
    if (actionId === 'boost') return '深化中...';
    if (actionId === 'deliberate') return '辯論進行中...';
    if (actionId === 'archive') return '冷凍中...';
    if (actionId === 'extend') return '延伸中...';
    if (actionId === 'find-relationships') return '找關聯中...';
    if (actionId === 'mark-interesting') return '標記中...';
    return '處理中...';
  }

  function renderNodeDrawer(detail) {
    const drawer = document.getElementById('node-drawer');
    const thought = document.getElementById('node-understanding');
    const title = document.getElementById('node-current-title');
    const hint = document.getElementById('focus-hint');
    if (!drawer || !detail || !detail.node) return;
    const node = detail.node;
    if (thought) thought.textContent = node.thinking.understanding;
    if (title) title.textContent = node.title;
    const defaultFocus = initialGraphData?.centerNodeId ?? null;
    if (hint) {
      if (focusedNodeId && defaultFocus && focusedNodeId !== defaultFocus) {
        hint.hidden = false;
        hint.textContent = '聚焦：' + node.title + '　·　點空白處或按 Esc 取消聚焦';
      } else {
        hint.hidden = true;
        hint.textContent = '';
      }
    }
    const primaryIds = ['boost', 'deliberate', 'archive'];
    const secondaryIds = ['extend', 'find-relationships', 'mark-interesting', 'copy-opencode-prompt'];
    const primaryActionsHtml = (node.actions || []).filter((a) => primaryIds.indexOf(a.id) >= 0).map((action) => renderBrowserNodeAction(node.id, action)).join('');
    const secondaryActionsHtml = (node.actions || []).filter((a) => secondaryIds.indexOf(a.id) >= 0).map((action) => renderBrowserNodeAction(node.id, action)).join('');
    const keywordHtml = node.keywords.length === 0 ? '<span class="muted">尚未抽到關鍵字</span>' : node.keywords.map((keyword) => '<span class="pill">' + htmlEscape(keyword) + '</span>').join('');
    const connectedHtml = detail.connectedNodes.length === 0 ? '<p class="muted">目前沒有相連節點。</p>' : '<div class="kw-strip">' + detail.connectedNodes.slice(0, 6).map((item) => '<span class="pill">' + htmlEscape(item.title) + '</span>').join('') + '</div>';
    const promptHtml = node.prompt ? '<details><summary>OpenCode prompt</summary><button type="button" class="secondary copy-prompt">複製 Prompt</button><span class="copy-status" aria-live="polite"></span><pre>' + htmlEscape(node.prompt) + '</pre></details>' : '';
    const evidenceHtml = node.thinking.evidence.length === 0 ? '<p class="muted">目前沒有證據。</p>' : '<ul class="radar-signals">' + node.thinking.evidence.slice(0, 4).map((item) => '<li>' + htmlEscape(item) + '</li>').join('') + '</ul>';
    const missingHtml = node.thinking.missingEvidence.length === 0 ? '<p class="muted">目前沒有明確缺口。</p>' : '<ul class="radar-signals">' + node.thinking.missingEvidence.slice(0, 4).map((item) => '<li>' + htmlEscape(item) + '</li>').join('') + '</ul>';
    const questionList = Array.isArray(node.thinking.questions) && node.thinking.questions.length ? node.thinking.questions : ['這個想法真正想解決的問題是什麼？'];
    const questionHtml = '<div class="recommendation"><strong>❓ 分身正在問</strong><ul class="radar-signals">' + questionList.slice(0, 3).map((item) => '<li>' + htmlEscape(item) + '</li>').join('') + '</ul></div>';
    const nextExplorationTag = node.thinking.nextExplorationAi ? '<span class="ai-tag">AI 改寫</span>' : '';
    const detailMeta = htmlEscape(node.type) + ' · ' + htmlEscape(node.confidence) + ' · ' + htmlEscape(node.source) +
      '<br>建立：' + htmlEscape(formatBrowserTime(node.createdAt)) + '　最近：' + htmlEscape(formatBrowserTime(node.updatedAt)) +
      (typeof node.seenCount === 'number' ? '　觀察 ' + node.seenCount + ' 次' : '');
    drawer.innerHTML =
      '<div class="node-action-bar primary">' + primaryActionsHtml + '</div>' +
      '<div class="recommendation"><strong>' + htmlEscape(node.title) + '</strong><div>' + htmlEscape(node.summary) + '</div><div class="kw-strip">' + keywordHtml + '</div></div>' +
      '<div class="trace-note"><strong>💭 分身怎麼想這個</strong><div>' + htmlEscape(node.thinking.understanding) + '</div><div class="muted">為什麼有關：' + htmlEscape(node.thinking.whyItMatters) + '</div><div class="muted">下一步：' + htmlEscape(node.thinking.nextExploration) + nextExplorationTag + '</div></div>' +
      questionHtml +
      '<div><strong>🔗 相連節點</strong>' + connectedHtml + '</div>' +
      '<div><strong>📎 證據</strong>' + evidenceHtml + '</div>' +
      '<div><strong>🕳 缺的證據</strong>' + missingHtml + '</div>' +
      '<details class="detail-collapse"><summary></summary><div class="detail-meta">' + detailMeta + '</div><div class="detail-actions">' + secondaryActionsHtml + '</div>' + promptHtml + '</details>';
  }

  function formatBrowserTime(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString('zh-Hant-TW', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch (_e) {
      return String(iso).slice(0, 16).replace('T', ' ');
    }
  }

  async function refreshGraphInPlace(targetFocus) {
    const response = await fetch('/api/graph', { cache: 'no-store' });
    if (!response.ok) return;
    const graph = await response.json();
    const graphData = document.getElementById('graph-data');
    if (graphData) graphData.textContent = JSON.stringify(graph).replaceAll('<', '\\u003c').replaceAll('&', '\\u0026');
    renderGraphStage(graph, targetFocus ?? focusedNodeId);
  }

  function renderGraphStage(graph, focusId) {
    const stage = document.getElementById('neural-stage');
    if (!stage || !graph || !Array.isArray(graph.nodes)) return;
    const layoutResult = createBrowserGraphLayout(graph, focusId);
    const focused = focusId && focusId !== graph.centerNodeId;
    const edgeHtml = (graph.edges || []).map((edge) => {
      const from = layoutResult.positions.get(edge.from);
      const to = layoutResult.positions.get(edge.to);
      if (!from || !to) return '';
      const isIncident = focused && (edge.from === focusId || edge.to === focusId);
      const strongClass = edge.confidence === 'strong' ? ' strong' : '';
      const focusClass = isIncident ? ' focused' : '';
      const labelHtml = isIncident
        ? '<text class="neural-edge-label" x="' + ((from.x + to.x) / 2) + '" y="' + ((from.y + to.y) / 2 - 1) + '" text-anchor="middle">' + htmlEscape(edgeLabelText(edge.rationale)) + '</text>'
        : '';
      return '<line class="neural-edge' + strongClass + focusClass + '" x1="' + from.x + '" y1="' + from.y + '" x2="' + to.x + '" y2="' + to.y + '"><title>' + htmlEscape(edge.rationale) + '</title></line>' + labelHtml;
    }).join('');
    const visibleIds = layoutResult.visibleIds;
    const nodeHtml = graph.nodes.filter((node) => visibleIds.has(node.id)).map((node) => {
      const point = layoutResult.positions.get(node.id) || { x: 50, y: 50 };
      const fadedClass = layoutResult.fadedIds.has(node.id) ? ' faded' : '';
      const activeClass = node.id === focusId ? ' active' : '';
      return '<button type="button" class="brain-node ' + htmlEscape(node.type) + activeClass + fadedClass + '" data-node-id="' + htmlEscape(node.id) + '" style="left:' + point.x + '%;top:' + point.y + '%"><span class="node-type">' + htmlEscape(node.type) + '</span><span class="node-title">' + htmlEscape(node.title) + '</span></button>';
    }).join('');
    const hiddenChip = layoutResult.hiddenCount > 0
      ? '<div class="neural-hidden-chip">+' + layoutResult.hiddenCount + ' 已折疊</div>'
      : '';
    stage.innerHTML = '<svg class="neural-map" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' + edgeHtml + '</svg>' + nodeHtml + hiddenChip;
  }

  function edgeLabelText(rationale) {
    const value = String(rationale || '').replace(/\s+/g, ' ').trim();
    return value.length > 18 ? value.slice(0, 18) + '…' : value;
  }

  function createBrowserGraphLayout(graph, focusId) {
    const positions = new Map();
    const fadedIds = new Set();
    const visibleIds = new Set();
    const centerId = graph.centerNodeId;
    const focused = focusId && focusId !== centerId;
    const focusedNode = focused ? graph.nodes.find((node) => node.id === focusId) : null;
    if (focused && !focusedNode) return createBrowserGraphLayout(graph, centerId);

    if (!focused) {
      const center = graph.nodes.find((node) => node.id === centerId) || graph.nodes[0];
      if (center) {
        positions.set(center.id, { x: 50, y: 50 });
        visibleIds.add(center.id);
      }
      const others = graph.nodes.filter((node) => node.id !== (center && center.id));
      others.forEach((node, index) => {
        const ring = index < 12 ? 1 : 2;
        const ringIndex = ring === 1 ? index : index - 12;
        const ringCount = ring === 1 ? Math.min(12, others.length) : Math.max(1, others.length - 12);
        const angle = (Math.PI * 2 * ringIndex) / ringCount - Math.PI / 2;
        const radiusX = ring === 1 ? 32 : 43;
        const radiusY = ring === 1 ? 31 : 41;
        positions.set(node.id, { x: Math.round((50 + Math.cos(angle) * radiusX) * 10) / 10, y: Math.round((50 + Math.sin(angle) * radiusY) * 10) / 10 });
        visibleIds.add(node.id);
      });
      return { positions, fadedIds, visibleIds, hiddenCount: 0 };
    }

    positions.set(focusedNode.id, { x: 50, y: 50 });
    visibleIds.add(focusedNode.id);

    const neighbourIds = new Set();
    for (const edge of (graph.edges || [])) {
      if (edge.from === focusedNode.id) neighbourIds.add(edge.to);
      else if (edge.to === focusedNode.id) neighbourIds.add(edge.from);
    }
    neighbourIds.delete(focusedNode.id);

    const neighbourNodes = graph.nodes.filter((node) => neighbourIds.has(node.id));
    neighbourNodes.forEach((node, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(1, neighbourNodes.length) - Math.PI / 2;
      positions.set(node.id, {
        x: Math.round((50 + Math.cos(angle) * 30) * 10) / 10,
        y: Math.round((50 + Math.sin(angle) * 29) * 10) / 10,
      });
      visibleIds.add(node.id);
    });

    const nonNeighbours = graph.nodes.filter((node) => node.id !== focusedNode.id && !neighbourIds.has(node.id));
    const visibleNonNeighbours = nonNeighbours.slice(0, NEURAL_OUTER_RING_LIMIT);
    const hiddenCount = Math.max(0, nonNeighbours.length - visibleNonNeighbours.length);
    visibleNonNeighbours.forEach((node, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(1, visibleNonNeighbours.length) - Math.PI / 2;
      positions.set(node.id, {
        x: Math.round((50 + Math.cos(angle) * 46) * 10) / 10,
        y: Math.round((50 + Math.sin(angle) * 44) * 10) / 10,
      });
      visibleIds.add(node.id);
      fadedIds.add(node.id);
    });

    return { positions, fadedIds, visibleIds, hiddenCount };
  }

  function renderNodeActionBar(node) {
    const actionBar = document.getElementById('node-action-bar');
    if (!actionBar || !node) return;
    actionBar.innerHTML = node.actions.map((action) => renderBrowserNodeAction(node.id, action)).join('');
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

  var cpBlCurrentFilter = 'active';

  function switchBacklogFilter(key, btn) {
    cpBlCurrentFilter = key;
    document.querySelectorAll('.filter-pill').forEach(function(p) { p.classList.remove('active'); });
    if (btn) btn.classList.add('active');
    cpLoadBacklogTab(key);
  }

  function cpLoadBacklogTab(status) {
    fetch('/api/backlog?status=' + encodeURIComponent(status), { cache: 'no-store' })
      .then(function(r) { return r.json(); })
      .then(function(payload) {
        var list = document.getElementById('cp-bl-list');
        if (!list) return;
        var items = payload.items || [];
        var counts = payload.counts || {};
        ['active','snoozed','resolved'].forEach(function(k) {
          var el = document.getElementById('cp-bl-count-' + k);
          if (el && counts[k] !== undefined) el.textContent = String(counts[k]);
        });
        if (items.length === 0) {
          list.innerHTML = '<div class="muted" style="text-align:center;padding:24px">無此狀態的項目</div>';
          return;
        }
        list.innerHTML = items.map(function(item) {
          var sev = item.seenCount >= 8 || item.kind === 'bug_watch' || item.kind === 'bug_fix_candidate' ? 'high' : item.seenCount >= 4 ? 'med' : 'low';
          return '<div class="bl-item ' + sev + '">' +
            '<div class="bl-title">' + htmlEscape(item.title) + '</div>' +
            '<div class="bl-meta">出現 ' + item.seenCount + ' 次 · ' + htmlEscape(item.kind) + '</div>' +
            '<div class="bl-actions">' +
            '<button class="bl-btn" onclick="cpSnoozeItem(\\'' + htmlEscape(item.id) + '\\', this)">暫緩 7d</button>' +
            '<button class="bl-btn" onclick="cpDismissItem(\\'' + htmlEscape(item.id) + '\\', this)">略過</button>' +
            '</div></div>';
        }).join('');
      });
  }

  function cpSnoozeItem(id, btn) {
    fetch('/api/backlog/' + encodeURIComponent(id) + '/snooze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ days: 7 }) })
      .then(function() { btn.closest('.bl-item').style.opacity = '0.3'; btn.disabled = true; setTimeout(function() { cpLoadBacklogTab(cpBlCurrentFilter); }, 800); });
  }

  function cpDismissItem(id, btn) {
    fetch('/api/backlog/' + encodeURIComponent(id) + '/dismiss', { method: 'POST' })
      .then(function() { btn.closest('.bl-item').style.opacity = '0.3'; btn.disabled = true; setTimeout(function() { cpLoadBacklogTab(cpBlCurrentFilter); }, 800); });
  }

  cpLoadBacklogTab('active');
</script>
</body>
</html>`
}

export function renderBrainTab(loopState: ObservationLoopState, graph?: IdeaGraph, deliberationState?: DeliberationState): string {
  const isExcited = loopState.excitementMode === 'excited'
  const isCooling = loopState.excitementMode === 'cooling'
  const isDim = !isExcited && !isCooling

  const modeText = isExcited ? '⚡ EXCITED' : isCooling ? '🌡 COOLING' : '😴 STANDBY'
  const intervalSec = Math.round((loopState.currentIntervalMs ?? loopState.intervalMs) / 1000)
  const intervalLabel = intervalSec >= 60 ? `${Math.round(intervalSec / 60)}m` : `${intervalSec}s`
  const nextLabel = loopState.nextRunAt
    ? `next cycle: ${formatCountdown(loopState.nextRunAt)}`
    : `every ${intervalLabel}`

  const score = loopState.lastExcitementScore ?? 0
  const runCount = loopState.runCount

  return `
<div class="cp-card${isDim ? ' dim' : ''}">
  <div class="sys-label">/// Neural Status</div>
  <div class="brain-mode${isDim ? ' dim' : ''}">${escapeHtml(modeText)}</div>
  <div class="brain-sub${isDim ? ' dim' : ''}">${escapeHtml(nextLabel)}</div>
  <div class="stats-row">
    <div class="stat-box">
      <div class="stat-label">INTERVAL</div>
      <div class="stat-val${isDim ? ' dim' : ''}">${escapeHtml(intervalLabel)}</div>
    </div>
    <div class="stat-box">
      <div class="stat-label">SCORE</div>
      <div class="stat-val${isDim ? ' dim' : ''}">+${score}</div>
    </div>
    <div class="stat-box">
      <div class="stat-label">RUNS</div>
      <div class="stat-val${isDim ? ' dim' : ''}">${runCount}</div>
    </div>
  </div>
  ${renderBrainSeedsBox(loopState)}
</div>
${renderBrainFocus(graph)}
${renderBrainSignals(loopState)}
${deliberationState ? renderDeliberationCard(deliberationState) : ''}
${renderFrozenVaultPanel()}
${deliberationState ? `<script>
function triggerDeliberation(){var btn=document.getElementById('deliberation-btn'),status=document.getElementById('deliberation-status');if(!btn||btn.disabled)return;btn.disabled=true;btn.textContent='⏳ 辯論進行中…';if(status)status.textContent='辯論進行中，每 3 秒更新…';fetch('/api/deliberation',{method:'POST'}).then(function(r){if(r.status===409){if(status)status.textContent='已有辯論在進行中，請稍候';pollDeliberation();}else if(r.status===202){pollDeliberation();}else{if(status)status.textContent='啟動失敗：'+r.status;btn.disabled=false;btn.textContent='⚡ 強制思考';}}).catch(function(e){if(status)status.textContent='啟動失敗：'+String(e);btn.disabled=false;btn.textContent='⚡ 強制思考';});}
function pollDeliberation(){setTimeout(function(){fetch('/api/deliberation/latest',{cache:'no-store'}).then(function(r){return r.json();}).then(function(d){updateDeliberationUI(d);}).catch(function(){pollDeliberation();});},3000);}
function pollBoost(nodeId, button){setTimeout(function(){fetch('/api/idea/'+encodeURIComponent(nodeId)+'/boost-status',{cache:'no-store'}).then(function(r){return r.json();}).then(function(d){if(d.status==='running'){pollBoost(nodeId,button);}else{location.reload();}}).catch(function(){pollBoost(nodeId,button);});},3000);}
function updateDeliberationUI(d){var btn=document.getElementById('deliberation-btn'),status=document.getElementById('deliberation-status');if(d.status==='running'){if(btn){btn.disabled=true;btn.textContent='⏳ 辯論進行中…';}if(status)status.textContent='辯論進行中，每 3 秒更新…';pollDeliberation();}else{if(btn){btn.disabled=false;btn.textContent='⚡ 強制思考';}if(status)status.textContent='';location.reload();}}
function loadFrozenVault(){var panel=document.getElementById('frozen-vault-list');if(!panel)return;panel.textContent='讀取中…';fetch('/api/idea/archived',{cache:'no-store'}).then(function(r){return r.json();}).then(function(rows){var chip=document.getElementById('frozen-vault-chip-count');if(chip)chip.textContent=String(rows.length);if(rows.length===0){panel.innerHTML='<p class="muted">沒有冷凍的想法。</p>';return;}var html='';for(var i=0;i<rows.length;i++){var n=rows[i];var keywords=Array.isArray(n.keywords)?n.keywords.map(function(k){return '<span class="pill">'+k.replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</span>';}).join(''):'';var when=n.archivedAt?new Date(n.archivedAt).toLocaleString('zh-Hant-TW',{timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'';var seen=typeof n.seenCount==='number'?'　觀察 '+n.seenCount+' 次':'';html+='<div class="vault-row" data-id="'+encodeURIComponent(n.id)+'"><strong>🧊 '+String(n.title).replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</strong><div class="kw-strip">'+keywords+'</div><div class="muted">冷凍於 '+when+seen+'</div><div class="vault-actions"><button type="button" class="secondary vault-unarchive" data-id="'+encodeURIComponent(n.id)+'">🔥 解凍</button><button type="button" class="secondary vault-delete" data-id="'+encodeURIComponent(n.id)+'">🗑 永久刪除</button></div></div>';}panel.innerHTML=html;}).catch(function(){panel.textContent='讀取失敗。';});}
function toggleFrozenVault(){var panel=document.getElementById('frozen-vault-panel');if(!panel)return;var hidden=panel.hidden;panel.hidden=!hidden;if(hidden)loadFrozenVault();}
document.addEventListener('click',function(ev){var t=ev.target;if(!(t instanceof HTMLElement))return;if(t.closest('#frozen-vault-chip')){ev.preventDefault();toggleFrozenVault();return;}var un=t.closest('.vault-unarchive');if(un){ev.preventDefault();var id=un.getAttribute('data-id');un.disabled=true;un.textContent='解凍中…';fetch('/api/idea/'+id+'/unarchive',{method:'POST'}).then(function(r){if(r.ok){var row=un.closest('.vault-row');if(row)row.remove();location.reload();}else{un.textContent='解凍失敗';}});return;}var del=t.closest('.vault-delete');if(del){ev.preventDefault();var did=del.getAttribute('data-id');if(!confirm('永久刪除這個想法？不會再回到冷凍庫。'))return;del.disabled=true;del.textContent='刪除中…';fetch('/api/idea/'+did,{method:'DELETE'}).then(function(r){if(r.ok){var row=del.closest('.vault-row');if(row)row.remove();loadFrozenVault();}else{del.textContent='刪除失敗';}});return;}});
loadFrozenVault();
${deliberationState.status === 'running' ? 'pollDeliberation();' : ''}
</script>` : ''}`
}

function renderFrozenVaultPanel(): string {
  return `
<div class="cp-card">
  <div class="sys-label">/// Frozen Vault</div>
  <button type="button" id="frozen-vault-chip" class="vault-chip">❄ 冷凍庫 (<span id="frozen-vault-chip-count">0</span>)</button>
  <section id="frozen-vault-panel" hidden style="margin-top:12px">
    <div id="frozen-vault-list"><p class="muted">讀取中…</p></div>
  </section>
</div>`
}

function renderDeliberationCard(state: DeliberationState): string {
  const isRunning = state.status === 'running'
  const btnLabel = isRunning ? '⏳ 辯論進行中…' : '⚡ 強制思考'
  const btnDisabled = isRunning ? ' disabled' : ''

  let resultHtml = ''
  if (state.record) {
    const { record } = state
    const personasHtml = record.personas.map((p) => `<span class="persona-chip">${escapeHtml(p.name)}</span>`).join('')
    const round0 = record.rounds[0] ?? []
    const insightsHtml = round0
      .flatMap((pr) => pr.keyInsights.slice(0, 2).map((ins) => `<div class="deliberation-insight">▸ [${escapeHtml(pr.persona.name)}] ${escapeHtml(ins)}</div>`))
      .join('')
    const { synthesis } = record
    const consensusHtml = synthesis.consensusPoints
      .map((p) => `<div style="font-size:10px;color:rgba(0,255,255,0.6);margin-bottom:2px">✓ ${escapeHtml(p)}</div>`)
      .join('')
    const blindspotsHtml = synthesis.blindspotsFound
      .map((b) => `<div style="font-size:10px;color:var(--pink);margin-bottom:2px">⚠ ${escapeHtml(b)}</div>`)
      .join('')
    const finishedAt = record.finishedAt ? formatTaipeiTime(record.finishedAt) : '—'
    resultHtml = `
<div class="synthesis-box">
  <div class="sys-label" style="margin-bottom:6px">/// 最近一次辯論 · ${escapeHtml(finishedAt)}</div>
  <div style="margin-bottom:6px">${personasHtml}</div>
  ${insightsHtml ? `<div class="deliberation-round">${insightsHtml}</div>` : ''}
  <div style="font-size:11px;color:rgba(255,255,255,0.7);margin-bottom:6px">${escapeHtml(synthesis.summary)}</div>
  ${consensusHtml}
  ${blindspotsHtml}
  ${synthesis.seedsInjected > 0 ? `<div style="margin-top:6px;font-size:10px;color:var(--accent)">▶ ${synthesis.seedsInjected} ideas 已注入圖</div>` : ''}
</div>`
  }

  return `
<div class="cp-card" style="margin-top:8px" id="deliberation-section">
  <div class="sys-label" style="margin-bottom:8px">/// 分身辯論引擎</div>
  <button class="deliberation-btn" id="deliberation-btn" onclick="triggerDeliberation()"${btnDisabled}>${escapeHtml(btnLabel)}</button>
  <div id="deliberation-status" style="margin-top:6px;font-size:10px;color:var(--muted)">${isRunning ? '辯論進行中，每 3 秒更新…' : ''}</div>
  ${resultHtml}
</div>`
}

function renderBrainSeedsBox(loopState: ObservationLoopState): string {
  const lastAt = loopState.lastReflectionAt
    ? formatTaipeiTime(loopState.lastReflectionAt)
    : '—'
  return `
<div class="seeds-box">
  <div class="sys-label" style="margin-bottom:4px">/// Last Reflection · ${escapeHtml(lastAt)}</div>
  <div id="brain-seeds-placeholder" class="muted" style="font-size:11px">
    ${loopState.lastReflectionAt ? '反思已完成，查看圖 Tab 看最新 ideas' : '尚未執行反思'}
  </div>
</div>`
}

function renderBrainFocus(graph?: IdeaGraph): string {
  if (!graph || !graph.focus?.headline) return ''
  const centerNode = graph.nodes.find((n) => n.id === graph.centerNodeId)
  const interesting = graph.nodes.filter((n) => n.interesting && !n.archived && !n.ignored)
  return `
<div class="cp-card" style="margin-top:8px">
  <div class="sys-label">/// 分身焦點</div>
  <div style="font-size:12px;color:var(--accent);margin:6px 0 2px;font-weight:700">${escapeHtml(graph.focus.headline)}</div>
  <div style="font-size:11px;color:rgba(0,255,255,0.55);line-height:1.5">${escapeHtml(graph.focus.nextThought)}</div>
  ${centerNode ? `<div style="margin-top:8px;font-size:10px;color:rgba(255,255,255,0.35)">CENTER · ${escapeHtml(centerNode.title)}</div>` : ''}
  ${interesting.length > 0 ? `
  <div class="sys-label" style="margin-top:10px;margin-bottom:4px">/// 有趣節點 (${interesting.length})</div>
  ${interesting.slice(0, 3).map((n) => `<div style="font-size:11px;color:var(--pink);margin-bottom:3px">★ ${escapeHtml(n.title)}</div>`).join('')}` : ''}
</div>`
}

function renderBrainSignals(loopState: ObservationLoopState): string {
  const lastRun = loopState.lastFinishedAt
  if (!lastRun) return `<div class="muted" style="margin-top:8px;font-size:11px">尚未執行任何 cycle</div>`
  return `
<div>
  <div class="sys-label" style="margin: 10px 0 6px">/// System</div>
  <div class="signal-list">
    <div class="signal-item">
      <span>🔄</span>
      <span class="signal-text">上次完成</span>
      <span class="signal-time">${escapeHtml(formatTaipeiTime(lastRun))}</span>
    </div>
    ${loopState.lastSuccess === false && loopState.lastError ? `
    <div class="signal-item" style="border-color:rgba(239,68,68,0.3)">
      <span>⚠</span>
      <span class="signal-text" style="color:#ef4444">${escapeHtml(loopState.lastError.slice(0, 60))}</span>
    </div>` : ''}
  </div>
</div>`
}

function formatCountdown(isoString: string): string {
  const diff = new Date(isoString).getTime() - Date.now()
  if (diff <= 0) return 'now'
  const sec = Math.round(diff / 1000)
  if (sec < 60) return `${sec}s`
  return `${Math.round(sec / 60)}m`
}

function renderBacklogTab(backlog: BacklogPanelData): string {
  return `
<div>
  <div class="filter-pills">
    <button class="filter-pill active" onclick="switchBacklogFilter('active',this)">● 活躍 <span id="cp-bl-count-active">${backlog.counts.active}</span></button>
    <button class="filter-pill" onclick="switchBacklogFilter('snoozed',this)">暫緩 <span id="cp-bl-count-snoozed">${backlog.counts.snoozed}</span></button>
    <button class="filter-pill" onclick="switchBacklogFilter('resolved',this)">完成 <span id="cp-bl-count-resolved">${backlog.counts.resolved}</span></button>
  </div>
  <div id="cp-bl-list"></div>
</div>`
}

function renderCpBacklogItem(item: BacklogItem): string {
  const severity = item.seenCount >= 8 || item.kind === 'bug_watch' || item.kind === 'bug_fix_candidate' ? 'high'
    : item.seenCount >= 4 ? 'med' : 'low'
  return `
<div class="bl-item ${severity}">
  <div class="bl-title">${escapeHtml(item.title)}</div>
  <div class="bl-meta">出現 ${item.seenCount} 次 · ${escapeHtml(item.kind)}</div>
  <div class="bl-actions">
    <button class="bl-btn" onclick="cpSnoozeItem('${escapeHtml(item.id)}', this)">暫緩 7d</button>
    <button class="bl-btn" onclick="cpDismissItem('${escapeHtml(item.id)}', this)">略過</button>
  </div>
</div>`
}

function renderGraphTab(graph: IdeaGraph, loopState: ObservationLoopState): string {
  const firstNode = graph.nodes.find((node) => node.id === graph.centerNodeId) ?? graph.nodes[0]
  return `
<div class="cy-container" data-center-node="${escapeHtml(graph.centerNodeId ?? '')}"></div>
<div class="node-drawer" id="node-drawer" style="display:${firstNode ? 'block' : 'none'}">
  <div class="sys-label">/// SELECTED NODE</div>
  <div id="node-drawer-content">
    ${firstNode ? `<div style="color:var(--accent);font-weight:bold;margin-bottom:4px">${escapeHtml(firstNode.title)}</div><div class="muted" style="font-size:10px">${graph.edges.filter((e) => e.from === firstNode.id || e.to === firstNode.id).length} 個關聯</div>` : ''}
  </div>
</div>
<script id="graph-data" type="application/json">${jsonForScript(graph)}</script>
<script id="loop-data" type="application/json">${jsonForScript({ lastGraphAt: loopState.lastGraphAt ?? '', lastReportAt: loopState.lastReportAt ?? '' })}</script>
<script>
(function() {
  if (typeof cytoscape === 'undefined') {
    document.querySelectorAll('.cy-container:not([data-cy-init])').forEach(function(c) { c.textContent = '圖形載入失敗，請檢查網路'; });
    return;
  }
  var graphDataEl = document.getElementById('graph-data');
  if (!graphDataEl) return;
  var graph;
  try { graph = JSON.parse(graphDataEl.textContent || '{}'); } catch { return; }
  if (!graph || !Array.isArray(graph.nodes)) return;

  function truncateLabel(str, max) {
    return str && str.length > max ? str.slice(0, max - 1) + '\\u2026' : (str || '');
  }

  function toElements(g) {
    var els = [];
    var cid = g.centerNodeId;
    var compact = window.matchMedia && window.matchMedia('(max-width: 520px)').matches;
    (g.nodes || []).forEach(function(node) {
      els.push({ data: {
        id: node.id,
        label: truncateLabel(node.title, node.id === cid ? (compact ? 22 : 12) : (compact ? 18 : 8)),
        interesting: node.interesting ? true : undefined,
        ignored: (node.ignored || node.archived) ? true : undefined,
        isCenter: node.id === cid ? true : undefined,
      }});
    });
    (g.edges || []).forEach(function(edge) {
      els.push({ data: {
        id: edge.from + '--' + edge.to,
        source: edge.from,
        target: edge.to,
        confidence: edge.confidence,
        rationale: edge.rationale || '',
      }});
    });
    return els;
  }

  function getCyStyle() {
    var compact = window.matchMedia && window.matchMedia('(max-width: 520px)').matches;
    return [
      { selector: 'node', style: {
        'background-color': 'rgba(5,5,5,0.9)', 'border-color': 'rgba(0,255,255,0.5)',
        'border-width': 1.5, 'color': 'rgba(0,255,255,0.8)', 'label': 'data(label)',
        'font-family': 'Courier New, monospace', 'font-size': compact ? 8 : 10,
        'text-valign': 'center', 'text-halign': 'center',
        'width': compact ? 72 : 40, 'height': compact ? 48 : 40, 'text-wrap': 'wrap', 'text-max-width': compact ? 66 : 36, 'shape': 'round-rectangle',
      }},
      { selector: 'node[?interesting]', style: {
        'border-color': 'rgba(255,0,255,0.7)', 'color': 'rgba(255,0,255,0.95)', 'border-width': 2.5,
      }},
      { selector: 'node[?isCenter]', style: {
        'width': compact ? 96 : 56, 'height': compact ? 62 : 56, 'border-color': 'rgba(0,255,255,0.9)',
        'color': 'rgba(0,255,255,1)', 'font-size': compact ? 11 : 12, 'font-weight': 'bold', 'border-width': 2.5,
      }},
      { selector: 'node[?ignored]', style: {
        'opacity': 0.35, 'border-color': 'rgba(100,100,100,0.4)', 'color': 'rgba(150,150,150,0.6)',
      }},
      { selector: 'node.cy-selected', style: { 'border-color': 'rgba(251,191,36,0.85)', 'border-width': 2.5 }},
      { selector: 'edge', style: {
        'line-color': 'rgba(0,255,255,0.18)', 'width': 0.8, 'curve-style': 'bezier',
        'line-style': 'dashed', 'line-dash-pattern': [4, 3], 'target-arrow-shape': 'none',
      }},
      { selector: 'edge[confidence = "strong"]', style: {
        'line-color': 'rgba(0,255,255,0.5)', 'width': 1.2, 'line-style': 'solid',
      }},
    ];
  }

  function debounce(fn, delay) {
    var timer;
    return function() { clearTimeout(timer); timer = setTimeout(fn, delay); };
  }

  window._cyInstances = window._cyInstances || [];
  window._cyToElements = toElements;
  window._cyGetStyle = getCyStyle;

  function fitCy(cy) {
    if (!cy || cy.destroyed()) return;
    var compact = window.matchMedia && window.matchMedia('(max-width: 520px)').matches;
    cy.fit(cy.elements(), compact ? 24 : 56);
    cy.minZoom(compact ? 0.25 : 0.15);
  }
  window._cyFitGraph = fitCy;

  function initContainer(container, savedPositions) {
    container.setAttribute('data-cy-init', '1');
    var hasSaved = Object.keys(savedPositions).length > 0 &&
      (graph.nodes || []).every(function(n) { return savedPositions[n.id]; });
    var layoutConfig = hasSaved
      ? { name: 'preset', positions: function(node) { return savedPositions[node.id()]; } }
      : { name: 'cose', animate: false, randomize: false,
          nodeRepulsion: function() { return 9000; },
          idealEdgeLength: function() { return (window.matchMedia && window.matchMedia('(max-width: 520px)').matches) ? 110 : 120; },
          gravity: 0.4, numIter: 1000 };

    var cy = cytoscape({
      container: container,
      elements: toElements(graph),
      style: getCyStyle(),
      layout: layoutConfig,
      minZoom: 0.15, maxZoom: 4, wheelSensitivity: 0.3, boxSelectionEnabled: false,
    });
    window._cyInstances.push(cy);

    var savePositions = debounce(function() {
      var positions = {};
      cy.nodes().forEach(function(node) { positions[node.id()] = node.position(); });
      fetch('/api/graph/positions', { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ positions: positions }) });
    }, 800);

    cy.ready(function() { setTimeout(function() { fitCy(cy); }, 50); });
    cy.on('layoutstop', function() { fitCy(cy); savePositions(); });
    cy.on('dragfree', 'node', savePositions);
    window.addEventListener('resize', debounce(function() { fitCy(cy); cy.style(getCyStyle()); }, 150));

    cy.on('tap', 'node', function(event) {
      var nodeId = event.target.id();
      window._cyInstances.forEach(function(inst) { inst.nodes().removeClass('cy-selected'); });
      event.target.addClass('cy-selected');
      var drawer = document.getElementById('node-drawer');
      var drawerContent = document.getElementById('node-drawer-content');
      if (drawer) drawer.style.display = 'block';
      if (drawerContent) drawerContent.textContent = '載入中…';
      fetch('/api/graph/nodes/' + encodeURIComponent(nodeId))
        .then(function(r) { return r.json(); })
        .then(function(data) { renderNodeDrawer(data); })
        .catch(function() { if (drawerContent) drawerContent.textContent = '載入失敗'; });
    });

    cy.on('tap', function(event) {
      if (event.target === cy) {
        window._cyInstances.forEach(function(inst) { inst.nodes().removeClass('cy-selected'); });
        var drawer = document.getElementById('node-drawer');
        if (drawer) drawer.style.display = 'none';
      }
    });
  }

  function initAllContainers(savedPositions) {
    document.querySelectorAll('.cy-container:not([data-cy-init])').forEach(function(container) {
      initContainer(container, savedPositions);
    });
  }

  fetch('/api/graph/positions')
    .then(function(r) { return r.json(); })
    .then(function(data) { initAllContainers((data && data.positions) ? data.positions : {}); })
    .catch(function() { initAllContainers({}); });
})();

function refreshCyGraph() {
  fetch('/api/graph', { cache: 'no-store' })
    .then(function(r) { return r.json(); })
    .then(function(graph) {
      var graphDataEl = document.getElementById('graph-data');
      if (graphDataEl) graphDataEl.textContent = JSON.stringify(graph).replaceAll('<', '\\u003c').replaceAll('&', '\\u0026');
      var toEls = window._cyToElements;
      var getStyle = window._cyGetStyle;
      var fitGraph = window._cyFitGraph;
      if (!toEls || !getStyle) return;
      (window._cyInstances || []).forEach(function(cy) {
        cy.json({ elements: toEls(graph) });
        cy.style(getStyle());
        if (fitGraph) fitGraph(cy);
      });
    })
    .catch(function() {});
}
</script>`
}

function renderIdeaTab(ideas: IdeaRecord[]): string {
  const recent = ideas.slice(0, 8)
  return `
<div>
  <div class="sys-label" style="margin-bottom:8px">/// Input to Neural</div>
  <textarea class="idea-textarea" id="idea-input" placeholder="輸入想法，分身會整理…" rows="5"></textarea>
  <button class="transmit-btn" id="idea-submit">[ TRANSMIT ]</button>
  <div id="idea-result" class="muted" style="margin-top:6px;font-size:11px"></div>

  <div class="sys-label" style="margin:12px 0 6px">/// Recent Ideas</div>
  ${recent.length === 0 ? '<div class="muted" style="font-size:11px">尚無想法</div>' : recent.map(renderCpIdeaItem).join('')}
</div>

<script>
(function() {
  var btn = document.getElementById('idea-submit');
  if (!btn) return;
  btn.addEventListener('click', function() {
    var text = document.getElementById('idea-input').value.trim();
    if (!text) return;
    btn.disabled = true;
    btn.textContent = '[ TRANSMITTING... ]';
    fetch('/api/ideas', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ rawText: text }) })
      .then(function(r) { return r.json(); })
      .then(function() {
        document.getElementById('idea-result').textContent = '✓ 已送出';
        document.getElementById('idea-input').value = '';
        btn.textContent = '[ TRANSMIT ]';
        btn.disabled = false;
      })
      .catch(function() {
        document.getElementById('idea-result').textContent = '✗ 送出失敗';
        btn.textContent = '[ TRANSMIT ]';
        btn.disabled = false;
      });
  });
})();
</script>`
}

function renderCpIdeaItem(idea: IdeaRecord): string {
  return `
<div class="idea-item">
  <span class="idea-name">${escapeHtml(idea.title ?? idea.rawText.slice(0, 40))}</span>
  <span class="idea-status">${escapeHtml(idea.classification)}</span>
</div>`
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
        <div class="node-actions node-action-bar" id="node-action-bar">
          ${firstNode ? firstNode.actions.map((action) => renderNodeAction(firstNode.id, action)).join('') : ''}
        </div>
        <div class="eyebrow" id="node-current-eyebrow">分身現在在想</div>
        <h2 id="node-current-title">${escapeHtml(firstNode?.title ?? 'Kevin Autopilot')}</h2>
        <p class="muted focus-hint" id="focus-hint" hidden></p>
        <p class="thought-line" id="node-understanding">${escapeHtml(firstNode?.thinking.understanding ?? graph.focus.headline)}</p>
        <div class="status-strip">
          <div class="status-item"><span class="label">背景</span><strong>${loopState.running ? '觀察中' : loopState.enabled ? '5 分鐘自動' : '手動'}</strong></div>
          <div class="status-item"><span class="label">節點</span><strong>${graph.nodes.length}</strong></div>
          <div class="status-item"><span class="label">關聯</span><strong>${graph.edges.length}</strong></div>
        </div>
        <p class="muted">${escapeHtml(renderLoopPlainStatus(loopState))}</p>
        <p class="muted" id="reflection-status">讀取分身反思狀態中...</p>
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
  const primaryActions = node.actions.filter((action) => action.id === 'boost' || action.id === 'deliberate' || action.id === 'archive')
  const secondaryActions = node.actions.filter((action) => action.id === 'extend' || action.id === 'find-relationships' || action.id === 'mark-interesting' || action.id === 'copy-opencode-prompt')
  return `<div class="node-action-bar primary">
    ${primaryActions.map((action) => renderNodeAction(node.id, action)).join('')}
  </div>
  <div class="recommendation">
    <strong>${escapeHtml(node.title)}</strong>
    <div>${escapeHtml(node.summary)}</div>
    <div class="kw-strip">${node.keywords.length === 0 ? '<span class="muted">尚未抽到關鍵字</span>' : node.keywords.map((keyword) => `<span class="pill">${escapeHtml(keyword)}</span>`).join('')}</div>
  </div>
  <div class="trace-note">
    <strong>💭 分身怎麼想這個</strong>
    <div>${escapeHtml(node.thinking.understanding)}</div>
    <div class="muted">為什麼有關：${escapeHtml(node.thinking.whyItMatters)}</div>
    <div class="muted">下一步：${escapeHtml(node.thinking.nextExploration)}</div>
  </div>
  <div class="recommendation">
    <strong>❓ 分身正在問</strong>
    <ul class="radar-signals">${(node.thinking.questions?.length ? node.thinking.questions : ['這個想法真正想解決的問題是什麼？']).slice(0, 3).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
  </div>
  <div>
    <strong>🔗 相連節點</strong>
    ${connected.length === 0 ? '<p class="muted">目前沒有相連節點。</p>' : `<div class="kw-strip">${connected.map((item) => `<span class="pill">${escapeHtml(item.title)}</span>`).join('')}</div>`}
  </div>
  <div>
    <strong>📎 證據</strong>
    ${node.thinking.evidence.length === 0 ? '<p class="muted">目前沒有證據。</p>' : `<ul class="radar-signals">${node.thinking.evidence.slice(0, 4).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`}
  </div>
  <div>
    <strong>🕳 缺的證據</strong>
    ${node.thinking.missingEvidence.length === 0 ? '<p class="muted">目前沒有明確缺口。</p>' : `<ul class="radar-signals">${node.thinking.missingEvidence.slice(0, 4).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`}
  </div>
  <details class="detail-collapse">
    <summary></summary>
    <div class="detail-meta">
      ${escapeHtml(node.type)} · ${escapeHtml(node.confidence)} · ${escapeHtml(node.source)}<br>
      建立：${escapeHtml(formatTaipeiTime(node.createdAt))}　最近：${escapeHtml(formatTaipeiTime(node.updatedAt))}${typeof node.seenCount === 'number' ? `　觀察 ${node.seenCount} 次` : ''}
    </div>
    <div class="detail-actions">
      ${secondaryActions.map((action) => renderNodeAction(node.id, action)).join('')}
    </div>
    ${node.prompt ? `<details><summary>OpenCode prompt</summary><button type="button" class="secondary copy-prompt">複製 Prompt</button><span class="copy-status" aria-live="polite"></span><pre>${escapeHtml(node.prompt)}</pre></details>` : ''}
  </details>`
}

function renderNodeAction(nodeId: string, action: IdeaGraphNode['actions'][number]): string {
  if (action.enabled) {
    return `<button type="button" class="secondary node-action" data-action="${escapeHtml(action.id)}" data-node-id="${escapeHtml(nodeId)}">${escapeHtml(action.label)}</button>`
  }
  return `<span class="node-action-disabled" title="${escapeHtml(action.description)}">${escapeHtml(action.label)}<small>${escapeHtml(nodeActionDisabledReason(action.id))}</small></span>`
}

function nodeActionDisabledReason(actionId: IdeaGraphNode['actions'][number]['id']): string {
  if (actionId === 'boost') return '中心節點不可深化'
  if (actionId === 'deliberate') return '中心節點不能當辯論主軸'
  if (actionId === 'archive') return '中心節點不可冷凍'
  if (actionId === 'extend') return '任務節點已經是 handoff prompt'
  if (actionId === 'copy-opencode-prompt') return '這個節點沒有 prompt'
  if (actionId === 'find-relationships') return '任務節點不再展開關聯'
  if (actionId === 'mark-interesting') return '已保留給分身'
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

function renderSettingsPage(config: AutopilotConfig, keyStatus: KeyStatusSummary, runtimeOverrides: RuntimeOverrides, effectiveConfig: AutopilotConfig): string {
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
    textarea, input[type="number"] { width: 100%; box-sizing: border-box; border-radius: 14px; border: 1px solid rgba(148,163,184,0.28); background: rgba(15,23,42,0.86); color: #e5eefc; padding: 14px; font: inherit; font-size: 16px; line-height: 1.5; }
    textarea { min-height: 160px; resize: vertical; }
    label { display: inline-flex; gap: 8px; align-items: center; color: #cbd5e1; margin-top: 10px; font-size: 14px; }
    input[type="checkbox"] { width: 16px; height: 16px; }
    a.button, button { display: inline-block; text-decoration: none; margin-top: 10px; border: 0; border-radius: 999px; background: #60a5fa; color: #06111f; font-weight: 700; padding: 10px 16px; cursor: pointer; }
    button.secondary { background: rgba(148,163,184,0.2); color: #e5eefc; margin-left: 8px; }
    .override-grid { display: grid; gap: 12px; }
    .override-field { border: 1px solid rgba(148,163,184,0.18); border-radius: 14px; padding: 12px; background: rgba(15,23,42,0.38); }
    .override-head { display: flex; gap: 10px; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; }
    .override-status { border-radius: 999px; padding: 4px 8px; font-size: 12px; background: rgba(148,163,184,0.18); color: #cbd5e1; }
    .override-status.overridden { background: rgba(96,165,250,0.22); color: #bfdbfe; }
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
  ${renderRuntimeOverridesSection(config, runtimeOverrides, effectiveConfig)}
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

  const runtimeFieldPaths = ${safeJson(Object.keys(RUNTIME_OVERRIDE_SCHEMA))};
  const runtimeSchema = ${safeJson(RUNTIME_OVERRIDE_SCHEMA)};
  let runtimeState = ${safeJson({ overrides: runtimeOverrides, effective: flattenRuntimeConfig(effectiveConfig), fileConfig: flattenRuntimeConfig(config) })};

  function runtimeControlId(path) { return 'runtime-' + path.replace(/\./g, '-'); }
  function runtimeStatusId(path) { return runtimeControlId(path) + '-status'; }
  function runtimeDefaultId(path) { return runtimeControlId(path) + '-default'; }
  function getOverrideValue(overrides, path) {
    const parts = path.split('.');
    return overrides && overrides[parts[0]] ? overrides[parts[0]][parts[1]] : undefined;
  }
  function updateRuntimeSection(data) {
    runtimeState = data;
    for (const path of runtimeFieldPaths) {
      const schema = runtimeSchema[path];
      const input = document.getElementById(runtimeControlId(path));
      const status = document.getElementById(runtimeStatusId(path));
      const defaults = document.getElementById(runtimeDefaultId(path));
      const overrideValue = getOverrideValue(data.overrides, path);
      const effectiveValue = data.effective[path];
      if (schema.type === 'boolean') input.checked = effectiveValue === true;
      else input.value = effectiveValue ?? '';
      status.textContent = overrideValue === undefined ? '預設' : '已覆蓋';
      status.className = 'override-status' + (overrideValue === undefined ? '' : ' overridden');
      defaults.textContent = 'File config: ' + String(data.fileConfig[path] ?? 'unset') + ' · Effective: ' + String(effectiveValue ?? 'unset');
    }
  }
  document.getElementById('runtime-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const result = document.getElementById('runtime-result');
    const body = {};
    for (const path of runtimeFieldPaths) {
      const schema = runtimeSchema[path];
      const input = document.getElementById(runtimeControlId(path));
      const parts = path.split('.');
      const value = schema.type === 'boolean' ? input.checked : (input.value === '' ? null : Number(input.value));
      if (value !== null && value === runtimeState.fileConfig[path]) continue;
      body[parts[0]] = body[parts[0]] || {};
      body[parts[0]][parts[1]] = value;
    }
    result.textContent = '儲存 Runtime Overrides 中...';
    const response = await fetch('/api/runtime-overrides', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      result.textContent = await response.text();
      return;
    }
    const data = await response.json();
    updateRuntimeSection(data);
    result.textContent = '已儲存；下一輪 observation cycle 會讀取 effective config。';
  });
  document.querySelectorAll('[data-runtime-reset]').forEach((button) => {
    button.addEventListener('click', async () => {
      const path = button.getAttribute('data-runtime-reset');
      const parts = path.split('.');
      const body = { [parts[0]]: { [parts[1]]: null } };
      const result = document.getElementById('runtime-result');
      result.textContent = '重設 override 中...';
      const response = await fetch('/api/runtime-overrides', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        result.textContent = await response.text();
        return;
      }
      const data = await response.json();
      updateRuntimeSection(data);
      result.textContent = '已重設為 file config 預設值。';
    });
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

function renderCapabilityBrief(loopState: ObservationLoopState): string {
  const cadence = loopState.running ? '正在觀察中' : loopState.enabled ? `每 ${Math.round(loopState.intervalMs / 60_000)} 分鐘自動看一次` : '目前是手動模式'
  return `<section class="capability-rail">
    <div class="eyebrow">分身現在能做什麼</div>
    <h2 class="mission-title">它不是自動改 code；它幫你把下一個可交給 OpenCode 的動作整理出來</h2>
    <p class="muted">目前狀態：${escapeHtml(cadence)}。時間都用 GMT+8 顯示；所有動作維持 read-only，除非你明確交給 OpenCode 或另外批准。</p>
    <div class="capability-grid">
      <div class="capability-card"><strong>1. 自己巡 HomeProject</strong><div class="muted">看 repo/service/backlog/idea graph，抓重複出現的問題、卡住的想法、可能值得補證據的方向。</div></div>
      <div class="capability-card"><strong>2. 長出想法節點</strong><div class="muted">把你丟的想法、public-web research、AI reflection seed 接到腦圖，不替你排序重要性。</div></div>
      <div class="capability-card"><strong>3. 產生 bounded prompt</strong><div class="muted">每個候選或節點可以複製 OpenCode prompt，讓另一個 agent 做 read-only 調查或安全實作。</div></div>
      <div class="capability-card"><strong>4. 等你修正判斷</strong><div class="muted">你可以在下方補充「這輪哪裡判錯」，下一輪會把它納入觀察，不需要重啟服務。</div></div>
    </div>
  </section>`
}

function renderRuntimeOverridesSection(config: AutopilotConfig, overrides: RuntimeOverrides, effectiveConfig: AutopilotConfig): string {
  const fileValues = flattenRuntimeConfig(config)
  const effectiveValues = flattenRuntimeConfig(effectiveConfig)
  return `<section>
    <h2>Runtime Overrides</h2>
    <p class="muted">只允許 OpenSpec 白名單裡的安全欄位。設定會寫入 Autopilot-owned <code>data/runtime-overrides.json</code>，不會改 config JSON、repo、service、rule source 或 key storage。</p>
    <form id="runtime-form">
      <div class="override-grid">
        ${Object.entries(RUNTIME_OVERRIDE_SCHEMA).map(([path, schema]) => renderRuntimeOverrideField(path, schema, getRuntimeOverrideValue(overrides, path), fileValues[path], effectiveValues[path])).join('')}
      </div>
      <button type="submit">儲存 Runtime Overrides</button>
    </form>
    <div id="runtime-result" class="muted"></div>
  </section>`
}

function renderRuntimeOverrideField(path: string, schema: (typeof RUNTIME_OVERRIDE_SCHEMA)[string], overrideValue: boolean | number | undefined, fileValue: boolean | number | undefined, effectiveValue: boolean | number | undefined): string {
  const id = `runtime-${path.replace(/\./g, '-')}`
  const statusClass = overrideValue === undefined ? 'override-status' : 'override-status overridden'
  const control = schema.type === 'boolean'
    ? `<label><input id="${id}" type="checkbox" ${effectiveValue === true ? 'checked' : ''}>啟用</label>`
    : `<input id="${id}" type="number" min="${schema.min}" max="${schema.max}" step="1" value="${escapeHtml(String(effectiveValue ?? ''))}">`
  return `<div class="override-field">
    <div class="override-head">
      <div>
        <strong>${escapeHtml(schema.label)}</strong>
        <div class="muted"><code>${escapeHtml(path)}</code></div>
      </div>
      <span id="${id}-status" class="${statusClass}">${overrideValue === undefined ? '預設' : '已覆蓋'}</span>
    </div>
    <p class="muted">${escapeHtml(schema.description)}</p>
    ${control}
    <div id="${id}-default" class="muted">File config: ${escapeHtml(String(fileValue ?? 'unset'))} · Effective: ${escapeHtml(String(effectiveValue ?? 'unset'))}</div>
    <button class="secondary" type="button" data-runtime-reset="${escapeHtml(path)}">Reset to default</button>
  </div>`
}

function getRuntimeOverrideValue(overrides: RuntimeOverrides, path: string): boolean | number | undefined {
  const [group, field] = path.split('.') as [keyof RuntimeOverrides, string]
  const bucket = overrides[group] as Record<string, boolean | number | undefined> | undefined
  return bucket?.[field]
}

function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/<\//g, '<\\/')
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
  const isAi = idea.aiSource === 'ai-reflection'
  const aiBadge = isAi ? '<span class="pill ai-pill">AI 生</span>' : ''
  const evidenceLine = isAi && idea.aiReflection && idea.aiReflection.evidence.length > 0
    ? `<div class="idea-meta">AI 證據：${escapeHtml(idea.aiReflection.evidence.slice(0, 3).join(' · '))}</div>`
    : ''
  const dismissButton = isAi
    ? `<button type="button" class="secondary dismiss-ai-idea" data-id="${escapeHtml(idea.id)}" onclick="event.stopPropagation(); event.preventDefault();">永久略過</button>`
    : ''
  return `<a class="idea" id="idea-card-${escapeHtml(idea.id)}" href="/ideas/${escapeHtml(idea.id)}">
    <div>
      <span class="idea-icon">${escapeHtml(ideaIcon(idea))}</span>
      <div class="idea-meta">${escapeHtml(formatTaipeiTime(idea.createdAt))}</div>
    </div>
    <div>
      <div class="idea-title">${escapeHtml(idea.title)}</div>
      <div class="idea-meta">分身狀態：${escapeHtml(ideaStatus(idea))}</div>
      <div class="muted">${escapeHtml(projectAnalysis.summary)}</div>
      ${evidenceLine}
    </div>
    <div class="idea-status">
      ${aiBadge}
      <span class="pill">${escapeHtml(idea.classification)}</span>
      <span class="pill ${idea.approvalRequired ? 'warn' : 'ok'}">${idea.approvalRequired ? '需要 approval' : '可先探索'}</span>
      <div class="idea-meta">${escapeHtml(idea.thinking.mode)}${handoff ? ` · ${escapeHtml(handoff.decision)}` : ''}</div>
      ${projectHandoff ? `<div class="idea-meta">Handoff: ${escapeHtml(projectHandoff.repoName)} · ${escapeHtml(projectHandoff.firstArtifact)}</div>` : ''}
      ${dismissButton}
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
