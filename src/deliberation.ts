import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { GeminiClient, KeyPool } from '@kevinsisi/ai-core'
import { FileKeyStorageAdapter, hasGeminiKeys } from './keys.js'
import { createAiIdeaFromSeed } from './ideas.js'
import type {
  AutopilotConfig,
  BacklogItem,
  DeliberationPersona,
  DeliberationRecord,
  DeliberationSynthesis,
  IdeaGraph,
  ObservationReport,
  PersonaRound,
  ReflectionIdeaSeed,
} from './types.js'

const DELIBERATIONS_DIR = 'deliberations'
const MAX_RECORDS = 10
const MAX_PERSONAS = 4
const MIN_PERSONAS = 2
const DEBATE_ROUNDS = 2
const MAX_SEEDS = 3
const DEFAULT_TIMEOUT_MS = 30_000
const MAX_OUTPUT_TOKENS = 800

let deliberationInFlight = false

export function isDeliberationRunning(): boolean {
  return deliberationInFlight
}

/** For testing only — directly set the deliberation in-flight flag. */
export function _setDeliberationRunning(value: boolean): void {
  deliberationInFlight = value
}

export async function runDeliberation(
  config: AutopilotConfig,
  report: ObservationReport,
  graph: IdeaGraph,
  backlog: BacklogItem[],
): Promise<DeliberationRecord> {
  deliberationInFlight = true
  const startedAt = new Date().toISOString()
  const id = startedAt.slice(0, 19).replace(/:/g, '-').replace('T', '-')

  try {
    const personas = await pickRoles(config, report, graph)

    const round0 = await runIndependentAnalysis(config, personas, report, graph, backlog)
    const allRounds: PersonaRound[][] = [round0]

    for (let i = 1; i <= DEBATE_ROUNDS; i++) {
      if (round0.length < 2) break
      const debateRound = await runDebateRound(config, round0, allRounds, i)
      allRounds.push(debateRound)
    }

    const synthesis = await runSynthesis(config, allRounds)

    const model = config.ai?.model ?? 'unknown'
    let seedsInjected = 0
    for (let i = 0; i < synthesis.seeds.length; i++) {
      try {
        await createAiIdeaFromSeed(config, synthesis.seeds[i], { generatedAt: startedAt, model }, i)
        seedsInjected++
      } catch (error) {
        console.warn('deliberation: failed to inject seed:', error instanceof Error ? error.message : String(error))
      }
    }

    const record: DeliberationRecord = {
      id,
      startedAt,
      finishedAt: new Date().toISOString(),
      environment: config.environment,
      personas,
      rounds: allRounds,
      synthesis: { ...synthesis, seedsInjected },
      model,
      tokenUsage: { input: 0, output: 0 },
    }

    await persistDeliberation(config, record)
    return record
  } finally {
    deliberationInFlight = false
  }
}

async function pickRoles(
  config: AutopilotConfig,
  report: ObservationReport,
  graph: IdeaGraph,
): Promise<DeliberationPersona[]> {
  const snapshot = buildProjectSnapshot(report, graph)
  const payload = {
    task: 'Pick 2-4 distinct analytical personas for a multi-agent deliberation about this project.',
    projectSnapshot: snapshot,
    outputSchema: {
      personas: [{ name: 'string ≤ 30 chars', perspective: 'string ≤ 120 chars, unique analytical lens' }],
    },
  }

  const text = await callGemini(
    config,
    '你是辯論協調員。根據目前專案狀態，選出 2-4 個各具獨特分析視角的分身角色。' +
      '每個角色必須有不同的觀察角度（例如：技術債審計師、使用者體驗觀察者、執行風險評估師、策略機會探索者）。' +
      '只輸出 minified JSON，不要 Markdown，不要說明文字。',
    JSON.stringify(payload),
  )

  const parsed = JSON.parse(extractJson(text)) as { personas?: unknown[] }
  const raw = Array.isArray(parsed.personas) ? parsed.personas : []
  const personas: DeliberationPersona[] = []
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue
    const obj = p as Record<string, unknown>
    const name = typeof obj.name === 'string' ? obj.name.trim().slice(0, 30) : ''
    const perspective = typeof obj.perspective === 'string' ? obj.perspective.trim().slice(0, 120) : ''
    if (!name || !perspective) continue
    personas.push({ name, perspective })
    if (personas.length >= MAX_PERSONAS) break
  }

  if (personas.length < MIN_PERSONAS) {
    throw new Error(`Role picker returned ${personas.length} personas (min ${MIN_PERSONAS})`)
  }
  return personas
}

