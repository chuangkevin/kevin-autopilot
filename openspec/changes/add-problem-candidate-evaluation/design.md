## Context

The current live product has two real candidates after v0.18.2: car listing operations and calm PKM. That is enough to expose the next problem: Kevin still needs to know why a candidate appears, whether it is evidence-backed, and what action would make the candidate more or less real.

This phase should make the candidate pool feel like a product judgment tool. The system should show its reasoning and accept lightweight feedback, but remain read-only toward the rest of HomeProject.

## Product Shape

### Candidate Quality Tiers

Every visible candidate should be grouped into one of three user-facing tiers:

- `值得追`: strong enough to consider a validation artifact.
- `先補證據`: plausible but missing a real sample, second signal, or sharper workflow.
- `暫時不追`: rejected/downranked because it is internal engineering noise, too abstract, too tech-led, or lacks a real person/workflow.

The daily pick may come from `值得追` or the top `先補證據` candidate if no strong candidate exists, but the UI must state that clearly.

### Ranking Rationale

Each candidate card should answer these questions without opening the graph:

- Who is stuck?
- What workflow is being repeated or blocked?
- Why does Kevin fit this problem?
- What evidence is strongest?
- What evidence is missing?
- What is the smallest next validation step?
- What would kill this direction?

### Feedback Actions

Feedback should be intentionally small:

- `interesting`: promote similar candidates and keep it visible.
- `boring`: downrank similar candidates unless stronger evidence arrives.
- `not-a-problem`: suppress this brief unless new evidence changes the framing.
- `find-similar`: mark the pattern as worth sourcing more evidence for; no external crawling happens unless a later approved source adapter exists.

Feedback is Autopilot-owned ranking metadata. It is not approval to build, deploy, contact users, spend money, or mutate any target repo.

## Data Model Sketch

```ts
type ProblemCandidateTier = 'worth_chasing' | 'needs_evidence' | 'not_now'

type ProblemCandidateEvaluation = {
  briefId: string
  tier: ProblemCandidateTier
  rank: number
  rankingRationale: string
  strongestEvidence: string
  evidenceGap: string
  nextValidationStep: string
  rejectionReasons: string[]
  feedbackSummary: {
    interesting: number
    boring: number
    notAProblem: number
    findSimilar: number
  }
}

type ProblemFeedback = {
  id: string
  briefId: string
  action: 'interesting' | 'boring' | 'not-a-problem' | 'find-similar'
  createdAt: string
  source: 'trusted-dashboard'
}

type RejectedProblemSummary = {
  reason: 'internal-engineering' | 'tech-only' | 'missing-people' | 'missing-workflow' | 'missing-workaround' | 'duplicate' | 'low-signal'
  count: number
  examples: Array<{ title: string; sourceType: string }>
}
```

## API Shape

`GET /api/problem-discovery/daily` should remain safe for public reads. It may include:

- `candidates[]` with title, people, workflow, score, tier, rationale, validation step, missing evidence summary, and feedback counts.
- `rejectedSummary[]` with counts and sanitized examples.

It must not include the full `briefs` array, full evidence arrays, raw private snippets, or unmanaged secrets.

`POST /api/problem-discovery/:briefId/feedback` should be trusted-gated like other mutation endpoints. It accepts one feedback action, writes only Autopilot-owned metadata, and returns the updated candidate evaluation.

## Ranking Rules

Initial deterministic ranking should combine:

- Base `ProblemBrief.score`.
- Feedback boosts/penalties.
- Evidence completeness.
- Repeated signal count.
- Whether the candidate has a concrete next validation step.
- Penalty for known internal engineering/repo/spec/test-only patterns.

Feedback must not permanently bury a candidate if new evidence meaningfully improves it; the system should show that the candidate was previously marked boring/not-a-problem but has new evidence.

## Dashboard Direction

The `今日真實問題` tab should keep the daily pick at the top, then show:

1. `值得追` candidates.
2. `先補證據` candidates.
3. A collapsed `暫時不追 / 被排除` summary.

Candidate cards should include feedback buttons and a compact validation card. On mobile, the daily pick and first two candidates should be readable without graph interaction.

## Verification Strategy

- Unit-test evaluation tiers and feedback scoring.
- Unit-test rejected summaries for internal engineering and tech-only signals.
- Web/API tests for safe public shape and trusted-gated feedback writes.
- Snapshot-like HTML assertions for candidate tier headings, validation cards, and rejected summary.
- Live verification after deployment: health version, candidate tier display, feedback endpoint trusted gating, and public API not exposing full briefs/evidence.

## Risks

- Too many labels could make the page feel like a dashboard again. Keep the first screen focused on daily pick + top candidates.
- Feedback may overfit Kevin's current mood. Keep counts visible and reversible through future metadata editing or reset action.
- Rejected summaries can leak raw internal signals if not sanitized. Only expose counts and short titles/source types publicly.
