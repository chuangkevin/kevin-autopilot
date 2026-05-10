import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { analyzeIdeaWithAiCore, applyAiAnalysis } from './ai.js'
import type { AutopilotConfig, IdeaClassification, IdeaRecord } from './types.js'

const MAX_IDEA_LENGTH = 8000
const BLOCKED_TERMS = ['刪資料', '重建資料', '正式環境', 'production', 'secret', '金鑰', '.env', 'credential', '部署']
const PROTOTYPE_TERMS = ['prototype', '原型', '先做', 'mvp', '最小', '簡單']
const PLAN_TERMS = ['架構', '規格', 'openspec', 'repo', '部屬', '部署', '開發', '測試']

export async function createIdea(config: AutopilotConfig, rawText: string): Promise<IdeaRecord> {
  const normalizedText = rawText.trim()
  if (!normalizedText) {
    throw new Error('Idea text is required')
  }

  if (normalizedText.length > MAX_IDEA_LENGTH) {
    throw new Error(`Idea text is too long. Limit: ${MAX_IDEA_LENGTH} characters`)
  }

  const now = new Date()
  const baseRecord: Omit<IdeaRecord, 'thinking'> = {
    id: makeIdeaId(now),
    createdAt: now.toISOString(),
    environment: config.environment,
    rawText: normalizedText,
    title: makeTitle(normalizedText),
    ...classifyIdea(normalizedText),
  }

  const record = await thinkAboutIdea(config, baseRecord, normalizedText)

  await saveIdea(config, record)
  return record
}

async function thinkAboutIdea(
  config: AutopilotConfig,
  baseRecord: Omit<IdeaRecord, 'thinking'>,
  normalizedText: string,
): Promise<IdeaRecord> {
  if (!config.ai?.enabled) {
    return {
      ...baseRecord,
      thinking: { mode: 'deterministic-fallback', success: true, error: 'AI thinking disabled in config' },
    }
  }

  try {
    const analysis = await analyzeIdeaWithAiCore(config.ai, normalizedText)
    return applyAiAnalysis(baseRecord, analysis, config.ai.model)
  } catch (error) {
    return {
      ...baseRecord,
      thinking: {
        mode: 'deterministic-fallback',
        model: config.ai.model,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
    }
  }
}

export async function listIdeas(config: AutopilotConfig, limit = 20): Promise<IdeaRecord[]> {
  const dir = ideasDir(config)
  await mkdir(dir, { recursive: true })
  const files = (await readdir(dir)).filter((file) => file.endsWith('.json')).sort().reverse().slice(0, limit)
  const records = await Promise.all(
    files.map(async (file) => JSON.parse(await readFile(join(dir, file), 'utf8')) as IdeaRecord),
  )
  return records
}

function classifyIdea(rawText: string): Pick<IdeaRecord, 'classification' | 'reasons' | 'suggestedNextSteps' | 'approvalRequired'> {
  const lower = rawText.toLowerCase()
  const matchedBlocked = BLOCKED_TERMS.filter((term) => lower.includes(term.toLowerCase()))
  if (matchedBlocked.length > 0) {
    return {
      classification: 'blocked',
      reasons: [`包含需要明確批准的高風險詞：${matchedBlocked.join(', ')}`],
      suggestedNextSteps: ['先拆出安全的 planning scope', '確認是否涉及 production、secrets、資料刪除或部署'],
      approvalRequired: true,
    }
  }

  if (PLAN_TERMS.some((term) => lower.includes(term.toLowerCase()))) {
    return {
      classification: 'plan',
      reasons: ['想法已包含 repo、架構、規格、部署、開發或測試方向'],
      suggestedNextSteps: ['整理使用者痛點與成功條件', '產生 OpenSpec proposal/tasks', '決定 repo 與部署目標'],
      approvalRequired: true,
    }
  }

  if (PROTOTYPE_TERMS.some((term) => lower.includes(term.toLowerCase()))) {
    return {
      classification: 'prototype',
      reasons: ['想法偏向最小可跑原型'],
      suggestedNextSteps: ['定義最小可驗證流程', '確認不影響既有使用者流程', '準備 bounded OpenCode prompt'],
      approvalRequired: true,
    }
  }

  return {
    classification: 'explore',
    reasons: ['需要更多脈絡才能進入規格或實作'],
    suggestedNextSteps: ['補充目標使用者', '補充現在卡住的工作流', '補充希望第一版驗證什麼'],
    approvalRequired: false,
  }
}

function makeTitle(rawText: string): string {
  const firstLine = rawText.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? '未命名想法'
  return firstLine.length > 60 ? `${firstLine.slice(0, 57)}...` : firstLine
}

async function saveIdea(config: AutopilotConfig, record: IdeaRecord): Promise<void> {
  const dir = ideasDir(config)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `${record.id}.json`), `${JSON.stringify(record, null, 2)}\n`, 'utf8')
}

function ideasDir(config: AutopilotConfig): string {
  return join(config.dataDir, 'ideas')
}

function makeIdeaId(date: Date): string {
  return `idea-${date.toISOString().replaceAll(':', '-').replaceAll('.', '-')}`
}
