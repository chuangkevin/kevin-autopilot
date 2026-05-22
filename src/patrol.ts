import { hasGeminiKeys } from './keys.js'
import { getProvider, hasOpenCodeEnv } from './provider.js'
import { buildPersonaPrefix } from './persona.js'
import { listConversationMessages } from './conversation.js'
import type { AutopilotConfig, ConversationMessage, ProblemBrief } from './types.js'

const MAX_OUTPUT_TOKENS = 4096
const TIMEOUT_MS = 20_000

export async function runPatrol(config: AutopilotConfig, briefs: ProblemBrief[]): Promise<string | null> {
  try {
    if (briefs.length === 0) return null
    const systemInstruction = await buildPersonaPrefix('patrol', config)
    const history = await listConversationMessages(config, { limit: 20 })
    const top = briefs[0]
    const topDetail = [
      `標題：${top.title}`,
      `誰在痛：${top.people}`,
      `痛點：${top.pain}`,
      `Kevin 切入方向：${top.mvp}`,
      `Kevin 適合度：${top.kevinFit.score}/100 — ${top.kevinFit.rationale}`,
    ].join('\n')
    const otherTitles = briefs.slice(1, 4).map((b, i) => `${i + 2}. ${b.title}`).join('\n')
    const historySummary = formatHistory(history)
    const prompt = [
      '你是 Kevin 的 AI 分身，剛完成一輪外部訊號掃描，現在主動告訴 Kevin 今天最值得看的問題。',
      '',
      '【今日頭號問題】',
      topDetail,
      '',
      otherTitles ? `【其他候選】\n${otherTitles}` : '',
      '',
      historySummary ? `【最近對話】\n${historySummary}\n` : '',
      '用兩句話告訴 Kevin 這個頭號問題的重點：第一句說清楚誰在痛、怎麼痛；第二句說為什麼 Kevin 值得追這個。',
      '不要寒暄、不要說"您好"、不要重複標題文字、直接講重點。',
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
  const briefDetails = briefs.slice(0, 3).map((b, i) => [
    i === 0 ? `★【Kevin 目前在看這張】${b.title}` : `${i + 1}. ${b.title}`,
    `   誰：${b.people}`,
    `   痛：${b.pain}`,
    `   缺口：${b.existingSolutionsGap}`,
    `   MVP：${b.mvp}`,
  ].join('\n')).join('\n\n')
  const historySummary = formatHistory(history)
  const prompt = [
    '你是 Kevin 的 AI 分身，正在跟 Kevin 討論今天掃到的問題。',
    '',
    '【今日問題清單（★號是 Kevin 目前正在看的那張）】',
    briefDetails || '（目前沒有足夠的問題候選）',
    '',
    historySummary ? `【對話記錄，Kevin 的最後一句在最後】\n${historySummary}` : '',
    '',
    'Kevin 正在看★號那張卡片。直接回覆 Kevin 最後說的話，優先圍繞★號卡片給出具體觀點。用完整中文句子，不超過 150 字，不要寒暄。',
  ].filter(Boolean).join('\n')

  return callGeminiWithTimeout(config, systemInstruction, prompt)
}

function formatHistory(msgs: ConversationMessage[]): string {
  return msgs.map((m) => `[${m.sender === 'ai' ? '分身' : 'Kevin'}] ${m.content}`).join('\n')
}

async function callGeminiWithTimeout(config: AutopilotConfig, systemInstruction: string, prompt: string): Promise<string> {
  if (!config.ai?.enabled) throw new Error('patrol: AI not configured')
  // OpenCode-primary: either OpenCode is configured OR a Gemini key is in
  // the pool. The MultiProviderClient routes accordingly.
  if (!hasOpenCodeEnv(config) && !(await hasGeminiKeys(config))) throw new Error('patrol: no AI provider available (OpenCode unconfigured and Gemini key pool empty)')
  const client = getProvider(config)
  const result = await Promise.race([
    client.generateContent({ model: config.ai.model, maxOutputTokens: MAX_OUTPUT_TOKENS, systemInstruction, prompt }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('patrol: timeout')), TIMEOUT_MS)),
  ])
  return result.text
}
