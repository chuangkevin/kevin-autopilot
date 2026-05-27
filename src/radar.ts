import { makeCardId, insertProblemCard, markSignalProcessed, upsertRawSignal } from './problem-cards.js'
import { getProvider, hasOpenCodeEnv } from './provider.js'
import { hasGeminiKeys } from './keys.js'
import type { AutopilotConfig, ProblemCard, ProblemSignal } from './types.js'
import type { DatabaseSync } from 'node:sqlite'

const EXTRACT_TIMEOUT_MS = 15_000
const STRUCTURE_TIMEOUT_MS = 20_000

// Token budgets must leave room for the model wrapping JSON in a ```json
// code fence (and, on thinking models like gemini-2.5-flash, any preamble).
// A tiny budget truncates the JSON mid-value and the parse fails, which
// silently drops every signal — keep these generous.
const EXTRACT_MAX_TOKENS = 256
const STRUCTURE_MAX_TOKENS = 1024
const SEEDS_MAX_TOKENS = 1024

interface AiProvider {
  generateContent(opts: { model: string; maxOutputTokens: number; systemInstruction: string; prompt: string }): Promise<{ text: string }>
}

function parseJson<T>(text: string): T | null {
  try {
    const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
    return match ? JSON.parse(match[0]) as T : null
  } catch {
    return null
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('radar: timeout')), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function extractSignal(config: AutopilotConfig, signal: ProblemSignal, provider: AiProvider): Promise<boolean> {
  const model = config.ai!.model
  const prompt = `Analyze this post. Reply ONLY with JSON: {"keep":true} or {"keep":false}

Keep if: someone is frustrated with a workflow, manual process, broken tool, or wasted time.
Skip if: pure tech discussion, job post, news headline, self-promotion, or no human pain.

Title: ${signal.title}
Text: ${signal.snippet.slice(0, 600)}`

  try {
    const result = await withTimeout(
      provider.generateContent({ model, maxOutputTokens: EXTRACT_MAX_TOKENS, systemInstruction: 'You are a pain signal classifier. Reply only with JSON.', prompt }),
      EXTRACT_TIMEOUT_MS,
    )
    const parsed = parseJson<{ keep: boolean }>(result.text)
    return parsed?.keep === true
  } catch {
    return false
  }
}

type StructuredCard = Pick<ProblemCard, 'whoIsInPain' | 'pain' | 'context' | 'currentWorkaround' | 'urgencySignal'>

async function structureCard(config: AutopilotConfig, signal: ProblemSignal, provider: AiProvider): Promise<StructuredCard | null> {
  const model = config.ai!.model
  const prompt = `Extract a structured problem card. Reply ONLY with JSON.

Title: ${signal.title}
Text: ${signal.snippet.slice(0, 800)}

JSON schema:
{
  "who_is_in_pain": "specific group in English (e.g. 'startup founders', 'backend engineers')",
  "pain": "核心痛點（繁體中文）",
  "context": "在什麼情境下發生（繁體中文）",
  "current_workaround": "現在怎麼應對（繁體中文）",
  "urgency_signal": "為什麼現在這個問題浮現（繁體中文）"
}

Rules: who_is_in_pain in English only. All other fields in Chinese. No judgment. No scoring.`

  try {
    const result = await withTimeout(
      provider.generateContent({ model, maxOutputTokens: STRUCTURE_MAX_TOKENS, systemInstruction: 'You extract structured problem cards. Reply only with JSON.', prompt }),
      STRUCTURE_TIMEOUT_MS,
    )
    const parsed = parseJson<Record<string, string>>(result.text)
    if (!parsed || !parsed.who_is_in_pain || !parsed.pain) return null
    return {
      whoIsInPain: String(parsed.who_is_in_pain),
      pain: String(parsed.pain),
      context: String(parsed.context ?? ''),
      currentWorkaround: String(parsed.current_workaround ?? ''),
      urgencySignal: String(parsed.urgency_signal ?? ''),
    }
  } catch {
    return null
  }
}

async function generateIdeaSeeds(config: AutopilotConfig, card: StructuredCard, provider: AiProvider): Promise<string[]> {
  const model = config.ai!.model
  const prompt = `List 2-4 possible product directions. No scoring, no ranking, no "best". Each direction max 6 words.

Who: ${card.whoIsInPain}
Pain: ${card.pain}
Context: ${card.context}

Reply ONLY with a JSON array of short strings. Example: ["direction A", "direction B"]`

  try {
    const result = await withTimeout(
      provider.generateContent({ model, maxOutputTokens: SEEDS_MAX_TOKENS, systemInstruction: 'You generate product direction ideas. Reply only with a JSON array of strings.', prompt }),
      STRUCTURE_TIMEOUT_MS,
    )
    const parsed = parseJson<string[]>(result.text)
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === 'string').slice(0, 4) : []
  } catch {
    return []
  }
}

async function resolveProvider(config: AutopilotConfig, override: AiProvider | undefined): Promise<AiProvider | null> {
  if (override) return override
  if (!config.ai?.enabled) return null
  const haveOpenCode = hasOpenCodeEnv(config)
  const haveGemini = await hasGeminiKeys(config).catch(() => false)
  if (!haveOpenCode && !haveGemini) return null
  return getProvider(config) as unknown as AiProvider
}

export async function runRadarPipeline(
  config: AutopilotConfig,
  db: DatabaseSync,
  signals: ProblemSignal[],
  providerOverride?: AiProvider,
): Promise<ProblemCard[]> {
  const provider = await resolveProvider(config, providerOverride)
  const cards: ProblemCard[] = []

  for (const signal of signals) {
    upsertRawSignal(db, signal)
    if (!provider) {
      markSignalProcessed(db, signal.id, 'skipped')
      continue
    }

    const keep = await extractSignal(config, signal, provider)
    if (!keep) {
      markSignalProcessed(db, signal.id, 'skipped')
      continue
    }

    const structured = await structureCard(config, signal, provider)
    if (!structured) {
      markSignalProcessed(db, signal.id, 'skipped')
      continue
    }

    const seeds = await generateIdeaSeeds(config, structured, provider)
    const card: ProblemCard = {
      id: makeCardId(signal.id),
      signalId: signal.id,
      ...structured,
      ideaSeeds: seeds,
      sourceUrl: signal.url,
      createdAt: new Date().toISOString(),
    }

    insertProblemCard(db, card)
    markSignalProcessed(db, signal.id, 'done')
    cards.push(card)
  }

  return cards
}
