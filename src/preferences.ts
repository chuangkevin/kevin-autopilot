import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { GeminiClient, KeyPool } from '@kevinsisi/ai-core'
import { FileKeyStorageAdapter, hasGeminiKeys } from './keys.js'
import { listArchivedNodes } from './idea-graph.js'
import type { AutopilotConfig, IdeaGraphNode, PreferenceMode, Preferences } from './types.js'

const PREF_FILE = 'preference-cache.json'
const STAGE_B_THRESHOLD = 10
const THEME_THROTTLE_MS = 24 * 60 * 60 * 1000
const MAX_THEMES = 5
const MIN_THEMES = 3
const DEFAULT_TIMEOUT_MS = 30_000
const MAX_OUTPUT_TOKENS = 400

let inFlight = false

export async function readPreferences(config: AutopilotConfig): Promise<Preferences | null> {
  try {
    const raw = await readFile(prefPath(config), 'utf8')
    const parsed = JSON.parse(raw) as Preferences
    if (parsed.mode && Array.isArray(parsed.avoid) && parsed.summary && parsed.computedAt) return parsed
    return null
  } catch {
    return null
  }
}

export async function recomputePreferences(config: AutopilotConfig): Promise<Preferences> {
  if (inFlight) {
    const existing = await readPreferences(config)
    if (existing) return existing
  }
  inFlight = true
  try {
    const archived = await listArchivedNodes(config)
    const archivedCount = archived.length
    const now = new Date().toISOString()

    if (archivedCount === 0) {
      const prefs: Preferences = {
        mode: 'keywords',
        avoid: [],
        summary: 'Kevin 最近沒有冷凍任何想法。',
        computedAt: now,
        archivedCount: 0,
      }
      await persistPreferences(config, prefs)
      return prefs
    }

    if (archivedCount < STAGE_B_THRESHOLD) {
      const prefs = buildStageA(archived, now)
      await persistPreferences(config, prefs)
      return prefs
    }

    const cached = await readPreferences(config)
    const stageBStale = !cached
      || cached.mode !== 'themes'
      || Date.now() - new Date(cached.computedAt).getTime() >= THEME_THROTTLE_MS

    if (!stageBStale && cached) {
      // throttle: refresh the summary with current keywords for freshness, keep themes
      const stageA = buildStageA(archived, now)
      const merged: Preferences = {
        mode: 'themes',
        avoid: cached.avoid,
        summary: `${cached.summary}\n（最新關鍵字：${stageA.summary.replace('Kevin 最近冷凍的方向包含：', '')}）`,
        computedAt: cached.computedAt,
        archivedCount,
      }
      await persistPreferences(config, merged)
      return merged
    }

    try {
      const themes = await callThemeAbstraction(config, archived)
      const prefs: Preferences = {
        mode: 'themes',
        avoid: themes,
        summary: `Kevin 不喜歡的方向：${themes.join('、')}`,
        computedAt: now,
        archivedCount,
      }
      await persistPreferences(config, prefs)
      return prefs
    } catch (error) {
      console.warn('preferences: stage B failed, falling back to stage A:', error instanceof Error ? error.message : String(error))
      const fallback = buildStageA(archived, now)
      await persistPreferences(config, fallback)
      return fallback
    }
  } finally {
    inFlight = false
  }
}

function buildStageA(archived: IdeaGraphNode[], now: string): Preferences {
  const counts = new Map<string, number>()
  for (const node of archived) {
    for (const keyword of node.keywords ?? []) {
      counts.set(keyword, (counts.get(keyword) ?? 0) + 1)
    }
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10)
  const top5Summary = top.slice(0, 5).map(([kw, c]) => `${kw}(${c})`).join(', ')
  return {
    mode: 'keywords',
    avoid: top.map(([kw]) => kw),
    summary: `Kevin 最近冷凍的方向包含：${top5Summary || '（沒有可統計的關鍵字）'}`,
    computedAt: now,
    archivedCount: archived.length,
  }
}

async function callThemeAbstraction(config: AutopilotConfig, archived: IdeaGraphNode[]): Promise<string[]> {
  if (!config.ai?.enabled || config.ai.provider !== 'gemini') {
    throw new Error('preferences: AI not configured')
  }
  if (!(await hasGeminiKeys(config))) {
    throw new Error('preferences: no Gemini key available')
  }
  const client = new GeminiClient(new KeyPool(new FileKeyStorageAdapter(config)), { maxRetries: 2 })
  const payload = {
    task: `把以下被使用者冷凍的想法總結成 ${MIN_THEMES}-${MAX_THEMES} 個主題（不是關鍵字，而是抽象方向）`,
    archivedItems: archived.slice(0, 40).map((node) => ({
      title: node.title,
      summary: node.summary,
      keywords: node.keywords,
    })),
    outputSchema: { themes: ['string ≤ 40 chars'] },
  }
  const response = await withTimeout(
    client.generateContent({
      model: config.ai.model,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      systemInstruction: '你是偏好分析器。從使用者冷凍的想法找出抽象方向。只輸出 minified JSON，不要 Markdown，不要說明文字。',
      prompt: JSON.stringify(payload),
    }),
    config.ai.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  )
  const parsed = JSON.parse(extractJson(response.text)) as { themes?: unknown }
  if (!Array.isArray(parsed.themes)) throw new Error('preferences: stage B returned no themes array')
  const themes = parsed.themes
    .filter((t): t is string => typeof t === 'string')
    .map((t) => t.trim().slice(0, 40))
    .filter((t) => t.length > 0)
    .slice(0, MAX_THEMES)
  if (themes.length < MIN_THEMES) throw new Error(`preferences: stage B returned only ${themes.length} themes (min ${MIN_THEMES})`)
  return themes
}

async function persistPreferences(config: AutopilotConfig, prefs: Preferences): Promise<void> {
  await mkdir(config.dataDir, { recursive: true })
  await writeFile(prefPath(config), `${JSON.stringify(prefs, null, 2)}\n`, 'utf8')
}

function prefPath(config: AutopilotConfig): string {
  return join(config.dataDir, PREF_FILE)
}

function extractJson(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fenced?.[1]) return fenced[1].trim()
  if (trimmed.startsWith('{')) return trimmed
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1)
  throw new Error('preferences: AI response did not contain JSON')
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`preferences: AI call timed out after ${timeoutMs}ms`)), timeoutMs)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer)
  }
}