async function runIndependentAnalysis(
  config: AutopilotConfig,
  personas: DeliberationPersona[],
  report: ObservationReport,
  graph: IdeaGraph,
  backlog: BacklogItem[],
): Promise<PersonaRound[]> {
  const snapshot = buildFullSnapshot(report, graph, backlog)
  const results = await Promise.allSettled(
    personas.map((persona) => analyzeAsPersona(config, persona, snapshot, [], 0)),
  )
  return results
    .map((r, i) => {
      if (r.status === 'fulfilled') return r.value
      console.warn(`deliberation: persona "${personas[i]?.name}" failed round 0:`, r.reason instanceof Error ? r.reason.message : String(r.reason))
      return null
    })
    .filter((r): r is PersonaRound => r !== null)
}

async function runDebateRound(
  config: AutopilotConfig,
  survivors: PersonaRound[],
  priorRounds: PersonaRound[][],
  roundIndex: number,
): Promise<PersonaRound[]> {
  if (survivors.length < 2) return []
  const results = await Promise.allSettled(
    survivors.map((pr) => analyzeAsPersona(config, pr.persona, null, priorRounds, roundIndex)),
  )
  return results
    .map((r, i) => {
      if (r.status === 'fulfilled') return r.value
      console.warn(`deliberation: persona "${survivors[i]?.persona.name}" failed round ${roundIndex}:`, r.reason instanceof Error ? r.reason.message : String(r.reason))
      return null
    })
    .filter((r): r is PersonaRound => r !== null)
}

async function analyzeAsPersona(
  config: AutopilotConfig,
  persona: DeliberationPersona,
  snapshot: string | null,
  priorRounds: PersonaRound[][],
  round: number,
): Promise<PersonaRound> {
  const isDebateRound = round > 0
  const context = isDebateRound
    ? `以下是前幾輪所有分身的分析：\n${JSON.stringify(priorRounds)}`
    : `以下是目前專案快照：\n${snapshot}`

  const payload = {
    persona: persona.name,
    perspective: persona.perspective,
    round,
    context,
    outputSchema: {
      analysis: 'string ≤ 300 chars',
      keyInsights: ['string ≤ 80 chars, max 3'],
      challenges: ['string ≤ 80 chars, max 3, specific challenges to other perspectives or blind spots'],
    },
  }

  const systemInstruction = isDebateRound
    ? `你是「${persona.name}」。你的分析視角：${persona.perspective}。` +
      `這是第 ${round} 輪辯論，你能看到其他分身的觀點。針對他人的盲點提出具體挑戰，也可以補充支持某些觀點。` +
      '只輸出 minified JSON，不要 Markdown，不要說明文字。'
    : `你是「${persona.name}」。你的分析視角：${persona.perspective}。` +
      '獨立分析目前專案快照，從你的視角找出最重要的洞察和潛在盲點。' +
      '只輸出 minified JSON，不要 Markdown，不要說明文字。'

  const text = await callGemini(config, systemInstruction, JSON.stringify(payload))
  const parsed = JSON.parse(extractJson(text)) as Record<string, unknown>

  return {
    persona,
    round,
    analysis: typeof parsed.analysis === 'string' ? parsed.analysis.slice(0, 300) : '',
    keyInsights: parseStringArray(parsed.keyInsights, 80, 3),
    challenges: parseStringArray(parsed.challenges, 80, 3),
  }
}

