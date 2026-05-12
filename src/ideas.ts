import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { createAgentHandoff } from './agents.js'
import { analyzeIdeaWithAiCore, applyAiAnalysis } from './ai.js'
import { createProjectHandoffPlan } from './handoff.js'
import type { AutopilotConfig, ExistingProjectAnalysis, ExistingProjectMatch, IdeaRecord } from './types.js'

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
  const baseRecord: Omit<IdeaRecord, 'thinking' | 'agentHandoff'> = {
    id: makeIdeaId(now),
    createdAt: now.toISOString(),
    environment: config.environment,
    rawText: normalizedText,
    title: makeTitle(normalizedText),
    ...classifyIdea(normalizedText),
    existingProjectAnalysis: analyzeExistingProjects(config, normalizedText),
  }

  const thoughtRecord = await thinkAboutIdea(config, baseRecord, normalizedText)
  const record: IdeaRecord = {
    ...thoughtRecord,
    agentHandoff: createAgentHandoff(thoughtRecord),
    projectHandoff: createProjectHandoffPlan(thoughtRecord),
  }

  await saveIdea(config, record)
  return record
}

async function thinkAboutIdea(
  config: AutopilotConfig,
  baseRecord: Omit<IdeaRecord, 'thinking' | 'agentHandoff'>,
  normalizedText: string,
): Promise<Omit<IdeaRecord, 'agentHandoff'>> {
  if (!config.ai?.enabled) {
    return {
      ...baseRecord,
      thinking: { mode: 'deterministic-fallback', success: true, error: 'AI thinking disabled in config' },
    }
  }

  try {
    const analysis = await analyzeIdeaWithAiCore(config, normalizedText)
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
    files.map(async (file) => readIdeaRecord(config, join(dir, file))),
  )
  return records
}

export async function getIdea(config: AutopilotConfig, id: string): Promise<IdeaRecord | undefined> {
  if (!/^idea-[a-zA-Z0-9_.-]+$/.test(id)) return undefined
  try {
    return await readIdeaRecord(config, join(ideasDir(config), `${id}.json`))
  } catch {
    return undefined
  }
}

export function analyzeExistingProjects(config: AutopilotConfig, rawText: string): ExistingProjectAnalysis {
  const textTokens = tokenize(rawText)
  const matches = [
    ...config.repositories.map((repo) => scoreProjectMatch(textTokens, {
      projectName: repo.name,
      sourceType: 'repository' as const,
      sourceName: repo.name,
      path: repo.path,
      searchable: [repo.name, basename(repo.path)],
    })),
    ...config.services.map((service) => scoreProjectMatch(textTokens, {
      projectName: service.repository ?? service.name,
      sourceType: 'service' as const,
      sourceName: service.name,
      domain: service.domain,
      searchable: [service.name, service.repository, service.domain, service.source].filter(Boolean) as string[],
    })),
  ]
    .filter((match): match is ExistingProjectMatch => Boolean(match))
    .sort((a, b) => b.score - a.score || a.projectName.localeCompare(b.projectName))
    .slice(0, 3)

  const best = matches[0]
  if (!best) {
    return {
      recommendation: config.repositories.length + config.services.length > 0 ? 'new-project' : 'unclear',
      summary: config.repositories.length + config.services.length > 0
        ? '目前沒有明顯相似的既有專案；先當成新方向規劃。'
        : '尚未設定可比對的 repository 或 service，無法判斷是否已有相似專案。',
      matches: [],
    }
  }

  const recommendation = best.score >= 55 ? 'extend-existing' : 'unclear'
  return {
    recommendation,
    summary: recommendation === 'extend-existing'
      ? `最像既有專案「${best.projectName}」，下一步應一併評估延伸既有 repo/service。`
      : `有一些相似訊號，但不足以直接併入「${best.projectName}」；先做 read-only 釐清。`,
    matches,
  }
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

function scoreProjectMatch(
  textTokens: Set<string>,
  project: {
    projectName: string
    sourceType: ExistingProjectMatch['sourceType']
    sourceName: string
    searchable: string[]
    path?: string
    domain?: string
  },
): ExistingProjectMatch | undefined {
  const projectTokens = new Set(project.searchable.flatMap(tokenizeToArray))
  const shared = [...projectTokens].filter((token) => textTokens.has(token))
  if (shared.length === 0) return undefined

  const score = Math.min(100, Math.round((shared.length / Math.max(projectTokens.size, 1)) * 85) + Math.min(shared.length * 6, 15))
  return {
    projectName: project.projectName,
    sourceType: project.sourceType,
    sourceName: project.sourceName,
    score,
    reason: `共同關鍵字：${shared.slice(0, 5).join(', ')}`,
    path: project.path,
    domain: project.domain,
  }
}

function tokenize(value: string): Set<string> {
  return new Set(tokenizeToArray(value))
}

function tokenizeToArray(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/https?:\/\//g, ' ')
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
}

async function saveIdea(config: AutopilotConfig, record: IdeaRecord): Promise<void> {
  const dir = ideasDir(config)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `${record.id}.json`), `${JSON.stringify(record, null, 2)}\n`, 'utf8')
}

async function readIdeaRecord(config: AutopilotConfig, path: string): Promise<IdeaRecord> {
  const record = JSON.parse(await readFile(path, 'utf8')) as IdeaRecord
  return {
    ...record,
    existingProjectAnalysis: record.existingProjectAnalysis ?? analyzeExistingProjects(config, record.rawText),
  }
}

function ideasDir(config: AutopilotConfig): string {
  return join(config.dataDir, 'ideas')
}

function makeIdeaId(date: Date): string {
  return `idea-${date.toISOString().replaceAll(':', '-').replaceAll('.', '-')}`
}
