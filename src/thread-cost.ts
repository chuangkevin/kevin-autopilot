import type { ProblemBrief, ProblemCandidateEvaluation, Thread, ThreadCost, ThreadCostLevel, ThreadCounterfactual } from './types.js'

export function briefToThread(brief: ProblemBrief, evaluation?: ProblemCandidateEvaluation): Thread {
  const cost = computeCost(brief, evaluation)
  return {
    id: brief.id,
    name: brief.title,
    people: brief.people,
    status: brief.evidence.length >= 2 ? 'active' : 'stale',
    momentum: hasRecentEvidence(brief) ? 'rising' : 'stable',
    cost,
    dependencies: brief.missingEvidence.slice(0, 3),
    counterfactual: generateCounterfactual(brief, cost),
  }
}

export function briefsToThreads(briefs: ProblemBrief[], evaluations: ProblemCandidateEvaluation[] = []): Thread[] {
  const evalMap = new Map(evaluations.map((e) => [e.briefId, e]))
  return briefs.map((b) => briefToThread(b, evalMap.get(b.id)))
}

function hasRecentEvidence(brief: ProblemBrief): boolean {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  return brief.evidence.some((e) => e.fetchedAt > oneDayAgo)
}

function computeCost(brief: ProblemBrief, evaluation?: ProblemCandidateEvaluation): ThreadCost {
  const missingCount = brief.missingEvidence.length
  const familiarDomain = brief.kevinFit.relatedProjects.length > 0

  const timeCost = clamp(
    0.40
    + (missingCount * 0.12)
    + (brief.score >= 70 ? 0.12 : 0)
    + (brief.mvp.length > 120 ? 0.08 : 0),
  )

  const cognitiveLoad = clamp(
    (brief.confidence === 'needs_evidence' ? 0.72 : brief.confidence === 'candidate' ? 0.52 : 0.32)
    + (missingCount * 0.08)
    - (familiarDomain ? 0.10 : 0),
  )

  const executionRisk = clamp(
    brief.confidence === 'needs_evidence' ? 0.82
      : brief.confidence === 'candidate' ? 0.55
        : brief.evidence.length >= 3 ? 0.25 : 0.42,
  )

  const feedbackBoost = evaluation ? (evaluation.feedbackSummary.interesting * 0.04) : 0
  const opportunityCost = clamp(
    (brief.score / 100) * 0.85
    + (brief.kevinFit.score / 100) * 0.15
    + feedbackBoost,
  )

  const contextSwitchPenalty = clamp(
    familiarDomain
      ? 0.20 + missingCount * 0.05
      : 0.55 + missingCount * 0.06,
  )

  const total = clamp(
    timeCost * 0.20
    + cognitiveLoad * 0.25
    + executionRisk * 0.25
    + opportunityCost * 0.15
    + contextSwitchPenalty * 0.15,
  )

  const level: ThreadCostLevel = total >= 0.62 ? 'HIGH' : total >= 0.40 ? 'MED' : 'LOW'

  return { timeCost, cognitiveLoad, executionRisk, opportunityCost, contextSwitchPenalty, level }
}

function generateCounterfactual(brief: ProblemBrief, cost: ThreadCost): ThreadCounterfactual {
  const familiarDomain = brief.kevinFit.relatedProjects.length > 0
  const highRisk = cost.executionRisk >= 0.65
  const highOpportunity = cost.opportunityCost >= 0.65
  const missing = brief.missingEvidence.length

  const ifOnly = [
    familiarDomain
      ? `可複用既有 ${brief.kevinFit.relatedProjects.slice(0, 2).join(' / ')} 模式加速驗證`
      : '需從頭建立 domain 知識，學習成本較高',
    highRisk
      ? '但缺乏足夠 evidence，執行方向可能偏移'
      : '證據相對完整，MVP 方向較確定',
    missing > 0 ? `其餘 ${missing} 項待補證據需要主動驗證` : '無明顯缺口',
  ].join('；')

  const ifIgnored = highOpportunity
    ? `${brief.people}的工作流瓶頸持續存在，有他人先切入的風險；kevinFit ${brief.kevinFit.score}/100 的機會遞減`
    : `${brief.people}的問題短期不會消失，但等待更多 evidence 再行動代價較低`

  const ifSplit = `同時追其他 thread 時，${brief.title} 的驗證週期被拉長，context switch penalty ${pct(cost.contextSwitchPenalty)}，每條 thread 動能下降`

  return { ifOnly, ifIgnored, ifSplit }
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value))
}
