import { GeminiClient, KeyPool } from '@kevinsisi/ai-core'
import type { ApiKey, StorageAdapter } from '@kevinsisi/ai-core'
import type { AiConfig, IdeaClassification, IdeaRecord } from './types.js'

export interface IdeaAnalysisResult {
  title: string
  classification: IdeaClassification
  reasons: string[]
  suggestedNextSteps: string[]
  approvalRequired: boolean
}

class EnvKeyStorageAdapter implements StorageAdapter {
  private readonly keys: ApiKey[]

  constructor(rawKeys: string[]) {
    this.keys = rawKeys.map((key, index) => ({
      id: index + 1,
      key,
      isActive: true,
      cooldownUntil: 0,
      leaseUntil: 0,
      leaseToken: null,
      usageCount: 0,
    }))
  }

  async getKeys(): Promise<ApiKey[]> {
    return this.keys.map((key) => ({ ...key }))
  }

  async acquireLease(keyId: number, leaseUntil: number, leaseToken: string, now: number): Promise<boolean> {
    const key = this.keys.find((item) => item.id === keyId)
    if (!key || !key.isActive || key.cooldownUntil > now || key.leaseUntil > now) return false
    key.leaseUntil = leaseUntil
    key.leaseToken = leaseToken
    return true
  }

  async renewLease(keyId: number, leaseUntil: number, leaseToken: string): Promise<boolean> {
    const key = this.keys.find((item) => item.id === keyId)
    if (!key || key.leaseToken !== leaseToken) return false
    key.leaseUntil = leaseUntil
    return true
  }

  async updateKey(updatedKey: ApiKey, expectedLeaseToken?: string | null): Promise<void> {
    const index = this.keys.findIndex((item) => item.id === updatedKey.id)
    if (index < 0) return
    if (expectedLeaseToken !== undefined && this.keys[index]?.leaseToken !== expectedLeaseToken) return
    this.keys[index] = { ...updatedKey }
  }
}

export function isAiThinkingAvailable(config?: AiConfig): boolean {
  return Boolean(config?.enabled && config.provider === 'gemini' && getGeminiKeys().length > 0)
}

export async function analyzeIdeaWithAiCore(config: AiConfig, rawText: string): Promise<IdeaAnalysisResult> {
  if (!isAiThinkingAvailable(config)) {
    throw new Error('AI thinking is disabled or no Gemini API key is configured')
  }

  const client = new GeminiClient(new KeyPool(new EnvKeyStorageAdapter(getGeminiKeys())), { maxRetries: 2 })
  const response = await withTimeout(
    client.generateContent({
      model: config.model,
      maxOutputTokens: 900,
      systemInstruction:
        '你是 Kevin Autopilot 的想法接手引擎。保留 Kevin 的原始意圖，依照使用者體驗、穩定性、可驗證性排序。只輸出 JSON，不要 Markdown。分類只能是 explore、plan、prototype、blocked。任何 repo creation、deployment、production、secret、data deletion、API contract change 都必須 approvalRequired=true。',
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
    config.timeoutMs ?? 20_000,
  )

  return parseIdeaAnalysis(response.text)
}

export function applyAiAnalysis(record: Omit<IdeaRecord, 'thinking'>, analysis: IdeaAnalysisResult, model: string): IdeaRecord {
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

function getGeminiKeys(): string[] {
  return [process.env.GEMINI_API_KEY, process.env.GOOGLE_API_KEY]
    .filter((key): key is string => Boolean(key && key.trim().length > 0))
    .map((key) => key.trim())
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
