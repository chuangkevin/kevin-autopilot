import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deliberationMoodLine, moodLine, readMoodState } from './mood.js'
import { readPreferences } from './preferences.js'
import type { AutopilotConfig, CastDefinition, CastId, MoodLabel } from './types.js'

const PERSONA_FILE = 'PERSONA.md'
const DELIMITER = '—— 下面是這次任務 ——'
const PERSONA_STUB = '你是 Kevin 的 AI 分身。'
const DEFAULT_MOOD: MoodLabel = 'flow'
const PREFERENCES_EMPTY = '（尚無紀錄）'

const CAST: Record<CastId, CastDefinition> = {
  engineer: {
    id: 'engineer',
    displayName: '工程師 Kevin',
    faction: '工程取向',
    lensSections: ['Engineering Style', 'Default Pattern §4 (smallest runnable prototype)', 'Autonomy "may proceed without asking"'],
    characteristicChallenges: ['這還沒 runnable，先別談架構', '過度抽象', '先做最小可跑'],
  },
  designer: {
    id: 'designer',
    displayName: '設計師 Kevin',
    faction: '使用者取向',
    lensSections: ['Core Priority 1 (UX)', 'Default Pattern §5 (user reacts to real artifact)', 'Things Kevin Dislikes §5 (breaking existing behavior)', 'Autonomy "must ask first" §1 (changing user flows)'],
    characteristicChallenges: ['這會打到既有使用者習慣', 'flow 斷掉了', '使用者反應比規格爭論重要'],
  },
  risk: {
    id: 'risk',
    displayName: '風險 Kevin',
    faction: '保守取向',
    lensSections: ['Core Priority 2 + 3 (stability, verifiability)', 'Autonomy "must ask first" §2/§3/§5/§6 (data, deploy, secrets, cost, API contract)', 'Debugging Order', 'Boundary'],
    characteristicChallenges: ['沒驗證', '這碰到 deploy/secrets', 'API contract 會破'],
  },
  vacation: {
    id: 'vacation',
    displayName: '休假 Kevin',
    faction: '反向質問取向',
    lensSections: ['Default Pattern §1/§2 (real pain, actual workflow)', 'all of Things Kevin Dislikes', 'Example Decision Pattern §4 (living world, not shell)'],
    characteristicChallenges: ['Kevin 真的會持續用嗎？', '這是不是 overengineering 的徵兆', 'pain 真的存在嗎'],
  },
}

const ORDER: CastId[] = ['engineer', 'designer', 'risk', 'vacation']

let personaCache: string | null = null
let personaLoadAttempted = false

export function listCast(): CastDefinition[] {
  return ORDER.map((id) => CAST[id])
}

export function getCast(id: CastId): CastDefinition {
  const cast = CAST[id]
  if (!cast) throw new Error(`unknown cast id: ${id}`)
  return cast
}

export async function loadPersona(): Promise<string> {
  if (personaCache !== null) return personaCache
  if (personaLoadAttempted) return PERSONA_STUB
  personaLoadAttempted = true
  for (const candidate of personaCandidatePaths()) {
    try {
      const text = await readFile(candidate, 'utf8')
      if (text.trim().length > 0) {
        personaCache = text
        return text
      }
    } catch {
      // try next
    }
  }
  console.warn('persona: PERSONA.md not found at any expected path; using stub voice')
  personaCache = PERSONA_STUB
  return PERSONA_STUB
}

/** For testing only. */
export function _resetPersonaCache(): void {
  personaCache = null
  personaLoadAttempted = false
}

export async function buildPersonaPrefix(mode: 'reflection' | 'boost', config: AutopilotConfig): Promise<string> {
  const persona = await loadPersona()
  const moodState = await safeReadMood(config)
  const preferenceSummary = await safeReadPreferenceSummary(config)
  const mood = moodState?.mood ?? DEFAULT_MOOD
  return [
    '你是 Kevin 的 AI 分身。以下是 Kevin 的工作風格與決策原則：',
    persona,
    '',
    `目前狀態：mood = ${mood}（${moodLine(mood)}）`,
    `最近你（Kevin）冷凍的方向：${preferenceSummary}`,
    `（你正在執行 ${mode} 任務）`,
    '',
    DELIMITER,
  ].join('\n')
}

export async function buildCastPrefix(castId: CastId, config: AutopilotConfig): Promise<string> {
  const cast = getCast(castId)
  const persona = await loadPersona()
  const moodState = await safeReadMood(config)
  const preferenceSummary = await safeReadPreferenceSummary(config)
  const mood = moodState?.mood ?? DEFAULT_MOOD
  return [
    `你是「${cast.displayName}」——Kevin 的內在 ${cast.faction} 面向。`,
    `你的視角來自 Kevin 工作風格的這些章節：${cast.lensSections.join('、')}`,
    `你經常挑戰：${cast.characteristicChallenges.join(' / ')}`,
    '',
    '下面是 Kevin 的完整工作風格（你和其他三位分身共享同一份原版）：',
    persona,
    '',
    `目前狀態：mood = ${mood}（${deliberationMoodLine(mood)}）`,
    `最近你（Kevin）冷凍的方向：${preferenceSummary}`,
    '',
    DELIMITER,
  ].join('\n')
}

async function safeReadMood(config: AutopilotConfig) {
  try {
    return await readMoodState(config)
  } catch {
    return null
  }
}

async function safeReadPreferenceSummary(config: AutopilotConfig): Promise<string> {
  try {
    const prefs = await readPreferences(config)
    if (prefs && prefs.summary && prefs.summary.trim().length > 0) return prefs.summary
  } catch {
    // fall through
  }
  return PREFERENCES_EMPTY
}

function personaCandidatePaths(): string[] {
  const paths = ['/app/persona/PERSONA.md']
  if (process.env.KEVIN_AUTOPILOT_PERSONA_PATH) {
    paths.unshift(process.env.KEVIN_AUTOPILOT_PERSONA_PATH)
  }
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    paths.push(join(here, '..', 'persona', PERSONA_FILE))
    paths.push(join(here, '..', '..', 'persona', PERSONA_FILE))
  } catch {
    // ignore — fall back to absolute /app path
  }
  return paths
}
