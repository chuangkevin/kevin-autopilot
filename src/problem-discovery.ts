import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { listBacklog, openBacklogDatabase } from './backlog.js'
import { listIdeas } from './ideas.js'
import { listSupplements } from './supplements.js'
import type {
  AutopilotConfig,
  BacklogItem,
  DailyProblemDiscovery,
  DailyProblemPick,
  ObservationReport,
  ProblemBrief,
  ProblemBriefConfidence,
  ProblemCandidateEvaluation,
  ProblemCandidateTier,
  ProblemFeedback,
  ProblemFeedbackAction,
  ProblemFeedbackSummary,
  RejectedProblemReason,
  RejectedProblemSummary,
  ProblemSignal,
  ProblemSignalSourceType,
} from './types.js'

const DAILY_PICK_FILE = 'daily-problem-pick.json'
const TAIPEI_TIME_ZONE = 'Asia/Taipei'
const MIN_SNIPPET_LENGTH = 16
const PROBLEM_FEEDBACK_ACTIONS: ProblemFeedbackAction[] = ['interesting', 'boring', 'not-a-problem', 'find-similar']

const WORKAROUND_TERMS = [
  'excel', 'google sheets', 'spreadsheet', 'line', '截圖', 'screenshot', '手動', '人工', 'copy/paste', '複製貼上', '紙本', '表單', '檔案', '轉檔', '平台', '命名',
]

const PAIN_TERMS = [
  '每次', '重複', '反覆', '卡', '痛', '麻煩', '混亂', '耗時', 'fragile', 'manual', 'workaround', 'wasting time', 'too expensive', 'too broad', '只能', '不知道',
]

const TECH_TERMS = [
  'llm', 'gpt', 'model', 'framework', 'kubernetes', 'vector db', 'protocol', 'mcp', 'react', 'next.js', 'startup idea', 'ai agent', 'foundation model',
]

const INTERNAL_ENGINEERING_TERMS = [
  'repo', 'repository', 'architecture', 'test', 'tests', 'ci', 'deploy', 'docker', 'worktree', 'branch', 'commit', 'pull request', 'github actions', 'openspec', 'agent handoff', 'handoff assistant',
]

const REAL_PERSON_WORKFLOW_TERMS = [
  'pm', '產品經理', '設計師', '設計稿', 'figma', 'prototype', 'ui', 'ux', '使用者', '客戶', 'customer', 'client', '車商', '業務', '創作者', '店家', '課程', '考試', '問卷', '公部門', '玩家', 'npc', 'excel', 'line', '截圖', '照片', '影片', '日記', '情緒', 'cad', 'onshape',
]

interface ProblemPattern {
  key: string
  title: string
  people: string
  workflow: string
  pain: string
  workaround: string
  existingSolutionsGap: string
  relatedProjects: string[]
  mvp: string
  validationPlan: string
  killCriteria: string[]
  kevinFitRationale: string
  severityRationale: string
}

export async function getDailyProblemDiscovery(
  config: AutopilotConfig,
  options: { force?: boolean; report?: ObservationReport; now?: Date } = {},
): Promise<DailyProblemDiscovery> {
  const now = options.now ?? new Date()
  const date = taipeiDateKey(now)
  const collected = await collectKevinOwnedSignals(config, options.report, now)
  await upsertProblemSignals(config, collected)
  const signals = await listProblemSignals(config)
  const existingBriefs = await listProblemBriefs(config)
  const briefs = buildProblemBriefs(signals, existingBriefs, now)
  await writeProblemBriefs(config, briefs)
  const feedback = await listProblemFeedback(config)
  const evaluations = evaluateProblemCandidates(briefs, feedback)
  const rejectedSummary = buildRejectedProblemSummary(signals, briefs)

  if (!options.force) {
    const stored = await readDailyPick(config)
    if (stored?.date === date) {
      const storedBrief = stored.briefId ? briefs.find((brief) => brief.id === stored.briefId) ?? null : null
      const storedEvaluation = stored.briefId ? evaluations.find((evaluation) => evaluation.briefId === stored.briefId) : undefined
      if (!(stored.status === 'picked' && (!storedBrief || isProblemCandidateDismissed(storedEvaluation)))) {
        return {
          date,
          generatedAt: stored.generatedAt,
          pick: stored,
          brief: storedBrief,
          briefs,
          evaluations,
          rejectedSummary,
          signalCount: signals.length,
        }
      }
    }
  }

  const pick = generateDailyProblemPick(date, briefs, now, evaluations)
  await writeDailyPick(config, pick)
  return {
    date,
    generatedAt: pick.generatedAt,
    pick,
    brief: pick.briefId ? briefs.find((brief) => brief.id === pick.briefId) ?? null : null,
    briefs,
    evaluations,
    rejectedSummary,
    signalCount: signals.length,
  }
}

export async function listProblemSignals(config: AutopilotConfig): Promise<ProblemSignal[]> {
  return readJsonRecords<ProblemSignal>(problemSignalsDir(config), isProblemSignal)
}

export async function listProblemBriefs(config: AutopilotConfig): Promise<ProblemBrief[]> {
  const records = await readJsonRecords<ProblemBrief>(problemBriefsDir(config), isProblemBrief)
  return records
    .filter((brief) => !isRejectedStoredProblemBrief(brief))
    .sort((a, b) => b.score - a.score || b.updatedAt.localeCompare(a.updatedAt))
}

export async function listProblemFeedback(config: AutopilotConfig): Promise<ProblemFeedback[]> {
  const records = await readJsonRecords<ProblemFeedback>(problemFeedbackDir(config), isProblemFeedback)
  return records.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
}

