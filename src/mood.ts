import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { listBacklog, openBacklogDatabase } from './backlog.js'
import type { AutopilotConfig, DeliberationRecord, IdeaGraphNode, MoodLabel, MoodSignals, MoodState } from './types.js'

const MOOD_FILE = 'mood-state.json'
const GRAPH_FILE = 'idea-graph.json'
const DELIBERATIONS_DIR = 'deliberations'
const DAY_MS = 24 * 60 * 60 * 1000

const RULE = {
  backlogActiveTense: 15,
  backlogAdded24hTense: 8,
  seedsExcited: 3,
  scoreAvgExcited: 5,
}

const MOOD_LINES_BASE: Record<MoodLabel, string> = {
  excited: '最近系統有不少進展（新節點、新 seed），可以比較大膽提案。',
  flow: '穩定推進中。維持平常標準。',
  tense: '背景 backlog 累積較多，請優先建議壓力釋放方向，避免追加複雜度。',
  idle: '最近沒新動靜。可以提案，但別硬推。',
}

const DELIBERATION_CAST_EMPHASIS: Record<MoodLabel, string> = {
  excited: '讓 🔧 工程師 Kevin 比較主導，可以激進一點。',
  flow: '四位 persona 等比重發言。',
  tense: '讓 ⚠️ 風險 Kevin 的觀點佔比重一點，少追加複雜度。',
  idle: '讓 🛋 休假 Kevin 多發言，質疑「真的值得做嗎」。',
}

export function moodLine(mood: MoodLabel): string {
  return MOOD_LINES_BASE[mood]
}

export function deliberationMoodLine(mood: MoodLabel): string {
  return `${MOOD_LINES_BASE[mood]} ${DELIBERATION_CAST_EMPHASIS[mood]}`
}

export async function readMoodState(config: AutopilotConfig): Promise<MoodState | null> {
  try {
    const raw = await readFile(moodPath(config), 'utf8')
    const parsed = JSON.parse(raw) as MoodState
    if (parsed.mood && parsed.signals && parsed.computedAt) return parsed
    return null
  } catch {
    return null
  }
}

export async function persistMoodState(config: AutopilotConfig, state: MoodState): Promise<void> {
  await mkdir(config.dataDir, { recursive: true })
  await writeFile(moodPath(config), `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

export async function computeMood(config: AutopilotConfig, observationScoreHistory: number[] = []): Promise<MoodState> {
  const now = new Date()
  const since = new Date(now.getTime() - DAY_MS)
  const signals: MoodSignals = {
    scoreAvg24h: average(observationScoreHistory),
    backlogActiveCount: 0,
    backlogAdded24h: 0,
    archiveAdded24h: 0,
    seedsInjected24h: 0,
    nodesAdded24h: 0,
  }

  try {
    const db = openBacklogDatabase(config)
    try {
      const active = listBacklog(db, 'active', now)
      signals.backlogActiveCount = active.length
      signals.backlogAdded24h = active.filter((item) => new Date(item.firstSeenAt) >= since).length
    } finally {
      db.close()
    }
  } catch {
    // backlog db missing — leave zeros
  }

  const graphNodes = await loadGraphNodes(config)
  signals.nodesAdded24h = graphNodes.filter((node) => node.createdAt && new Date(node.createdAt) >= since).length
  signals.archiveAdded24h = graphNodes.filter((node) => node.archivedAt && new Date(node.archivedAt) >= since).length

  signals.seedsInjected24h = await sumRecentSeeds(config, since)

  const mood = decideMood(signals)
  return {
    mood,
    computedAt: now.toISOString(),
    signals,
  }
}

export function decideMood(signals: MoodSignals): MoodLabel {
  if (signals.backlogActiveCount >= RULE.backlogActiveTense || signals.backlogAdded24h >= RULE.backlogAdded24hTense) return 'tense'
  if (signals.seedsInjected24h >= RULE.seedsExcited || signals.scoreAvg24h >= RULE.scoreAvgExcited) return 'excited'
  if (signals.nodesAdded24h === 0 && signals.backlogAdded24h === 0) return 'idle'
  return 'flow'
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

async function loadGraphNodes(config: AutopilotConfig): Promise<IdeaGraphNode[]> {
  try {
    const raw = await readFile(join(config.dataDir, GRAPH_FILE), 'utf8')
    const parsed = JSON.parse(raw) as { nodes?: IdeaGraphNode[] }
    return Array.isArray(parsed.nodes) ? parsed.nodes : []
  } catch {
    return []
  }
}

async function sumRecentSeeds(config: AutopilotConfig, since: Date): Promise<number> {
  const dir = join(config.dataDir, DELIBERATIONS_DIR)
  let files: string[]
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.json'))
  } catch {
    return 0
  }
  let total = 0
  for (const file of files) {
    try {
      const raw = await readFile(join(dir, file), 'utf8')
      const record = JSON.parse(raw) as DeliberationRecord
      if (!record.finishedAt) continue
      if (new Date(record.finishedAt) < since) continue
      total += record.synthesis?.seedsInjected ?? 0
    } catch {
      // skip malformed
    }
  }
  return total
}

function moodPath(config: AutopilotConfig): string {
  return join(config.dataDir, MOOD_FILE)
}
