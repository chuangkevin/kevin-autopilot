import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { GeminiClient, KeyPool } from '@kevinsisi/ai-core'
import { FileKeyStorageAdapter, hasGeminiKeys } from './keys.js'
import type {
  AutopilotConfig,
  BacklogItem,
  IdeaGraphConfidence,
  IdeaGraphEdge,
  IdeaGraphEdgeType,
  IdeaGraphNode,
  IdeaGraphThinkingSummary,
  IdeaRecord,
  ObservationReport,
} from './types.js'

const GRAPH_FILE = 'idea-graph.json'
const DEFAULT_TIMEOUT_MS = 30_000
const MAX_OUTPUT_TOKENS = 800
const MAX_NEW_EDGES = 3
const VALID_EDGE_TYPES: ReadonlySet<IdeaGraphEdgeType> = new Set([
  'contains_keyword',
  'resembles_project',
  'extends',
  'integrates_with',
  'needs_evidence',
  'can_research',
  'can_become_task',
  'observed_in',
])

const inFlight = new Set<string>()

export function isBoostRunning(nodeId: string): boolean {
  return inFlight.has(nodeId)
}

/** For testing only — directly set the lock state for a node. */
export function _setBoostRunning(nodeId: string, running: boolean): void {
  if (running) inFlight.add(nodeId)
  else inFlight.delete(nodeId)
}

interface StoredIdeaGraph {
  nodes: IdeaGraphNode[]
  edges: IdeaGraphEdge[]
}

interface EnrichmentResult {
  thinking: IdeaGraphThinkingSummary
  edgeCandidates: Array<{ to: string; type: IdeaGraphEdgeType; rationale: string; confidence: IdeaGraphConfidence }>
}

/**
 * Single-node enrichment: rewrites node.thinking via Gemini and proposes up to MAX_NEW_EDGES new edges.
 * Mutates the persisted graph; the caller does not need to save.
 * Releases the per-node lock in finally.
 */
export async function runBoost(
  config: AutopilotConfig,
  nodeId: string,
  report: ObservationReport,
  _ideas: IdeaRecord[],
  backlog: BacklogItem[],
): Promise<void> {
  if (inFlight.has(nodeId)) {
    throw new Error(`boost already running for ${nodeId}`)
  }
  inFlight.add(nodeId)
  try {
    const stored = await loadStoredGraph(config)
    const node = stored.nodes.find((item) => item.id === nodeId)
    if (!node) {
      throw new Error(`boost: node ${nodeId} not found`)
    }
    const neighbours = collectNeighbours(stored, nodeId)
    const result = await enrichNode(config, node, neighbours, report, backlog)
    const now = new Date().toISOString()
    const validIds = new Set(stored.nodes.map((item) => item.id))
    const accepted = result.edgeCandidates
      .filter((edge) => edge.to !== nodeId && validIds.has(edge.to))
      .slice(0, MAX_NEW_EDGES)
    const newEdges: IdeaGraphEdge[] = accepted.map((edge) => ({
      id: `${edge.type}-boost-${safeId(nodeId)}-${safeId(edge.to)}-${now.slice(11, 19).replace(/:/g, '')}`,
      type: edge.type,
      from: nodeId,
      to: edge.to,
      rationale: edge.rationale.slice(0, 160),
      confidence: edge.confidence,
      source: 'boost',
      createdAt: now,
      updatedAt: now,
    }))
    const nextGraph: StoredIdeaGraph = {
      nodes: stored.nodes.map((item) => item.id === nodeId
        ? {
            ...item,
            thinking: result.thinking,
            updatedAt: now,
            seenCount: (item.seenCount ?? 0) + 1,
            lastSeenAt: now,
          }
        : item),
      edges: dedupeEdges([...stored.edges, ...newEdges]),
    }
    await saveStoredGraph(config, nextGraph)
  } finally {
    inFlight.delete(nodeId)
  }
}

/**
 * Pure enrichment step exposed for the deliberation engine's anchor step 0.
 * Does not touch the persistence layer or the lock map.
 */
