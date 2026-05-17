import { KeyPool } from '@kevinsisi/ai-core'
import { GoogleGenerativeAI, SchemaType, type GenerationConfig, type ResponseSchema } from '@google/generative-ai'
import { FileKeyStorageAdapter, hasGeminiKeys } from './keys.js'
import { stableHash6 } from './idea-graph.js'
import { buildPersonaPrefix } from './persona.js'
import { getReflectionSeedQualityRejection, isLowValueReflectionTopic } from './idea-quality.js'
import type {
  AiConfig,
  AiReflectionConfig,
  AutopilotConfig,
  BacklogItem,
  IdeaGraph,
  IdeaGraphNode,
  IdeaRecord,
  ReflectionIdeaSeed,
  ReflectionNextExploration,
  ReflectionRecord,
  ReflectionStateRecord,
  ReflectionTokenUsage,
  SkippedReflectionRecord,
  SkippedReflectionReason,
} from './types.js'

const DEFAULT_MAX_OUTPUT_TOKENS = 1200
const MIN_JSON_OUTPUT_TOKENS = 700
const DEFAULT_MAX_PENDING_AI_IDEAS = 5
const DEFAULT_TIMEOUT_MS = 25_000
const PROMPT_VERSION = 'v2'
const GEMINI_THINKING_BUDGET = 0

async function safeBuildPersonaPrefix(mode: 'reflection' | 'boost', config: AutopilotConfig): Promise<string> {
  try {
    return await buildPersonaPrefix(mode, config)
  } catch (error) {
    console.warn('reflection: persona prefix failed, using stub:', error instanceof Error ? error.message : String(error))
    return '你是 Kevin 的 AI 分身。\n—— 下面是這次任務 ——'
  }
}

const PROMPT_MAX_NODES = 18
const PROMPT_MAX_BACKLOG = 6
const PROMPT_MAX_IDEAS = 5
const PROMPT_MAX_DISMISSED_TITLES = 20

const SEED_CAP = 2
const REWRITE_CAP = 1
const SEED_TITLE_MAX = 48
const SEED_RAWTEXT_MAX = 160
const REWRITE_TEXT_MAX = 90
const EVIDENCE_MAX_LEN = 200

const REFLECTION_RESPONSE_SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    newIdeaSeeds: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          title: { type: SchemaType.STRING },
          rawText: { type: SchemaType.STRING },
          evidence: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING },
          },
          approvalRequired: { type: SchemaType.BOOLEAN },
        },
        required: ['title', 'rawText', 'evidence', 'approvalRequired'],
      },
    },
    nextExplorationRewrites: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          nodeId: { type: SchemaType.STRING },
          nextExploration: { type: SchemaType.STRING },
        },
        required: ['nodeId', 'nextExploration'],
      },
    },
  },
  required: ['newIdeaSeeds', 'nextExplorationRewrites'],
}

export interface ReflectionInput {
  config: AutopilotConfig
  graph: IdeaGraph
  backlog: BacklogItem[]
  recentIdeas: IdeaRecord[]
  focusedNodeId?: string
  previousSignature?: string
  dismissedAiIdeaTitles: string[]
  pendingAiIdeaCount: number
}

export function computeReflectionSignature(graph: IdeaGraph, backlog: BacklogItem[]): string {
  const nodeIds = [...graph.nodes.map((node) => node.id)].sort().join('|')
  const backlogPart = [...backlog]
    .map((item) => `${item.id}:${item.seenCount}:${item.lastSeenAt}`)
    .sort()
    .join('|')
  return stableHash6(`${nodeIds}::${backlogPart}`)
}

