import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AutopilotConfig } from './types.js'

const WEB_RESEARCH_FILE = 'web-research.json'
const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const DEFAULT_TIMEOUT_MS = 8_000
const DEFAULT_MAX_QUERIES = 2

export interface WebResearchSeed {
  id: string
  nodeId: string
  title: string
  keywords: string[]
}

export interface WebResearchFinding {
  id: string
  seedId: string
  seedNodeId: string
  query: string
  title: string
  summary: string
  url?: string
  sourceName: string
  fetchedAt: string
  keywords: string[]
}

interface StoredWebResearch {
  findings: WebResearchFinding[]
}

interface DuckDuckGoTopic {
  Text?: string
  FirstURL?: string
  Name?: string
  Topics?: DuckDuckGoTopic[]
}

interface DuckDuckGoResponse {
  Heading?: string
  AbstractText?: string
  AbstractURL?: string
  RelatedTopics?: DuckDuckGoTopic[]
}

export async function refreshWebResearch(config: AutopilotConfig, seeds: WebResearchSeed[]): Promise<WebResearchFinding[]> {
  const stored = await loadStoredWebResearch(config)
  if (config.webResearch?.enabled !== true) return []

  const ttlMs = config.webResearch.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS
  const maxQueries = config.webResearch.maxQueriesPerGraph ?? DEFAULT_MAX_QUERIES
  const timeoutMs = config.webResearch.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const now = new Date()
  const nextFindings = [...stored.findings]
  let queried = 0

  for (const seed of seeds) {
    const query = makeQuery(seed)
    const cached = nextFindings.find((finding) => finding.seedId === seed.id && finding.query === query)
    if (cached && now.getTime() - Date.parse(cached.fetchedAt) < ttlMs) continue
    if (queried >= maxQueries) break
    queried += 1
    const fresh = await fetchDuckDuckGoFinding(seed, query, timeoutMs, now)
    if (!fresh) continue
    const existingIndex = nextFindings.findIndex((finding) => finding.seedId === fresh.seedId && finding.query === fresh.query)
    if (existingIndex >= 0) nextFindings[existingIndex] = fresh
    else nextFindings.push(fresh)
  }

  const findings = nextFindings
    .sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt))
    .slice(0, 40)
  await saveStoredWebResearch(config, { findings })
  return findings
}

async function fetchDuckDuckGoFinding(seed: WebResearchSeed, query: string, timeoutMs: number, now: Date): Promise<WebResearchFinding | undefined> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
    const response = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'kevin-autopilot/0.9 read-only research' },
      signal: controller.signal,
    })
    if (!response.ok) return undefined
    const parsed = await response.json() as DuckDuckGoResponse
    const topic = firstRelatedTopic(parsed.RelatedTopics ?? [])
    const title = parsed.Heading || topic?.Name || topic?.Text?.split(' - ')[0] || `網路搜尋：${query}`
    const summary = parsed.AbstractText || topic?.Text || '公開搜尋沒有回傳可摘要的結果；保留這個查詢作為待研究線索。'
    const resultUrl = parsed.AbstractURL || topic?.FirstURL
    return {
      id: `web-${safeId(`${seed.id}-${query}`)}`,
      seedId: seed.id,
      seedNodeId: seed.nodeId,
      query,
      title,
      summary,
      url: resultUrl,
      sourceName: 'DuckDuckGo Instant Answer',
      fetchedAt: now.toISOString(),
      keywords: [...new Set([...seed.keywords, ...extractWords(`${title} ${summary}`).slice(0, 4)])].slice(0, 8),
    }
  } catch {
    return undefined
  } finally {
    clearTimeout(timeout)
  }
}

function firstRelatedTopic(topics: DuckDuckGoTopic[]): DuckDuckGoTopic | undefined {
  for (const topic of topics) {
    if (topic.Text || topic.FirstURL) return topic
    const nested = firstRelatedTopic(topic.Topics ?? [])
    if (nested) return nested
  }
  return undefined
}

function makeQuery(seed: WebResearchSeed): string {
  return [seed.title, ...seed.keywords.slice(0, 3)].join(' ').trim()
}

function extractWords(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/https?:\/\//g, ' ')
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
}

async function loadStoredWebResearch(config: AutopilotConfig): Promise<StoredWebResearch> {
  try {
    const parsed = JSON.parse(await readFile(webResearchPath(config), 'utf8')) as Partial<StoredWebResearch>
    return { findings: Array.isArray(parsed.findings) ? parsed.findings : [] }
  } catch {
    return { findings: [] }
  }
}

async function saveStoredWebResearch(config: AutopilotConfig, research: StoredWebResearch): Promise<void> {
  await mkdir(config.dataDir, { recursive: true })
  await writeFile(webResearchPath(config), `${JSON.stringify(research, null, 2)}\n`, 'utf8')
}

function webResearchPath(config: AutopilotConfig): string {
  return join(config.dataDir, WEB_RESEARCH_FILE)
}

function safeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 96) || 'research'
}