export async function recordProblemFeedback(
  config: AutopilotConfig,
  briefId: string,
  action: ProblemFeedbackAction,
  now: Date = new Date(),
): Promise<ProblemFeedback> {
  if (!isProblemFeedbackAction(action)) throw new Error(`unsupported problem feedback action: ${action}`)
  const dir = problemFeedbackDir(config)
  await mkdir(dir, { recursive: true })
  const day = taipeiDateKey(now)
  const id = `problem-feedback-${shortHash(`${briefId}:${action}:${day}`)}`
  const path = join(dir, `${id}.json`)
  try {
    const existing = JSON.parse(await readFile(path, 'utf8')) as unknown
    if (isProblemFeedback(existing)) return existing
  } catch {
    // Missing or malformed records are replaced by the deterministic current record.
  }
  const record: ProblemFeedback = {
    id,
    briefId,
    action,
    createdAt: now.toISOString(),
    source: 'trusted-dashboard',
  }
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  return record
}

export async function upsertProblemSignals(config: AutopilotConfig, signals: ProblemSignal[]): Promise<ProblemSignal[]> {
  const dir = problemSignalsDir(config)
  await mkdir(dir, { recursive: true })
  const existing = new Map((await listProblemSignals(config)).map((signal) => [signal.id, signal]))
  const written: ProblemSignal[] = []
  for (const signal of signals) {
    const previous = existing.get(signal.id)
    const record = previous && previous.snippet.length >= signal.snippet.length ? previous : signal
    await writeFile(join(dir, `${record.id}.json`), `${JSON.stringify(record, null, 2)}\n`, 'utf8')
    written.push(record)
  }
  return written
}

export function createProblemSignal(input: {
  sourceType: ProblemSignalSourceType
  sourceName: string
  title: string
  snippet: string
  fetchedAt?: string
  language?: string
  url?: string
  query?: string
}): ProblemSignal {
  const snippet = normalizeWhitespace(input.snippet).slice(0, 1200)
  const title = normalizeWhitespace(input.title).slice(0, 180) || 'Untitled problem signal'
  const dedupKey = normalizeKey([input.sourceType, input.sourceName, title, snippet.slice(0, 240)].join(' '))
  return {
    id: `signal-${shortHash(dedupKey)}`,
    sourceType: input.sourceType,
    sourceName: input.sourceName,
    title,
    snippet,
    fetchedAt: input.fetchedAt ?? new Date().toISOString(),
    dedupKey,
    ...(input.language ? { language: input.language } : {}),
    ...(input.url ? { url: input.url } : {}),
    ...(input.query ? { query: input.query } : {}),
  }
}

export function buildProblemBriefs(signals: ProblemSignal[], existingBriefs: ProblemBrief[] = [], now: Date = new Date()): ProblemBrief[] {
  const byKey = new Map<string, ProblemBrief>()
  for (const brief of existingBriefs) {
    if (!isRejectedStoredProblemBrief(brief)) byKey.set(brief.dedupKey, brief)
  }

  for (const signal of signals) {
    const pattern = extractProblemPattern(signal)
    if (!pattern) continue
    const existing = byKey.get(pattern.key)
    byKey.set(pattern.key, buildProblemBrief(pattern, signal, existing, now))
  }

  return [...byKey.values()].sort((a, b) => b.score - a.score || b.updatedAt.localeCompare(a.updatedAt))
}

export function generateDailyProblemPick(date: string, briefs: ProblemBrief[], now: Date = new Date(), evaluations: ProblemCandidateEvaluation[] = []): DailyProblemPick {
  const evaluationsByBrief = new Map(evaluations.map((evaluation) => [evaluation.briefId, evaluation]))
  const candidates = briefs
    .filter((brief) => !isProblemCandidateDismissed(evaluationsByBrief.get(brief.id)))
    .filter((brief) => brief.confidence !== 'needs_evidence' && brief.score >= 60)
    .sort((a, b) => (evaluationsByBrief.get(a.id)?.rank ?? 999) - (evaluationsByBrief.get(b.id)?.rank ?? 999) || b.score - a.score || b.evidence.length - a.evidence.length || a.title.localeCompare(b.title))
  const generatedAt = now.toISOString()
  if (candidates.length === 0) {
    return {
      date,
      status: 'insufficient-evidence',
      generatedAt,
      whyThis: '今天還沒有足夠真實問題證據；需要更多 people + workflow + pain + workaround 的來源片段。',
      whyNotOthers: briefs.slice(0, 3).map((brief) => `「${brief.title}」缺口：${brief.missingEvidence[0] ?? '需要更直接的使用者證據。'}`),
      missingEvidence: ['至少一則可稽核來源片段', '明確的人群與工作流', '目前怎麼硬撐的 workaround', '一個可在一週內驗證的 MVP'],
    }
  }

  const picked = candidates[0]
  return {
    date,
    status: 'picked',
    generatedAt,
    briefId: picked.id,
    whyThis: `它同時具備真實 workaround、Kevin-fit precedent、以及小 MVP 可驗證性；目前分數 ${picked.score}/100。`,
    whyNotOthers: candidates.slice(1, 4).map((brief) => `「${brief.title}」今天沒選：${brief.score}/100，${brief.missingEvidence[0] ?? '證據或驗證路徑較弱。'}`),
    missingEvidence: picked.missingEvidence,
  }
}

export function isProblemCandidateDismissed(evaluation: ProblemCandidateEvaluation | undefined): boolean {
  const feedback = evaluation?.feedbackSummary
  if (!feedback) return false
  return feedback.notAProblem > 0 || feedback.boring > feedback.interesting + feedback.findSimilar
}

export function evaluateProblemCandidates(briefs: ProblemBrief[], feedback: ProblemFeedback[] = []): ProblemCandidateEvaluation[] {
  const summaries = summarizeFeedback(feedback)
  return briefs
    .map((brief) => {
      const feedbackSummary = summaries.get(brief.id) ?? emptyFeedbackSummary()
      const feedbackDelta = scoreFeedback(brief, feedback.filter((item) => item.briefId === brief.id), feedbackSummary)
      const adjustedScore = brief.score + feedbackDelta
      const rejectionReasons = evaluationRejectionReasons(brief, feedbackSummary, adjustedScore)
      const tier = evaluationTier(brief, feedbackSummary, adjustedScore, rejectionReasons)
      return {
        brief,
        adjustedScore,
        evaluation: {
          briefId: brief.id,
          tier,
          rank: 0,
          rankingRationale: rankingRationale(brief, feedbackSummary, adjustedScore),
          strongestEvidence: strongestEvidence(brief),
          evidenceGap: brief.missingEvidence[0] ?? '已具備初步 people/workflow/pain/workaround，但仍需要真實樣本驗證。',
          nextValidationStep: brief.validationPlan,
          rejectionReasons,
          feedbackSummary,
        } satisfies ProblemCandidateEvaluation,
      }
    })
    .sort((a, b) => tierWeight(b.evaluation.tier) - tierWeight(a.evaluation.tier) || b.adjustedScore - a.adjustedScore || b.brief.score - a.brief.score || a.brief.title.localeCompare(b.brief.title))
    .map((entry, index) => ({ ...entry.evaluation, rank: index + 1 }))
}