export function buildReflectionPromptInput(input: ReflectionInput, maxNewSeeds: number, signature: string): {
  payload: Record<string, unknown>
  knownNodeIds: Set<string>
  knownEvidenceIds: Set<string>
} {
  const promptSeedCap = Math.min(SEED_CAP, Math.max(0, maxNewSeeds))
  const knownNodeIds = new Set(input.graph.nodes.map((node) => node.id))
  const knownEvidenceIds = new Set([...knownNodeIds, ...input.backlog.map((item) => item.id)])
  const nodesSummary = [...input.graph.nodes]
    .slice(0, PROMPT_MAX_NODES)
    .map((node) => summariseNode(node))
  const focused = input.focusedNodeId
    ? input.graph.nodes.find((node) => node.id === input.focusedNodeId)
    : undefined
  const backlogSummary = [...input.backlog]
    .filter((item) => item.status === 'active' || !item.status)
    .slice(0, PROMPT_MAX_BACKLOG)
    .map((item) => ({
      id: item.id,
      kind: item.kind,
      title: item.title,
      summary: truncate(item.summary, 120),
      seenCount: item.seenCount,
    }))
  const ideasSummary = [...input.recentIdeas]
    .filter((idea) => !isLowValueReflectionTopic({ title: idea.title, rawText: idea.rawText }))
    .slice(0, PROMPT_MAX_IDEAS)
    .map((idea) => ({
      id: idea.id,
      title: idea.title,
      classification: idea.classification,
      aiSource: idea.aiSource ?? 'user',
    }))

  return {
    knownNodeIds,
    knownEvidenceIds,
    payload: {
      promptVersion: PROMPT_VERSION,
      task: 'Reflect on Kevin Autopilot\'s current graph. Output one-line minified JSON only: no Markdown, no code fences, no explanation. If seed slots are open, propose grounded read-only seeds about real external workflow pain instead of returning empty arrays or meta Autopilot work.',
      signature,
      caps: {
        maxNewIdeaSeeds: promptSeedCap,
        minNewIdeaSeeds: promptSeedCap > 0 ? 1 : 0,
        maxNextExplorationRewrites: REWRITE_CAP,
        seedTitleMaxChars: SEED_TITLE_MAX,
        seedRawTextMaxChars: SEED_RAWTEXT_MAX,
        rewriteTextMaxChars: REWRITE_TEXT_MAX,
      },
      pendingAiIdeaCount: input.pendingAiIdeaCount,
      knownNodeIds: [...knownNodeIds],
      focusedNode: focused ? summariseFocusedNode(focused) : null,
      graphNodes: nodesSummary,
      backlog: backlogSummary,
      recentIdeas: ideasSummary,
      dismissedAiIdeaTitles: input.dismissedAiIdeaTitles.slice(0, PROMPT_MAX_DISMISSED_TITLES),
      qualityGate: {
        required: [
          'A concrete person, role, domain tool, or operational artifact outside the Autopilot implementation',
          'A concrete workflow detail plus repeated manual work, fragile workaround, or real-world friction',
          'Read-only exploration that does not need repo/deploy/secret/API approval',
        ],
        rejectIf: [
          'Self-monitoring Kevin Autopilot, the double, moods, interaction patterns, prompt quality, or dashboard hygiene',
          'Internal engineering maintenance such as repo, CI, deploy, Docker, unit tests, branches, commits, or GitHub Actions when no external workflow detail is present',
          'No clear real person/tool/artifact, workflow detail, pain, or workaround',
        ],
        badExamples: [
          'Create a mood log of Kevin interactions',
          'Monitor double suggestions vs Kevin actual behavior',
          'Proactive Git status summaries',
        ],
        goodExamples: [
          'Car dealer LINE photo to listing workflow friction',
          'PM Figma spec to runnable UI prototype handoff',
          'Firefighter course/exam/questionnaire repetition',
          'CAD/Onshape design review or file handoff pain',
        ],
      },
      outputSchema: {
        newIdeaSeeds: [
          {
            title: 'string <= 48 chars',
            rawText: 'string <= 160 chars',
            evidence: ['1-2 known node ids or backlog ids only'],
            approvalRequired: 'boolean',
          },
        ],
        nextExplorationRewrites: [
          {
            nodeId: 'must be one of knownNodeIds',
            nextExploration: 'string <= 90 chars',
          },
        ],
      },
    },
  }
}

function summariseNode(node: IdeaGraphNode): Record<string, unknown> {
  return {
    id: node.id,
    type: node.type,
    title: node.title,
    source: node.source,
    confidence: node.confidence,
    keywords: node.keywords.slice(0, 3),
    summary: truncate(node.summary, 120),
  }
}

function summariseFocusedNode(node: IdeaGraphNode): Record<string, unknown> {
  return {
    id: node.id,
    type: node.type,
    title: node.title,
    keywords: node.keywords.slice(0, 6),
    thinking: {
      understanding: node.thinking.understanding,
      whyItMatters: node.thinking.whyItMatters,
      nextExploration: node.thinking.nextExploration,
      evidence: node.thinking.evidence.slice(0, 4),
      missingEvidence: node.thinking.missingEvidence.slice(0, 4),
    },
  }
}

