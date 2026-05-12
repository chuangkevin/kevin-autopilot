import { GeminiClient, KeyPool } from '@kevinsisi/ai-core'
import { FileKeyStorageAdapter, hasGeminiKeys } from './keys.js'
import type { AutopilotConfig, IdeaClassification, IdeaRecord } from './types.js'

export interface IdeaAnalysisResult {
  title: string
  classification: IdeaClassification
  reasons: string[]
  suggestedNextSteps: string[]
  approvalRequired: boolean
}

export async function isAiThinkingAvailable(config: AutopilotConfig): Promise<boolean> {
  return Boolean(config.ai?.enabled && config.ai.provider === 'gemini' && (await hasGeminiKeys(config)))
}

export async function analyzeIdeaWithAiCore(config: AutopilotConfig, rawText: string): Promise<IdeaAnalysisResult> {
  if (!(await isAiThinkingAvailable(config)) || !config.ai) {
    throw new Error('AI thinking is disabled or no Gemini API key is configured')
  }

  const client = new GeminiClient(new KeyPool(new FileKeyStorageAdapter(config)), { maxRetries: 2 })
  const response = await withTimeout(
    client.generateContent({
      model: config.ai.model,
      maxOutputTokens: 900,
      systemInstruction:
        '你是 Kevin Autopilot 的想法接手引擎。保留 Kevin 的原始意圖，標註使用者體驗、穩定性、可驗證性脈絡，但不要替 Kevin 決定哪個想法比較重要。只輸出 JSON，不要 Markdown。分類只能是 explore、plan、prototype、blocked。任何 repo creation、deployment、production、secret、data deletion、API contract change 都必須 approvalRequired=true。',
      prompt: JSON.stringify({
        task: 'Analyze this raw idea and decide the safest next handoff state.',
        rawIdea: rawText,
        outputSchema: {
          title: 'string, max 60 chars',
          classification: 'explore | plan | prototype | blocked',
          reasons: ['string'],
          suggestedNextSteps: ['string'],
          approvalRequired: 'boolean',
        },
      }),
    }),
    config.ai.timeoutMs ?? 20_000,
  )

  return parseIdeaAnalysis(response.text)
}

export function applyAiAnalysis(
  record: Omit<IdeaRecord, 'thinking' | 'agentHandoff'>,
  analysis: IdeaAnalysisResult,
  model: string,
): Omit<IdeaRecord, 'agentHandoff'> {
  return {
    ...record,
    title: analysis.title || record.title,
    classification: analysis.classification,
    reasons: analysis.reasons.length > 0 ? analysis.reasons : record.reasons,
    suggestedNextSteps: analysis.suggestedNextSteps.length > 0 ? analysis.suggestedNextSteps : record.suggestedNextSteps,
    approvalRequired: analysis.approvalRequired,
    thinking: { mode: 'ai-core', model, success: true },
  }
}

export function parseIdeaAnalysis(text: string): IdeaAnalysisResult {
  const parsed = JSON.parse(extractJson(text)) as Partial<IdeaAnalysisResult>
  const classification = parsed.classification
  if (classification !== 'explore' && classification !== 'plan' && classification !== 'prototype' && classification !== 'blocked') {
    throw new Error('AI returned invalid idea classification')
  }

  return {
    title: typeof parsed.title === 'string' ? parsed.title.slice(0, 80) : '未命名想法',
    classification,
    reasons: stringArray(parsed.reasons),
    suggestedNextSteps: stringArray(parsed.suggestedNextSteps),
    approvalRequired: Boolean(parsed.approvalRequired),
  }
}

function extractJson(text: string): string {
  const trimmed = text.trim()
  const fencedJson = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fencedJson?.[1]) return fencedJson[1].trim()
  if (trimmed.startsWith('{')) return trimmed
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1)
  throw new Error('AI response did not contain JSON')
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string').slice(0, 8)
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`AI thinking timed out after ${timeoutMs}ms`)), timeoutMs)
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}
