import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { hasGeminiKeys } from './keys.js'
import { getProvider, hasOpenCodeEnv } from './provider.js'
import type { AutopilotConfig, ProblemBrief } from './types.js'

export interface ProblemDebateMessage {
  persona: string
  round: number
  content: string
}

export interface ProblemDeliberation {
  briefId: string
  generatedAt: string
  model: string
  transcript: ProblemDebateMessage[]
}

const PROBLEM_DELIBERATIONS_DIR = 'problem-deliberations'
const TIMEOUT_MS = 30_000
const MAX_OUTPUT_TOKENS = 2048
const MIN_MESSAGES = 4

function deliberationPath(config: AutopilotConfig, briefId: string): string {
  return join(config.dataDir, PROBLEM_DELIBERATIONS_DIR, `${briefId}.json`)
}

export async function readProblemDeliberation(
  config: AutopilotConfig,
  briefId: string,
): Promise<ProblemDeliberation | null> {
  try {
    const raw = await readFile(deliberationPath(config, briefId), 'utf-8')
    return JSON.parse(raw) as ProblemDeliberation
  } catch {
    return null
  }
}

export async function deliberateProblemCard(
  config: AutopilotConfig,
  brief: ProblemBrief,
): Promise<ProblemDeliberation> {
  if (!config.ai?.enabled) throw new Error('problem-deliberation: AI not configured')
  if (!hasOpenCodeEnv(config) && !(await hasGeminiKeys(config))) {
    throw new Error('problem-deliberation: no AI provider available')
  }

  const systemInstruction = [
    '你是一個多角色辯論模擬器。',
    '你的任務是讓 4 個 Kevin 子人格對一張問題卡片進行兩輪辯論。',
    '每個人格有不同角度，但都是 Kevin 本人的一部分。',
    '請直接、誠實地辯論，不要客套，不要重複說"好的"。',
  ].join('\n')

  const briefSummary = [
    `標題：${brief.title}`,
    `誰在痛：${brief.people}`,
    `痛點：${brief.pain}`,
    `工作流程：${brief.workflow}`,
    `現有解法的缺口：${brief.existingSolutionsGap}`,
    `Kevin 切入方向：${brief.mvp}`,
    `Kevin 適合度：${brief.kevinFit.score}/100 — ${brief.kevinFit.rationale}`,
  ].join('\n')

  const prompt = [
    '以下是一張問題卡片：',
    '',
    briefSummary,
    '',
    '請讓以下 4 個 Kevin 子人格進行 2 輪辯論（共 8 條訊息），討論這個問題是否真實、值不值得追：',
    '',
    '人格：',
    '1. 工程師 Kevin — 角度：技術可行性、現有工具差異、實作難度',
    '2. 設計師 Kevin — 角度：使用者行為是否真實、流程節點在哪、UX 切入點',
    '3. 風險 Kevin — 角度：市場競爭、失敗模式、時機是否對',
    '4. 休假 Kevin — 角度：Kevin 自己會不會用、做起來好不好玩、生活方式契合度',
    '',
    '請輸出一個 JSON 陣列，共 8 個物件，格式如下：',
    '[',
    '  { "persona": "工程師 Kevin", "round": 1, "content": "..." },',
    '  { "persona": "設計師 Kevin", "round": 1, "content": "..." },',
    '  { "persona": "風險 Kevin", "round": 1, "content": "..." },',
    '  { "persona": "休假 Kevin", "round": 1, "content": "..." },',
    '  { "persona": "工程師 Kevin", "round": 2, "content": "..." },',
    '  { "persona": "設計師 Kevin", "round": 2, "content": "..." },',
    '  { "persona": "風險 Kevin", "round": 2, "content": "..." },',
    '  { "persona": "休假 Kevin", "round": 2, "content": "..." }',
    ']',
    '',
    '每條訊息 50-120 字，用繁體中文，語氣直接像在內部討論。只輸出 JSON 陣列，不要其他文字。',
  ].join('\n')

  const client = getProvider(config)
  const result = await Promise.race([
    client.generateContent({ model: config.ai.model, maxOutputTokens: MAX_OUTPUT_TOKENS, systemInstruction, prompt }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('problem-deliberation: timeout')), TIMEOUT_MS)),
  ])

  const match = result.text.match(/\[[\s\S]*\]/)
  if (!match) throw new Error('problem-deliberation: no JSON array in response')

  const parsed = JSON.parse(match[0]) as unknown[]
  if (!Array.isArray(parsed) || parsed.length < MIN_MESSAGES) {
    throw new Error(`problem-deliberation: expected at least ${MIN_MESSAGES} messages, got ${Array.isArray(parsed) ? parsed.length : 0}`)
  }

  const transcript: ProblemDebateMessage[] = parsed.map((item) => {
    const msg = item as Record<string, unknown>
    return {
      persona: typeof msg.persona === 'string' ? msg.persona : '',
      round: typeof msg.round === 'number' ? msg.round : 1,
      content: typeof msg.content === 'string' ? msg.content : '',
    }
  })

  const deliberation: ProblemDeliberation = {
    briefId: brief.id,
    generatedAt: new Date().toISOString(),
    model: config.ai.model,
    transcript,
  }

  await mkdir(join(config.dataDir, PROBLEM_DELIBERATIONS_DIR), { recursive: true })
  await writeFile(deliberationPath(config, brief.id), JSON.stringify(deliberation, null, 2), 'utf-8')

  return deliberation
}