function truncate(value: string, max: number): string {
  if (typeof value !== 'string') return ''
  if (value.length <= max) return value
  return `${value.slice(0, max - 1)}…`
}

export interface ParseReflectionOutputOptions {
  knownNodeIds: Set<string>
  knownEvidenceIds?: Set<string>
  maxNewSeeds: number
}

export function parseReflectionOutput(text: string, options: ParseReflectionOutputOptions): {
  newIdeaSeeds: ReflectionIdeaSeed[]
  nextExplorationRewrites: ReflectionNextExploration[]
} {
  const parsed = JSON.parse(extractJson(text)) as {
    newIdeaSeeds?: unknown
    nextExplorationRewrites?: unknown
  }

  const seedsRaw: unknown[] = Array.isArray(parsed.newIdeaSeeds) ? parsed.newIdeaSeeds : []
  const newIdeaSeeds: ReflectionIdeaSeed[] = []
  const seedCap = Math.min(SEED_CAP, Math.max(0, options.maxNewSeeds))
  const knownEvidenceIds = options.knownEvidenceIds ?? options.knownNodeIds
  for (const entry of seedsRaw) {
    if (newIdeaSeeds.length >= seedCap) break
    if (!entry || typeof entry !== 'object') continue
    const obj = entry as Record<string, unknown>
    const title = typeof obj.title === 'string' ? truncate(obj.title.trim(), SEED_TITLE_MAX) : ''
    const rawText = typeof obj.rawText === 'string' ? truncate(obj.rawText.trim(), SEED_RAWTEXT_MAX) : ''
    const approvalRequired = Boolean(obj.approvalRequired)
    const evidence = Array.isArray(obj.evidence)
      ? obj.evidence
        .filter((item): item is string => typeof item === 'string')
        .map((item) => truncate(item.trim(), EVIDENCE_MAX_LEN))
        .filter((item) => knownEvidenceIds.has(item))
        .filter((item) => item.length > 0)
        .slice(0, 4)
      : []
    if (!title || !rawText || evidence.length === 0) continue
    if (getReflectionSeedQualityRejection({ title, rawText, approvalRequired })) continue
    newIdeaSeeds.push({
      title,
      rawText,
      evidence,
      approvalRequired,
    })
  }

  const rewritesRaw: unknown[] = Array.isArray(parsed.nextExplorationRewrites)
    ? parsed.nextExplorationRewrites
    : []
  const nextExplorationRewrites: ReflectionNextExploration[] = []
  for (const entry of rewritesRaw) {
    if (nextExplorationRewrites.length >= REWRITE_CAP) break
    if (!entry || typeof entry !== 'object') continue
    const obj = entry as Record<string, unknown>
    const nodeId = typeof obj.nodeId === 'string' ? obj.nodeId : ''
    const nextExploration = typeof obj.nextExploration === 'string'
      ? truncate(obj.nextExploration.trim(), REWRITE_TEXT_MAX)
      : ''
    if (!nodeId || !nextExploration) continue
    if (!options.knownNodeIds.has(nodeId)) continue
    nextExplorationRewrites.push({ nodeId, nextExploration })
    if (nextExplorationRewrites.length >= REWRITE_CAP) break
  }

  return { newIdeaSeeds, nextExplorationRewrites }
}

function extractJson(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fenced?.[1]) return fenced[1].trim()
  if (trimmed.startsWith('{')) return trimmed
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1)
  throw new Error('AI reflection response did not contain JSON')
}