export async function enrichNode(
  config: AutopilotConfig,
  node: IdeaGraphNode,
  neighbours: IdeaGraphNode[],
  report: ObservationReport,
  backlog: BacklogItem[],
): Promise<EnrichmentResult> {
  const snapshot = buildBoostSnapshot(node, neighbours, report, backlog)
  const text = await callGemini(
    config,
    '你是 Kevin Autopilot 的單點深化引擎。針對一個 idea graph 節點，重寫它的 thinking 並提出最多 3 條到既有節點的新關聯。' +
      '只輸出 minified JSON，不要 Markdown，不要說明文字。' +
      '不得提議 deployment、生產環境操作、讀 secrets 或刪資料；僅做觀察、聯想、整理。',
    JSON.stringify({
      task: 'enrich this graph node',
      node: { id: node.id, title: node.title, type: node.type, summary: node.summary, keywords: node.keywords, currentThinking: node.thinking },
      neighbours: neighbours.map((n) => ({ id: n.id, title: n.title, type: n.type, summary: n.summary })),
      context: snapshot,
      outputSchema: {
        thinking: {
          understanding: 'string ≤ 200 chars',
          whyItMatters: 'string ≤ 200 chars',
          nextExploration: 'string ≤ 200 chars',
          questions: ['string ≤ 80 chars, max 3'],
          evidence: ['string ≤ 120 chars, max 4'],
          missingEvidence: ['string ≤ 120 chars, max 4'],
        },
        edgeCandidates: [
          {
            to: 'existing node id from neighbours or wider graph',
            type: 'one of contains_keyword | resembles_project | extends | integrates_with | needs_evidence | can_research | can_become_task | observed_in',
            rationale: 'string ≤ 160 chars',
            confidence: 'weak | medium | strong',
          },
        ],
      },
    }),
  )
  const parsed = JSON.parse(extractJson(text)) as Record<string, unknown>
  const thinkingObj = (parsed.thinking ?? {}) as Record<string, unknown>
  const thinking: IdeaGraphThinkingSummary = {
    understanding: stringOr(thinkingObj.understanding, node.thinking.understanding, 200),
    whyItMatters: stringOr(thinkingObj.whyItMatters, node.thinking.whyItMatters, 200),
    nextExploration: stringOr(thinkingObj.nextExploration, node.thinking.nextExploration, 200),
    questions: parseStringArray(thinkingObj.questions, 80, 3),
    evidence: parseStringArray(thinkingObj.evidence, 120, 4),
    missingEvidence: parseStringArray(thinkingObj.missingEvidence, 120, 4),
  }
  const rawEdges = Array.isArray(parsed.edgeCandidates) ? parsed.edgeCandidates : []
  const edgeCandidates: EnrichmentResult['edgeCandidates'] = []
  for (const raw of rawEdges) {
    if (!raw || typeof raw !== 'object') continue
    const obj = raw as Record<string, unknown>
    const to = typeof obj.to === 'string' ? obj.to.trim() : ''
    const type = typeof obj.type === 'string' ? obj.type.trim() : ''
    const rationale = typeof obj.rationale === 'string' ? obj.rationale.trim() : ''
    const confidence = typeof obj.confidence === 'string' ? obj.confidence.trim() : 'weak'
    if (!to || !VALID_EDGE_TYPES.has(type as IdeaGraphEdgeType)) continue
    if (!rationale) continue
    const conf: IdeaGraphConfidence = confidence === 'strong' || confidence === 'medium' ? confidence : 'weak'
    edgeCandidates.push({ to, type: type as IdeaGraphEdgeType, rationale, confidence: conf })
  }
  return { thinking, edgeCandidates }
}

function collectNeighbours(graph: StoredIdeaGraph, nodeId: string): IdeaGraphNode[] {
  const neighbourIds = new Set<string>()
  for (const edge of graph.edges) {
    if (edge.from === nodeId) neighbourIds.add(edge.to)
    if (edge.to === nodeId) neighbourIds.add(edge.from)
  }
  return graph.nodes.filter((node) => neighbourIds.has(node.id) && node.archived !== true).slice(0, 8)
}

function buildBoostSnapshot(node: IdeaGraphNode, neighbours: IdeaGraphNode[], report: ObservationReport, backlog: BacklogItem[]): string {
  return JSON.stringify({
    environment: report.environment,
    targetNode: { id: node.id, title: node.title, type: node.type, summary: node.summary, keywords: node.keywords },
    neighbourCount: neighbours.length,
    mainAgentRecommendation: report.mainAgent.recommendation,
    activeBacklog: backlog.filter((b) => b.status === 'active').slice(0, 4).map((b) => ({ title: b.title, kind: b.kind })),
  })
}

function dedupeEdges(edges: IdeaGraphEdge[]): IdeaGraphEdge[] {
  const seen = new Map<string, IdeaGraphEdge>()
  for (const edge of edges) seen.set(edge.id, edge)
  return [...seen.values()]
}

async function callGemini(config: AutopilotConfig, systemInstruction: string, prompt: string): Promise<string> {
  if (!config.ai?.enabled || config.ai.provider !== 'gemini') {
    throw new Error('boost: AI not configured')
  }
  if (!(await hasGeminiKeys(config))) {
    throw new Error('boost: no Gemini key available')
  }
  const client = new GeminiClient(new KeyPool(new FileKeyStorageAdapter(config)), { maxRetries: 2 })
  const response = await withTimeout(
    client.generateContent({
      model: config.ai.model,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      systemInstruction,
      prompt,
    }),
    config.ai.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  )
  return response.text
}

async function loadStoredGraph(config: AutopilotConfig): Promise<StoredIdeaGraph> {
  try {
    const parsed = JSON.parse(await readFile(join(config.dataDir, GRAPH_FILE), 'utf8')) as Partial<StoredIdeaGraph>
    return {
      nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
      edges: Array.isArray(parsed.edges) ? parsed.edges : [],
    }
  } catch {
    return { nodes: [], edges: [] }
  }
}

async function saveStoredGraph(config: AutopilotConfig, graph: StoredIdeaGraph): Promise<void> {
  await mkdir(config.dataDir, { recursive: true })
  await writeFile(join(config.dataDir, GRAPH_FILE), `${JSON.stringify(graph, null, 2)}\n`, 'utf8')
}

function safeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'node'
}

function parseStringArray(value: unknown, maxLen: number, maxCount: number): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((s): s is string => typeof s === 'string')
    .map((s) => s.trim().slice(0, maxLen))
    .filter((s) => s.length > 0)
    .slice(0, maxCount)
}

function stringOr(value: unknown, fallback: string, maxLen: number): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim().slice(0, maxLen)
  return trimmed.length > 0 ? trimmed : fallback
}

function extractJson(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fenced?.[1]) return fenced[1].trim()
  if (trimmed.startsWith('{')) return trimmed
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1)
  throw new Error('boost: AI response did not contain JSON')
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`boost: AI call timed out after ${timeoutMs}ms`)), timeoutMs)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer)
  }
}