export function buildRejectedProblemSummary(signals: ProblemSignal[], briefs: ProblemBrief[] = []): RejectedProblemSummary[] {
  const acceptedSignalIds = new Set(briefs.flatMap((brief) => brief.sourceSignalIds))
  const seenDedupKeys = new Set<string>()
  const byReason = new Map<RejectedProblemReason, { count: number; examples: RejectedProblemSummary['examples'] }>()
  for (const signal of signals) {
    let reason: RejectedProblemReason | undefined
    if (seenDedupKeys.has(signal.dedupKey)) reason = 'duplicate'
    seenDedupKeys.add(signal.dedupKey)
    if (!reason && acceptedSignalIds.has(signal.id)) continue
    reason = reason ?? rejectedReasonForSignal(signal)
    if (!reason) continue
    const current = byReason.get(reason) ?? { count: 0, examples: [] }
    current.count += 1
    if (current.examples.length < 3) {
      current.examples.push({ title: sanitizeRejectedTitle(signal.title), sourceType: signal.sourceType })
    }
    byReason.set(reason, current)
  }
  return [...byReason.entries()]
    .map(([reason, value]) => ({ reason, count: value.count, examples: value.examples }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
}

export function createProblemBriefPrompt(brief: ProblemBrief): string {
  return [
    `Research/spec a small Kevin-fit prototype opportunity for this real-world workflow pain: ${brief.title}`,
    '',
    'Constraints:',
    '- Do not create repositories, deploy services, spend money, contact external users, read secrets, or mutate target projects unless Kevin explicitly approves a later gate.',
    '- Stay in read-only research/spec/prototype-planning mode.',
    '- Preserve provenance and call out missing evidence instead of inventing certainty.',
    '',
    `People: ${brief.people}`,
    `Workflow: ${brief.workflow}`,
    `Pain: ${brief.pain}`,
    `Current workaround: ${brief.workaround}`,
    `Existing solution gap: ${brief.existingSolutionsGap}`,
    `Kevin fit: ${brief.kevinFit.rationale}`,
    `Small MVP: ${brief.mvp}`,
    `Validation plan: ${brief.validationPlan}`,
    `Kill criteria: ${brief.killCriteria.join('; ')}`,
    '',
    'Evidence:',
    ...brief.evidence.slice(0, 5).map((entry) => `- ${entry.sourceName}: ${entry.quote}${entry.url ? ` (${entry.url})` : ''}`),
    '',
    'Required output:',
    '1. Confirm or reject the problem framing.',
    '2. List the smallest artifact Kevin could build first.',
    '3. Define concrete validation steps and evidence needed.',
    '4. List approval gates before any repo creation, deployment, paid API, outreach, or mutation.',
  ].join('\n')
}

function summarizeFeedback(feedback: ProblemFeedback[]): Map<string, ProblemFeedbackSummary> {
  const byBrief = new Map<string, ProblemFeedbackSummary>()
  for (const item of feedback) {
    const summary = byBrief.get(item.briefId) ?? emptyFeedbackSummary()
    if (item.action === 'interesting') summary.interesting += 1
    else if (item.action === 'boring') summary.boring += 1
    else if (item.action === 'not-a-problem') summary.notAProblem += 1
    else if (item.action === 'find-similar') summary.findSimilar += 1
    byBrief.set(item.briefId, summary)
  }
  return byBrief
}

function emptyFeedbackSummary(): ProblemFeedbackSummary {
  return { interesting: 0, boring: 0, notAProblem: 0, findSimilar: 0 }
}

function scoreFeedback(brief: ProblemBrief, records: ProblemFeedback[], summary: ProblemFeedbackSummary): number {
  const positive = summary.interesting * 8 + summary.findSimilar * 6
  let negative = summary.boring * 9 + summary.notAProblem * 18
  if (negative > 0 && hasNewEvidenceAfterNegativeFeedback(brief, records)) negative = Math.round(negative * 0.35)
  return positive - negative
}

function hasNewEvidenceAfterNegativeFeedback(brief: ProblemBrief, records: ProblemFeedback[]): boolean {
  const negativeFeedbackAt = records
    .filter((item) => item.action === 'boring' || item.action === 'not-a-problem')
    .map((item) => item.createdAt)
    .sort()
    .at(-1)
  if (!negativeFeedbackAt) return false
  return brief.evidence.some((entry) => entry.fetchedAt > negativeFeedbackAt) || (brief.evidence.length >= 2 && brief.score >= 75)
}

function evaluationTier(brief: ProblemBrief, feedback: ProblemFeedbackSummary, adjustedScore: number, rejectionReasons: string[]): ProblemCandidateTier {
  if (rejectionReasons.length > 0 && (adjustedScore < 70 || (feedback.notAProblem > 0 && adjustedScore < 65))) return 'not_now'
  if (adjustedScore >= 70 && brief.validationPlan.length > 20 && brief.workaround !== '尚未看到明確 workaround') return 'worth_chasing'
  return 'needs_evidence'
}

function evaluationRejectionReasons(brief: ProblemBrief, feedback: ProblemFeedbackSummary, adjustedScore: number): string[] {
  const reasons: string[] = []
  if (brief.people === '非工程使用者' || brief.people.length < 2) reasons.push('missing-people')
  if (brief.workflow.length < 8) reasons.push('missing-workflow')
  if (brief.workaround === '尚未看到明確 workaround') reasons.push('missing-workaround')
  if (adjustedScore < 55 || brief.confidence === 'needs_evidence') reasons.push('low-signal')
  if (feedback.boring > 0 && adjustedScore < 70) reasons.push('boring-feedback')
  if (feedback.notAProblem > 0 && adjustedScore < 65) reasons.push('not-a-problem-feedback')
  return [...new Set(reasons)]
}

function rankingRationale(brief: ProblemBrief, feedback: ProblemFeedbackSummary, adjustedScore: number): string {
  const feedbackNote = feedback.interesting + feedback.findSimilar > 0
    ? ` Kevin feedback 有正向訊號 ${feedback.interesting + feedback.findSimilar} 筆。`
    : feedback.boring + feedback.notAProblem > 0
      ? ` Kevin feedback 有降權訊號 ${feedback.boring + feedback.notAProblem} 筆。`
      : ''
  return `基礎分 ${brief.score}/100，回饋後約 ${Math.max(0, Math.min(100, adjustedScore))}/100；${brief.severity.rationale}${feedbackNote}`
}

function strongestEvidence(brief: ProblemBrief): string {
  const evidence = brief.evidence[0]
  if (!evidence) return '尚未有可稽核 evidence；需要補真實來源片段。'
  return `${evidence.sourceName}: ${normalizeWhitespace(evidence.quote).slice(0, 180)}`
}

function tierWeight(tier: ProblemCandidateTier): number {
  if (tier === 'worth_chasing') return 3
  if (tier === 'needs_evidence') return 2
  return 1
}

function rejectedReasonForSignal(signal: ProblemSignal): RejectedProblemReason | undefined {
  const text = `${signal.title} ${signal.snippet}`
  const lower = text.toLowerCase()
  const matchedWorkarounds = WORKAROUND_TERMS.filter((term) => lower.includes(term.toLowerCase()))
  const hasPain = PAIN_TERMS.some((term) => lower.includes(term.toLowerCase()))
  const hasTech = TECH_TERMS.some((term) => lower.includes(term.toLowerCase()))
  const category = detectCategory(lower)
  if (isInternalEngineeringOnlySignal(lower)) return 'internal-engineering'
  if (hasTech && !category && !hasPain && matchedWorkarounds.length === 0) return 'tech-only'
  if (!category && !hasLikelyPeople(lower)) return 'missing-people'
  if (!category && !hasLikelyWorkflow(lower)) return 'missing-workflow'
  if (!category && matchedWorkarounds.length === 0) return 'missing-workaround'
  return 'low-signal'
}

function hasLikelyPeople(lower: string): boolean {
  return REAL_PERSON_WORKFLOW_TERMS.some((term) => includesWorkflowTerm(lower, term)) || /(user|customer|client|使用者|客戶|業務|創作者|店家|玩家|pm)/i.test(lower)
}

function hasLikelyWorkflow(lower: string): boolean {
  return /(流程|workflow|整理|刊登|上傳|下載|回報|表單|剪輯|prototype|管理|記錄|搜尋|追蹤|維護|轉檔)/i.test(lower)
}

function sanitizeRejectedTitle(title: string): string {
  return normalizeWhitespace(title).slice(0, 72) || 'untitled rejected signal'
}

async function collectKevinOwnedSignals(config: AutopilotConfig, report: ObservationReport | undefined, now: Date): Promise<ProblemSignal[]> {
  const fetchedAt = now.toISOString()
  const [ideas, supplements] = await Promise.all([
    listIdeas(config, 40).catch(() => []),
    listSupplements(config, 20).catch(() => []),
  ])
  const signals: ProblemSignal[] = []
  for (const idea of ideas) {
    signals.push(createProblemSignal({
      sourceType: 'kevin-input',
      sourceName: `idea:${idea.id}`,
      title: idea.title,
      snippet: idea.rawText,
      fetchedAt: idea.createdAt || fetchedAt,
      language: 'zh-Hant',
    }))
  }
  for (const supplement of supplements) {
    signals.push(createProblemSignal({
      sourceType: 'kevin-input',
      sourceName: `supplement:${supplement.id}`,
      title: supplement.summary,
      snippet: supplement.rawText,
      fetchedAt: supplement.createdAt || fetchedAt,
      language: 'zh-Hant',
    }))
  }
  for (const item of listBacklogSnapshot(config)) {
    signals.push(signalFromBacklog(item, fetchedAt))
  }
  if (report) {
    for (const candidate of report.candidates) {
      signals.push(createProblemSignal({
        sourceType: 'homeproject',
        sourceName: `observation:${candidate.sourceName}`,
        title: candidate.title,
        snippet: [candidate.actualBehavior, candidate.expectedBehavior, candidate.suggestedNextStep, ...candidate.evidence].join(' '),
        fetchedAt: report.generatedAt,
        language: 'zh-Hant',
      }))
    }
  }
  return signals.filter((signal) => signal.snippet.length >= MIN_SNIPPET_LENGTH)
}

function signalFromBacklog(item: BacklogItem, fetchedAt: string): ProblemSignal {
  return createProblemSignal({
    sourceType: 'homeproject',
    sourceName: `backlog:${item.sourceName}`,
    title: item.title,
    snippet: [item.summary, ...item.evidence, ...(item.prevEvidence ?? [])].join(' '),
    fetchedAt: item.lastSeenAt || fetchedAt,
    language: 'zh-Hant',
  })
}

function extractProblemPattern(signal: ProblemSignal): ProblemPattern | undefined {
  const text = `${signal.title} ${signal.snippet}`
  const lower = text.toLowerCase()
  if (isInternalEngineeringOnlySignal(lower)) return undefined
  const matchedWorkarounds = WORKAROUND_TERMS.filter((term) => lower.includes(term.toLowerCase()))
  const hasPain = PAIN_TERMS.some((term) => lower.includes(term.toLowerCase()))
  const hasTech = TECH_TERMS.some((term) => lower.includes(term.toLowerCase()))
  const category = detectCategory(lower)
  if (hasTech && !category && !hasPain && matchedWorkarounds.length === 0) return undefined
  if (!category && !hasPain && matchedWorkarounds.length === 0) return undefined

  if (category === 'car-listing') return carListingPattern(signal, matchedWorkarounds)
  if (category === 'media') return mediaPattern(signal, matchedWorkarounds)
  if (category === 'bureaucracy') return bureaucracyPattern(signal, matchedWorkarounds)
  if (category === 'pm-prototype') return pmPrototypePattern(signal, matchedWorkarounds)
  if (category === 'calm-pkm') return calmPkmPattern(signal, matchedWorkarounds)
  if (category === 'memory') return memoryPattern(signal, matchedWorkarounds)
  if (category === 'cad') return cadPattern(signal, matchedWorkarounds)
  if (category === 'living-world') return livingWorldPattern(signal, matchedWorkarounds)

  return genericManualWorkflowPattern(signal, matchedWorkarounds)
}

function buildProblemBrief(pattern: ProblemPattern, signal: ProblemSignal, existing: ProblemBrief | undefined, now: Date): ProblemBrief {
  const evidence = mergeEvidence(existing?.evidence ?? [], {
    signalId: signal.id,
    quote: signal.snippet,
    sourceName: signal.sourceName,
    fetchedAt: signal.fetchedAt,
    ...(signal.url ? { url: signal.url } : {}),
  })
  const evidenceScore = Math.min(100, evidence.length * 35 + (evidence.some((entry) => entry.url) ? 10 : 0))
  const workaroundScore = pattern.workaround === '尚未看到明確 workaround' ? 35 : 80
  const severityScore = Math.min(100, pattern.severityRationale.includes('重複') || pattern.severityRationale.includes('manual') ? 82 : 68)
  const kevinFitScore = pattern.relatedProjects.length > 0 ? 88 : 68
  const validationScore = pattern.validationPlan.length > 20 ? 80 : 45
  const score = Math.round(evidenceScore * 0.2 + severityScore * 0.25 + kevinFitScore * 0.25 + workaroundScore * 0.15 + validationScore * 0.15)
  const missingEvidence = createMissingEvidence(evidence, pattern)
  const confidence: ProblemBriefConfidence = score >= 75 && evidence.length >= 2 ? 'strong' : score >= 60 ? 'candidate' : 'needs_evidence'
  const createdAt = existing?.createdAt ?? now.toISOString()
  const sourceSignalIds = [...new Set([...(existing?.sourceSignalIds ?? []), signal.id])]
  return {
    id: `problem-${shortHash(pattern.key)}`,
    dedupKey: pattern.key,
    title: pattern.title,
    people: pattern.people,
    workflow: pattern.workflow,
    pain: pattern.pain,
    workaround: pattern.workaround,
    evidence,
    existingSolutionsGap: pattern.existingSolutionsGap,
    severity: { score: severityScore, rationale: pattern.severityRationale },
    kevinFit: { score: kevinFitScore, rationale: pattern.kevinFitRationale, relatedProjects: pattern.relatedProjects },
    mvp: pattern.mvp,
    validationPlan: pattern.validationPlan,
    killCriteria: pattern.killCriteria,
    missingEvidence,
    confidence,
    score,
    createdAt,
    updatedAt: now.toISOString(),
    sourceSignalIds,
  }
}

function detectCategory(lower: string): ProblemPattern['key'] | undefined {
  if (/(車商|中古車|車輛|8891|刊登|車照|listing|marketplace)/i.test(lower)) return 'car-listing'
  if (/(短影音|影片|剪輯|字幕|素材|reels|shorts|content|media)/i.test(lower)) return 'media'
  if (/(課程|考試|問卷|elearn|公部門|官僚|訓練|平台限制)/i.test(lower)) return 'bureaucracy'
  if (hasPmPrototypeContext(lower)) return 'pm-prototype'
  if (/(calm computing|screenless|digital overwhelm|bionic persona|pkm|個人知識|知識管理|數位干擾|螢幕焦慮|仿生人格|筆記軟體)/i.test(lower)) return 'calm-pkm'
  if (/(日記|情緒|記憶|回想|心理|memory|diary)/i.test(lower)) return 'memory'
  if (/(cad|onshape|3d|照片建模|量測|工程圖|零件)/i.test(lower)) return 'cad'
  if (/(遊戲|世界|規則|npc|任務|living world|greed island)/i.test(lower)) return 'living-world'
  return undefined
}

function hasPmPrototypeContext(lower: string): boolean {
  return /(pm|產品經理|設計師|設計稿|figma|prototype|clickable|\bui\b|\bux\b|畫面|截圖標註|設計需求)/i.test(lower) &&
    /(需求|spec|規格|prototype|figma|截圖|畫面|ui|ux|原型)/i.test(lower)
}

function isInternalEngineeringOnlySignal(lower: string): boolean {
  const hasInternalEngineering = INTERNAL_ENGINEERING_TERMS_SAFE.some((term) => includesTerm(lower, term))
  if (!hasInternalEngineering) return false
  const hasRealWorkflow = REAL_PERSON_WORKFLOW_TERMS.some((term) => includesWorkflowTerm(lower, term))
  if (hasRealWorkflow) return false
  return true
}

const INTERNAL_ENGINEERING_TERMS_SAFE = INTERNAL_ENGINEERING_TERMS.map((term) => term.toLowerCase())

function includesWorkflowTerm(lower: string, term: string): boolean {
  const normalized = term.toLowerCase()
  if (normalized === 'pm' || normalized === 'ui' || normalized === 'ux') {
    return includesTerm(lower, normalized)
  }
  return lower.includes(normalized)
}

function includesTerm(lower: string, normalized: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(normalized)}([^a-z0-9]|$)`, 'i').test(lower)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isRejectedStoredProblemBrief(brief: ProblemBrief): boolean {
  const evidenceText = brief.evidence.map((entry) => entry.quote).join(' ').toLowerCase()
  return evidenceText.length > 0 && isInternalEngineeringOnlySignal(evidenceText)
}

function carListingPattern(signal: ProblemSignal, workarounds: string[]): ProblemPattern {
  return {
    key: 'car-listing-ops',
    title: '車商刊登流程被照片、表格與多平台手動搬運拖慢',
    people: '中古車業務與車商營運人員',
    workflow: '把車輛資料、照片、影音素材整理後刊登到官網、8891、Facebook 等平台',
    pain: signal.snippet,
    workaround: workaroundText(workarounds, 'Excel/Google Sheets、LINE、截圖、手動複製貼上與多平台切換'),
    existingSolutionsGap: '通用 CRM 或上架工具常太重，無法貼合台灣車商照片、規格、平台欄位與臨時溝通流程。',
    relatedProjects: ['sheet-to-car', 'frame-processor'],
    mvp: '做一個可匯入車輛表格與照片資料夾的小看板，輸出各平台欄位與照片檢查清單。',
    validationPlan: '用 5 台真實車輛資料重跑一次刊登前整理流程，比較人工整理時間與漏欄位數。',
    killCriteria: ['車商其實已有低摩擦工具覆蓋主要流程', '5 台車測試無法節省至少 30% 整理時間'],
    kevinFitRationale: '直接命中 Kevin 已做過的車商資料整理、照片處理與刊登流程轉換模式。',
    severityRationale: '流程重複、手動搬運多、錯漏會直接影響刊登速度與成交機會。',
  }
}

function mediaPattern(signal: ProblemSignal, workarounds: string[]): ProblemPattern {
  return {
    key: 'media-production-ops',
    title: '非專業創作者被短影音素材整理與剪輯前處理卡住',
    people: '小型品牌、店家與非專業內容製作者',
    workflow: '把照片、影片、腳本與字幕整理成可發布的短影音素材',
    pain: signal.snippet,
    workaround: workaroundText(workarounds, '手動挑素材、轉檔、截圖、命名與在剪輯工具間切換'),
    existingSolutionsGap: '大型剪輯工具功能太多，AI 生成工具又常不懂既有素材與發布節奏。',
    relatedProjects: ['media-processor'],
    mvp: '做一個資料夾 dropzone，先自動整理素材、產生片段清單與字幕草稿。',
    validationPlan: '拿一批真實素材做 3 支短片前處理，量測從素材到可剪輯草稿的時間。',
    killCriteria: ['現成工具已能在同等成本下完成整理與草稿', '使用者不願改變素材交付方式'],
    kevinFitRationale: '符合 Kevin 把非專家內容製作流程變成可操作 pipeline 的既有方向。',
    severityRationale: '短影音生產頻率高，前處理重複且容易因檔案混亂拖慢發布。',
  }
}

function bureaucracyPattern(signal: ProblemSignal, workarounds: string[]): ProblemPattern {
  return {
    key: 'bureaucratic-platform-automation',
    title: '低價值平台課程/表單流程消耗大量人工注意力',
    people: '被要求完成線上課程、考試、問卷或公部門平台流程的人',
    workflow: '登入平台、觀看內容、答題、填問卷並留下完成證明',
    pain: signal.snippet,
    workaround: workaroundText(workarounds, '手動點擊、截圖存證、重複輸入與用記憶追蹤進度'),
    existingSolutionsGap: '平台通常只服務管理端，沒有替實際執行者減少低價值重複操作。',
    relatedProjects: ['auto-elearn'],
    mvp: '做一個 read-only 流程紀錄器，先整理步驟、截圖與完成狀態，再評估可自動化範圍。',
    validationPlan: '挑一個真實課程/問卷流程，紀錄完成時間、重複點擊次數與出錯點。',
    killCriteria: ['流程很少重複或時間成本低', '平台條款不允許任何輔助自動化且沒有手動整理價值'],
    kevinFitRationale: '貼近 Kevin 曾把消防課程與考試問卷變成可觀測、自動化流程的模式。',
    severityRationale: '流程通常低價值但強制、重複，容易浪費整段注意力。',
  }
}

function pmPrototypePattern(signal: ProblemSignal, workarounds: string[]): ProblemPattern {
  return {
    key: 'pm-spec-to-prototype',
    title: 'PM/設計需求在文字、截圖與工程語言之間轉譯太慢',
    people: 'PM、設計師與需要快速對齊 UI 的工程團隊',
    workflow: '把模糊需求、截圖、Figma 註解或規格文字變成可討論的 prototype',
    pain: signal.snippet,
    workaround: workaroundText(workarounds, '截圖標註、文件來回、手動重畫與工程師口頭補洞'),
    existingSolutionsGap: '通用設計/規格工具不能直接把脈絡轉成可跑 artifact，也不會保留工程可驗證條件。',
    relatedProjects: ['project-bridge'],
    mvp: '做一個 spec-to-screen 草稿產生器，輸入需求與截圖後輸出單頁可點 prototype。',
    validationPlan: '用 3 個真實需求比較從需求到第一版 clickable UI 的時間與來回次數。',
    killCriteria: ['PM/設計已有足夠快的 prototype 流程', '產出的 UI 草稿無法讓討論更具體'],
    kevinFitRationale: '符合 Kevin 讓抽象需求快速變成可跑 artifact、用實物討論的偏好。',
    severityRationale: '需求轉譯一旦反覆，會拖慢整個產品迭代並製造錯誤理解。',
  }
}

function memoryPattern(signal: ProblemSignal, workarounds: string[]): ProblemPattern {
  return {
    key: 'personal-memory-chaos',
    title: '個人情緒與記憶資料散落，回想與整理成本太高',
    people: '想追蹤情緒、記憶、生活脈絡與自我反思的人',
    workflow: '記錄事件、情緒、對話與回想線索，之後能搜尋與整理',
    pain: signal.snippet,
    workaround: workaroundText(workarounds, '日記、截圖、聊天紀錄、手動標籤與靠記憶回想'),
    existingSolutionsGap: '筆記/日記工具會保存資料，但通常不會主動整理脈絡、情緒與可追問線索。',
    relatedProjects: ['mind-diary'],
    mvp: '做一個只吃文字/截圖的私人 inbox，先抽事件、情緒、人物與可追問問題。',
    validationPlan: '用一週真實輸入測試是否能更快找回某段情緒或事件脈絡。',
    killCriteria: ['使用者不願持續輸入', '整理結果沒有降低回想或理解成本'],
    kevinFitRationale: '延續 Kevin 把記憶與情緒混亂變成可搜尋、可追問系統的方向。',
    severityRationale: '資料分散且情緒成本高，問題不只耗時，也會影響決策與自我理解。',
  }
}

function calmPkmPattern(signal: ProblemSignal, workarounds: string[]): ProblemPattern {
  return {
    key: 'calm-personal-knowledge',
    title: '個人知識與生活資訊被螢幕和工具碎片化拖累',
    people: '想減少數位干擾、又需要管理知識與生活脈絡的人',
    workflow: '把筆記、檔案、專案資訊與生活提醒整理成低干擾、可回想、可行動的個人知識流程',
    pain: signal.snippet,
    workaround: workaroundText(workarounds, '筆記軟體、檔案系統、專案管理工具、生活助理與手動整理脈絡'),
    existingSolutionsGap: '一般 PKM 或專案工具需要大量螢幕操作與整理紀律；calm device 又常只做提醒，沒有真正承接知識脈絡。',
    relatedProjects: ['mind-diary', 'digital-photo-frame'],
    mvp: '做一個低干擾 inbox：每天只收少量文字/提醒/截圖，輸出一張可回想的生活與知識摘要卡。',
    validationPlan: '用一週真實輸入測試是否能減少開螢幕查找、整理與回想的次數，同時保留可行動事項。',
    killCriteria: ['使用者仍需要完整 PKM 介面才覺得有用', '一週測試沒有降低查找或整理負擔', '低干擾硬體形式比手機/桌面 widget 更麻煩'],
    kevinFitRationale: '貼近 Kevin 對個人記憶、生活脈絡、低干擾裝置與可跑 artifact 的長期興趣。',
    severityRationale: '數位干擾與知識碎片化會反覆消耗注意力，問題不只是一個工具功能，而是日常 workflow 負擔。',
  }
}

function cadPattern(signal: ProblemSignal, workarounds: string[]): ProblemPattern {
  return {
    key: 'photo-video-to-cad',
    title: '照片/影片到 CAD 量測與建模的轉換太手工',
    people: '需要從現物、照片或影片快速做零件判斷與 CAD 草圖的人',
    workflow: '從影像描述、量測線索與零件需求整理出 CAD 或工程圖 artifact',
    pain: signal.snippet,
    workaround: workaroundText(workarounds, '手動量測、截圖標線、口頭描述與在 CAD 工具重建'),
    existingSolutionsGap: '專業 CAD 工具強在建模，但不擅長把非結構化影像與口語需求先轉成可建模線索。',
    relatedProjects: ['onshape-skill'],
    mvp: '做一個影像備註表，先讓使用者標註尺寸假設並輸出 Onshape 建模步驟。',
    validationPlan: '用 3 個簡單零件照片測試是否能產生足夠明確的建模任務。',
    killCriteria: ['尺寸不確定性高到無法形成有用草稿', '手動 CAD 重建仍比整理工具快'],
    kevinFitRationale: '符合 Kevin 從照片/影片/描述轉成 CAD artifact 的現有探索。',
    severityRationale: '影像到 CAD 的資訊斷層會讓非 CAD 專家無法把需求變成工程 artifact。',
  }
}

function livingWorldPattern(signal: ProblemSignal, workarounds: string[]): ProblemPattern {
  return {
    key: 'living-world-rules',
    title: '動態世界規則與任務狀態難以維持一致',
    people: '想經營長期世界、NPC、任務與規則系統的創作者或玩家',
    workflow: '維護角色狀態、規則、任務事件與世界變化，讓世界像真的活著',
    pain: signal.snippet,
    workaround: workaroundText(workarounds, '手動筆記、表格、規則文件、聊天紀錄與人工裁定'),
    existingSolutionsGap: '一般遊戲或筆記工具能記錄內容，但不會把規則、狀態與行為後果持續運算。',
    relatedProjects: ['greed-island'],
    mvp: '做一個小型規則/狀態 engine，先支援 5 個 NPC、10 條規則與事件 log。',
    validationPlan: '跑一週微型世界事件，檢查狀態一致性與是否能產生有趣後果。',
    killCriteria: ['規則維護成本高於創作樂趣', '狀態 engine 無法產生比手寫筆記更有用的連續性'],
    kevinFitRationale: '符合 Kevin 想做真實 living world，而不是靜態遊戲殼的方向。',
    severityRationale: '長期世界越大，人工維護一致性越容易崩潰。',
  }
}

function genericManualWorkflowPattern(signal: ProblemSignal, workarounds: string[]): ProblemPattern | undefined {
  const people = inferPeople(signal.snippet)
  const workflow = inferWorkflow(signal.snippet)
  if (!people || !workflow) return undefined
  return {
    key: normalizeKey(`manual-workflow ${people} ${workflow}`),
    title: `${people}在「${workflow}」流程中靠人工 workaround 硬撐`,
    people,
    workflow,
    pain: signal.snippet,
    workaround: workaroundText(workarounds, '手動整理、Excel/LINE/截圖/複製貼上的臨時流程'),
    existingSolutionsGap: '現有工具可能太通用或太重，沒有貼合這個窄流程的資料整理與驗證節點。',
    relatedProjects: [],
    mvp: '先做一頁式流程 inbox，把輸入、欄位、狀態與輸出整理成可重跑清單。',
    validationPlan: '找一組真實樣本重跑流程，量測整理時間、漏項與來回次數是否下降。',
    killCriteria: ['流程不重複', '人工 workaround 已足夠快', '找不到願意提供真實樣本的人'],
    kevinFitRationale: '符合 Kevin 先整理混亂資料/流程，再用小 artifact 驗證自動化價值的模式。',
    severityRationale: '訊號包含手動 workaround 或重複流程，可能有可被小工具移除的操作成本。',
  }
}

function workaroundText(workarounds: string[], fallback: string): string {
  return workarounds.length > 0 ? [...new Set(workarounds)].slice(0, 5).join(' / ') : fallback
}

function inferPeople(snippet: string): string | undefined {
  const first = normalizeWhitespace(snippet).split(/[，,。.!？?]/)[0] ?? ''
  const match = first.match(/^(.{2,24}?)(?:每次|需要|只能|用|靠|在|要|會)/u)
  if (match?.[1]) return match[1].trim()
  if (/user|customer|client/i.test(snippet)) return '一般使用者'
  if (snippet.length >= MIN_SNIPPET_LENGTH) return '非工程使用者'
  return undefined
}

function inferWorkflow(snippet: string): string | undefined {
  if (/報表|表格|excel|spreadsheet/i.test(snippet)) return '表格資料整理與回報'
  if (/截圖|screenshot/i.test(snippet)) return '截圖與證據傳遞'
  if (/line|訊息|聊天/i.test(snippet)) return '訊息溝通與任務追蹤'
  if (/上傳|下載|轉檔|file/i.test(snippet)) return '檔案轉換與平台搬運'
  return normalizeWhitespace(snippet).slice(0, 32)
}

function createMissingEvidence(evidence: ProblemBrief['evidence'], pattern: ProblemPattern): string[] {
  const missing: string[] = []
  if (evidence.length < 2) missing.push('需要第二個獨立訊號確認這不是單次抱怨。')
  if (pattern.workaround === '尚未看到明確 workaround') missing.push('需要知道使用者現在怎麼硬撐。')
  missing.push('需要真實樣本或訪談來驗證 MVP 是否能縮短流程。')
  return missing
}

function mergeEvidence(existing: ProblemBrief['evidence'], next: ProblemBrief['evidence'][number]): ProblemBrief['evidence'] {
  const bySignal = new Map(existing.map((entry) => [entry.signalId, entry]))
  bySignal.set(next.signalId, next)
  return [...bySignal.values()].sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt)).slice(0, 8)
}

async function writeProblemBriefs(config: AutopilotConfig, briefs: ProblemBrief[]): Promise<void> {
  const dir = problemBriefsDir(config)
  await mkdir(dir, { recursive: true })
  await Promise.all(briefs.map((brief) => writeFile(join(dir, `${brief.id}.json`), `${JSON.stringify(brief, null, 2)}\n`, 'utf8')))
}

async function writeDailyPick(config: AutopilotConfig, pick: DailyProblemPick): Promise<void> {
  await mkdir(config.dataDir, { recursive: true })
  await writeFile(join(config.dataDir, DAILY_PICK_FILE), `${JSON.stringify(pick, null, 2)}\n`, 'utf8')
}

async function readDailyPick(config: AutopilotConfig): Promise<DailyProblemPick | undefined> {
  try {
    const parsed = JSON.parse(await readFile(join(config.dataDir, DAILY_PICK_FILE), 'utf8')) as unknown
    return isDailyProblemPick(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

async function readJsonRecords<T>(dir: string, guard: (value: unknown) => value is T): Promise<T[]> {
  try {
    await mkdir(dir, { recursive: true })
    const files = (await readdir(dir)).filter((file) => file.endsWith('.json')).sort()
    const records: T[] = []
    for (const file of files) {
      try {
        const parsed = JSON.parse(await readFile(join(dir, file), 'utf8')) as unknown
        if (guard(parsed)) records.push(parsed)
      } catch {
        continue
      }
    }
    return records
  } catch {
    return []
  }
}

function listBacklogSnapshot(config: AutopilotConfig): BacklogItem[] {
  const db = openBacklogDatabase(config)
  try {
    return listBacklog(db, 'all', new Date())
  } finally {
    db.close()
  }
}

function problemSignalsDir(config: AutopilotConfig): string {
  return join(config.dataDir, 'problem-signals')
}

function problemBriefsDir(config: AutopilotConfig): string {
  return join(config.dataDir, 'problem-briefs')
}

function problemFeedbackDir(config: AutopilotConfig): string {
  return join(config.dataDir, 'problem-feedback')
}

function taipeiDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TAIPEI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00'
  return `${get('year')}-${get('month')}-${get('day')}`
}

function isProblemSignal(value: unknown): value is ProblemSignal {
  return Boolean(value && typeof value === 'object' &&
    typeof (value as ProblemSignal).id === 'string' &&
    typeof (value as ProblemSignal).sourceType === 'string' &&
    typeof (value as ProblemSignal).sourceName === 'string' &&
    typeof (value as ProblemSignal).title === 'string' &&
    typeof (value as ProblemSignal).snippet === 'string' &&
    typeof (value as ProblemSignal).fetchedAt === 'string')
}

function isProblemBrief(value: unknown): value is ProblemBrief {
  return Boolean(value && typeof value === 'object' &&
    typeof (value as ProblemBrief).id === 'string' &&
    typeof (value as ProblemBrief).dedupKey === 'string' &&
    typeof (value as ProblemBrief).title === 'string' &&
    Array.isArray((value as ProblemBrief).evidence) &&
    typeof (value as ProblemBrief).score === 'number')
}

function isProblemFeedback(value: unknown): value is ProblemFeedback {
  return Boolean(value && typeof value === 'object' &&
    typeof (value as ProblemFeedback).id === 'string' &&
    typeof (value as ProblemFeedback).briefId === 'string' &&
    isProblemFeedbackAction((value as ProblemFeedback).action) &&
    typeof (value as ProblemFeedback).createdAt === 'string' &&
    (value as ProblemFeedback).source === 'trusted-dashboard')
}

export function isProblemFeedbackAction(value: unknown): value is ProblemFeedbackAction {
  return typeof value === 'string' && (PROBLEM_FEEDBACK_ACTIONS as string[]).includes(value)
}

function isDailyProblemPick(value: unknown): value is DailyProblemPick {
  if (!value || typeof value !== 'object') return false
  const pick = value as DailyProblemPick
  if (pick.status === 'picked' && typeof pick.briefId !== 'string') return false
  return Boolean(
    typeof (value as DailyProblemPick).date === 'string' &&
    typeof (value as DailyProblemPick).generatedAt === 'string' &&
    (pick.status === 'picked' || pick.status === 'insufficient-evidence'),
  )
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function normalizeKey(value: string): string {
  return normalizeWhitespace(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-')
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}