export async function reflect(input: ReflectionInput): Promise<ReflectionStateRecord> {
  const signature = computeReflectionSignature(input.graph, input.backlog)
  const reflectionConfig: AiReflectionConfig = input.config.aiReflection ?? {}
  const aiConfig: AiConfig | undefined = input.config.ai
  const cap = reflectionConfig.maxPendingAiIdeas ?? DEFAULT_MAX_PENDING_AI_IDEAS
  const maxNewSeeds = Math.max(0, cap - input.pendingAiIdeaCount)

  const baseSkip = (reason: SkippedReflectionReason, detail?: string): SkippedReflectionRecord => ({
    generatedAt: new Date().toISOString(),
    skipped: true,
    reason,
    promptVersion: PROMPT_VERSION,
    detail,
    graphSignature: signature,
    pendingAiIdeaCount: input.pendingAiIdeaCount,
  })

  if (reflectionConfig.enabled !== true) {
    return baseSkip('disabled', 'aiReflection.enabled is not true')
  }
  if (shouldSkipUnchangedReflection(input.previousSignature, signature, maxNewSeeds)) {
    return baseSkip('unchanged', 'Graph signature matches previous successful reflection')
  }
  if (!aiConfig?.enabled || aiConfig.provider !== 'gemini') {
    return baseSkip('disabled', 'config.ai is not enabled with the Gemini provider')
  }
  if (!(await hasGeminiKeys(input.config))) {
    return baseSkip('offline', 'No Gemini key available in the configured key pool')
  }

  const { payload, knownNodeIds, knownEvidenceIds } = buildReflectionPromptInput(input, maxNewSeeds, signature)
  const maxOutputTokens = resolveReflectionMaxOutputTokens(reflectionConfig)
  const timeoutMs = aiConfig.timeoutMs ?? DEFAULT_TIMEOUT_MS

  let text: string
  let usage: ReflectionTokenUsage | undefined
  try {
    const personaPrefix = await safeBuildPersonaPrefix('reflection', input.config)
    const reflectionInstruction =
      '你是 Kevin Autopilot 的分身反思引擎。讀取 Kevin Autopilot 的目前圖、backlog 與最近想法，依規格輸出 JSON。' +
      ' 只輸出 JSON，不要 Markdown，不要前後說明文字。' +
      ' 不得提議新建 repo、deployment、production、讀 secrets、刪資料、API contract change；遇到這類 idea 必須將 approvalRequired 設 true 並改寫成 read-only 觀察任務。' +
      ' 不要再次提出與 dismissedAiIdeaTitles 中標題語意相同的 idea。' +
      ' newIdeaSeeds 上限 2；若 caps.maxNewIdeaSeeds 大於 0，必須至少回 1 個 grounded read-only seed；只有 caps.maxNewIdeaSeeds 為 0 才能回 []。nextExplorationRewrites 上限 1。' +
      ' newIdeaSeeds 每筆都必須有 evidence 引用 knownNodeIds 或 backlog id，否則整筆會被丟掉。' +
      ' 垃圾 seed 會被丟掉：不要輸出分身/Autopilot 自我監控、mood/interaction pattern、prompt/dashboard hygiene、repo/CI/deploy/unit-test/commit 等純內部工程維護；只有在描述真實人物或外部工具/文件、具體工作流細節、痛點或手動 workaround 時，才能提到 CI/test/GitHub Actions 等詞。'
    const response = await generateStructuredGeminiReflection(input.config, {
      model: aiConfig.model,
      maxOutputTokens,
      systemInstruction: `${personaPrefix}\n${reflectionInstruction}`,
      prompt: JSON.stringify(payload),
      timeoutMs,
    })
    text = response.text
    usage = response.usage
  } catch (error) {
    return baseSkip('offline', error instanceof Error ? error.message : String(error))
  }

  let parsed: { newIdeaSeeds: ReflectionIdeaSeed[]; nextExplorationRewrites: ReflectionNextExploration[] }
  try {
    parsed = parseReflectionOutput(text, { knownNodeIds, knownEvidenceIds, maxNewSeeds })
  } catch (error) {
    return baseSkip('error', `Failed to parse AI reflection output: ${error instanceof Error ? error.message : String(error)}; providerStatus=success/no-http-status-exposed; usage=${formatUsage(usage)}; responseSnippet=${summarizeAiReflectionText(text)}`)
  }
  if (maxNewSeeds > 0 && parsed.newIdeaSeeds.length === 0) {
    return baseSkip('error', `AI reflection returned no valid idea seeds despite ${maxNewSeeds} open seed slot(s); usage=${formatUsage(usage)}; responseSnippet=${summarizeAiReflectionText(text)}`)
  }

  const record: ReflectionRecord = {
    generatedAt: new Date().toISOString(),
    model: aiConfig.model,
    promptVersion: PROMPT_VERSION,
    graphSignature: signature,
    skipped: false,
    newIdeaSeeds: parsed.newIdeaSeeds,
    nextExplorationRewrites: parsed.nextExplorationRewrites,
    pendingAiIdeaCount: input.pendingAiIdeaCount,
  }
  return record
}