async function runSynthesis(config: AutopilotConfig, allRounds: PersonaRound[][]): Promise<DeliberationSynthesis> {
  const payload = {
    task: '合成所有分身的辯論輸出，找出共識、盲點，並產出最多 3 個高品質 idea seed。',
    allRounds: JSON.stringify(allRounds),
    outputSchema: {
      summary: 'string ≤ 300 chars',
      consensusPoints: ['string ≤ 80 chars, max 3'],
      blindspotsFound: ['string ≤ 80 chars, max 3'],
      seeds: [
        {
          title: 'string ≤ 48 chars',
          rawText: 'string ≤ 160 chars',
          evidence: ['1-2 persona names or insight references'],
          approvalRequired: 'boolean',
        },
      ],
    },
  }

  const text = await callGemini(
    config,
    '你是辯論合成引擎。讀取所有分身的辯論輸出，整合成一份摘要：找出共識、辯論後發現的盲點，並提出最多 3 個值得後續探索的 idea seed。' +
      '只輸出 minified JSON，不要 Markdown，不要說明文字。' +
      '不得提議 deployment、生產環境操作、讀 secrets 或刪資料；如有此類建議必須將 approvalRequired 設 true。',
    JSON.stringify(payload),
  )

  const parsed = JSON.parse(extractJson(text)) as Record<string, unknown>

  const rawSeeds: unknown[] = Array.isArray(parsed.seeds) ? parsed.seeds : []
  const seeds: ReflectionIdeaSeed[] = []
  for (const s of rawSeeds) {
    if (seeds.length >= MAX_SEEDS) break
    if (!s || typeof s !== 'object') continue
    const obj = s as Record<string, unknown>
    const title = typeof obj.title === 'string' ? obj.title.trim().slice(0, 48) : ''
    const rawText = typeof obj.rawText === 'string' ? obj.rawText.trim().slice(0, 160) : ''
    const evidence = parseStringArray(obj.evidence, 200, 2)
    if (!title || !rawText || evidence.length === 0) continue
    seeds.push({ title, rawText, evidence, approvalRequired: Boolean(obj.approvalRequired) })
  }

  return {
    summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 300) : '',
    consensusPoints: parseStringArray(parsed.consensusPoints, 80, 3),
    blindspotsFound: parseStringArray(parsed.blindspotsFound, 80, 3),
    seeds,
    seedsInjected: 0,
  }
}

export async function persistDeliberation(config: AutopilotConfig, record: DeliberationRecord): Promise<void> {
  const dir = join(config.dataDir, DELIBERATIONS_DIR)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `${record.id}.json`), `${JSON.stringify(record, null, 2)}\n`, 'utf8')

  const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort()
  const excess = files.length - MAX_RECORDS
  for (let i = 0; i < excess; i++) {
    try { await unlink(join(dir, files[i]!)) } catch {}
  }
}

export async function loadLatestDeliberation(config: AutopilotConfig): Promise<DeliberationRecord | null> {
  const dir = join(config.dataDir, DELIBERATIONS_DIR)
  let files: string[]
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort()
  } catch {
    return null
  }
  if (files.length === 0) return null
  try {
    const text = await readFile(join(dir, files[files.length - 1]!), 'utf8')
    return JSON.parse(text) as DeliberationRecord
  } catch {
    return null
  }
}

async function callGemini(config: AutopilotConfig, systemInstruction: string, prompt: string): Promise<string> {
  if (!config.ai?.enabled || config.ai.provider !== 'gemini') {
    throw new Error('deliberation: AI not configured')
  }
  if (!(await hasGeminiKeys(config))) {
    throw new Error('deliberation: no Gemini key available')
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

function buildProjectSnapshot(report: ObservationReport, graph: IdeaGraph): string {
  return JSON.stringify({
    environment: report.environment,
    repositories: report.repositories.map((r) => ({ name: r.name, branch: r.branch, dirty: r.dirty, recentCommits: r.recentCommits.slice(0, 3) })),
    services: report.services.map((s) => ({ name: s.name, healthStatus: s.healthStatus })),
    candidates: report.candidates.slice(0, 6).map((c) => ({ title: c.title, category: c.category, confidence: c.confidence })),
    graphNodes: graph.nodes.slice(0, 12).map((n) => ({ title: n.title, type: n.type, interesting: n.interesting })),
    graphFocus: graph.focus,
  })
}

function buildFullSnapshot(report: ObservationReport, graph: IdeaGraph, backlog: BacklogItem[]): string {
  return JSON.stringify({
    ...JSON.parse(buildProjectSnapshot(report, graph)),
    backlog: backlog.filter((b) => b.status === 'active').slice(0, 6).map((b) => ({ title: b.title, kind: b.kind, seenCount: b.seenCount })),
  })
}

function parseStringArray(value: unknown, maxLen: number, maxCount: number): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((s): s is string => typeof s === 'string')
    .map((s) => s.trim().slice(0, maxLen))
    .filter((s) => s.length > 0)
    .slice(0, maxCount)
}

function extractJson(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fenced?.[1]) return fenced[1].trim()
  if (trimmed.startsWith('{')) return trimmed
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1)
  throw new Error('deliberation: AI response did not contain JSON')
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`deliberation: AI call timed out after ${timeoutMs}ms`)), timeoutMs)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer)
  }
}
