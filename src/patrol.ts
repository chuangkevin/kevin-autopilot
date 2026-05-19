import { GeminiClient, KeyPool } from '@kevinsisi/ai-core'
import { FileKeyStorageAdapter, hasGeminiKeys } from './keys.js'
import { buildPersonaPrefix } from './persona.js'
import { listConversationMessages } from './conversation.js'
import type { AutopilotConfig, ConversationMessage, ProblemBrief } from './types.js'

const MAX_OUTPUT_TOKENS = 4096
const TIMEOUT_MS = 20_000

export async function runPatrol(config: AutopilotConfig, briefs: ProblemBrief[]): Promise<string | null> {
  try {
    const systemInstruction = await buildPersonaPrefix('patrol', config)
    const history = await listConversationMessages(config, { limit: 20 })
    const briefSummary = briefs
      .slice(0, 3)
      .map((b, i) => `${i + 1}. ${b.title}（${b.confidence}）`)
      .join('\n')
    const historySummary = formatHistory(history)
    const prompt = [
      '你是 Kevin 的 AI 分身，剛完成一輪外部訊號掃描。',
      '',
      '今日問題候選（top 3）：',
      briefSummary || '（目前沒有足夠的問題候選）',
      '',
      historySummary ? `最近對話記錄：\n${historySummary}\n` : '',
      '根據以上資訊，有沒有值得主動告訴 Kevin 的事？',
      '如果有，用一到兩句完整的中文句子說清楚（不超過 80 字）。',
      '必須是完整句子，不能只列關鍵字或標題片段。',
      '如果沒有新的值得說的，只回傳空字串，不要說任何話。',
    ].filter(Boolean).join('\n')

    const text = await callGeminiWithTimeout(config, systemInstruction, prompt)
    const trimmed = text.trim()
    return trimmed.length > 0 ? trimmed : null
  } catch {
    return null
  }
}

export async function replyAsPatrol(
  config: AutopilotConfig,
  briefs: ProblemBrief[],
  history: ConversationMessage[],
): Promise<string> {
  const systemInstruction = await buildPersonaPrefix('patrol', config)
  const briefSummary = briefs
    .slice(0, 3)
    .map((b, i) => `${i + 1}. ${b.title}（${b.confidence}）`)
    .join('\n')
  const historySummary = formatHistory(history)
  const prompt = [
    '你是 Kevin 的 AI 分身，正在跟 Kevin 對話。',
    '',
    '今日問題候選（top 3）：',
    briefSummary || '（目前沒有足夠的問題候選）',
    '',
    historySummary ? `對話記錄（最新的 Kevin 訊息在最後）：\n${historySummary}` : '',
    '',
    '直接回覆 Kevin 最後說的話。用完整中文句子，你的視角，不超過 150 字。不能只列關鍵字。',
  ].filter(Boolean).join('\n')

  return callGeminiWithTimeout(config, systemInstruction, prompt)
}

function formatHistory(msgs: ConversationMessage[]): string {
  return msgs.map((m) => `[${m.sender === 'ai' ? '分身' : 'Kevin'}] ${m.content}`).join('\n')
}

async function callGeminiWithTimeout(config: AutopilotConfig, systemInstruction: string, prompt: string): Promise<string> {
  if (!config.ai?.enabled || config.ai.provider !== 'gemini') throw new Error('patrol: AI not configured')
  if (!(await hasGeminiKeys(config))) throw new Error('patrol: no Gemini key available')
  const client = new GeminiClient(new KeyPool(new FileKeyStorageAdapter(config)), { maxRetries: 2 })
  const result = await Promise.race([
    client.generateContent({ model: config.ai.model, maxOutputTokens: MAX_OUTPUT_TOKENS, systemInstruction, prompt }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('patrol: timeout')), TIMEOUT_MS)),
  ])
  return result.text
}