export function shouldSkipUnchangedReflection(
  previousSignature: string | undefined,
  signature: string,
  maxNewSeeds: number,
): boolean {
  return maxNewSeeds <= 0 && previousSignature === signature
}

export function resolveReflectionMaxOutputTokens(reflectionConfig: AiReflectionConfig): number {
  return Math.max(MIN_JSON_OUTPUT_TOKENS, reflectionConfig.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS)
}

export function buildReflectionGenerationConfig(maxOutputTokens: number): GenerationConfig {
  return {
    maxOutputTokens,
    responseMimeType: 'application/json',
    responseSchema: REFLECTION_RESPONSE_SCHEMA,
    thinkingConfig: { thinkingBudget: GEMINI_THINKING_BUDGET },
  } as unknown as GenerationConfig
}

async function generateStructuredGeminiReflection(
  config: AutopilotConfig,
  params: {
    model: string
    maxOutputTokens: number
    systemInstruction: string
    prompt: string
    timeoutMs: number
  },
): Promise<{ text: string; usage?: ReflectionTokenUsage }> {
  const pool = new KeyPool(new FileKeyStorageAdapter(config))
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const [apiKey] = await pool.allocate(1)
    let failed = true
    let authFailure = false
    try {
      // ai-core 3.2 does not expose Gemini responseMimeType/responseSchema yet;
      // keep its KeyPool lease/release path and call the provider SDK for JSON mode.
      const genai = new GoogleGenerativeAI(apiKey)
      const model = genai.getGenerativeModel({
        model: params.model,
        systemInstruction: params.systemInstruction,
        generationConfig: buildReflectionGenerationConfig(params.maxOutputTokens),
      })
      const result = await withTimeout(model.generateContent(params.prompt), params.timeoutMs)
      const response = result.response
      const responseText = response.text()
      failed = false
      const usageMetadata = response.usageMetadata
      return {
        text: responseText,
        usage: usageMetadata
          ? { input: usageMetadata.promptTokenCount, output: usageMetadata.candidatesTokenCount }
          : undefined,
      }
    } catch (error) {
      lastError = error
      authFailure = isAuthFailure(error)
      if (attempt >= 2 || (!authFailure && !isRetryableGeminiFailure(error))) throw error
    } finally {
      await pool.release(apiKey, failed, authFailure).catch(() => {})
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

function isAuthFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /\b(401|403)\b|API_KEY_INVALID|PERMISSION_DENIED|auth/i.test(message)
}

function isRetryableGeminiFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /\b(408|409|429|500|502|503|504)\b|ECONNRESET|ETIMEDOUT|fetch failed|temporar/i.test(message)
}

function formatUsage(usage: ReflectionTokenUsage | undefined): string {
  if (!usage) return 'unknown'
  return `prompt:${usage.input ?? 'unknown'},completion:${usage.output ?? 'unknown'}`
}

export function summarizeAiReflectionText(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  if (!compact) return '<empty>'
  return JSON.stringify(compact.length > 280 ? `${compact.slice(0, 280)}...` : compact)
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`AI reflection timed out after ${timeoutMs}ms`)), timeoutMs)
  })
  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export function isReflectionRewriteFresh(record: ReflectionStateRecord | undefined, now: Date = new Date()): record is ReflectionRecord {
  if (!record || record.skipped === true) return false
  const generatedAt = new Date(record.generatedAt).getTime()
  return Number.isFinite(generatedAt) && now.getTime() - generatedAt <= 60 * 60 * 1000
}

export const PROMPT_LIMITS = {
  PROMPT_VERSION,
  PROMPT_MAX_NODES,
  PROMPT_MAX_BACKLOG,
  PROMPT_MAX_IDEAS,
  PROMPT_MAX_DISMISSED_TITLES,
  SEED_CAP,
  REWRITE_CAP,
  SEED_TITLE_MAX,
  SEED_RAWTEXT_MAX,
  REWRITE_TEXT_MAX,
  MIN_JSON_OUTPUT_TOKENS,
} as const
