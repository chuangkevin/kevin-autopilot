## Context

Kevin clarified the actual goal: Kevin Autopilot is not an infrastructure monitor, a Portainer dashboard, a technical trend radar, or a decorative brain graph. It is a double agent that should discover real-world problems worth solving.

The common thread across HomeProject is not a single domain or technology stack. It is workflow conversion:

- `sheet-to-car` / `frame-processor`: car listing operations turn messy sheets, photos, uploads, and marketplace posting into an operable workflow.
- `media-processor`: non-experts produce short videos without manually mastering editing tools.
- `auto-elearn`: low-value bureaucratic learning/exam workflows become automated and observable.
- `project-bridge`: vague PM/design intent becomes a clickable prototype quickly enough to discuss.
- `mind-diary`: private emotional/memory chaos becomes searchable, contextual, and agent-assisted.
- `onshape-skill`: photos/videos/descriptions become measurable CAD artifacts.
- `greed-island`: not just a game shell, but an attempt at a living rule/world system.

Therefore the discovery loop should search for people and workflows, not for technologies.

## Goals / Non-Goals

**Goals:**

- Detect real-world problem signals from public/approved sources and Kevin-owned observations.
- Extract `people + workflow + pain + workaround` from each useful signal.
- Persist evidence-backed `ProblemBrief` records that Kevin can inspect later.
- Generate a `DailyPick` with one high-signal problem opportunity, not a long noisy ranking.
- Produce Kevin-fit MVP hypotheses and validation plans.
- Keep all actions read-only unless Kevin explicitly approves a later execution gate.

**Non-Goals:**

- Not a Docker/Portainer/GitHub monitoring dashboard.
- Not a generic AI/tech trend board.
- Not a news summarizer.
- Not automatic market outreach, posting, repo creation, deployment, payment, or data-destructive execution.
- Not broad web crawling in v1; start with curated small source sets and explicit source provenance.

## Product Semantics

### Problem Signal

A signal is only useful if it can support at least one of these:

- A specific group of people is trying to finish a workflow.
- The workflow is repetitive, confusing, expensive, fragile, or emotionally costly.
- People use an obvious workaround: Excel, LINE, screenshots, manual copy/paste, paper, naming conventions, repeated file conversion, repeated platform hopping, or personal memory.
- Existing tools are too broad, expensive, technical, foreign to the local workflow, or missing a key operational detail.

### Problem Brief

Every brief must be readable without opening the graph. It should contain:

- `people`: who is stuck.
- `workflow`: what they are trying to accomplish.
- `pain`: what fails or wastes time.
- `workaround`: how they currently survive.
- `evidence`: source snippets with URL/source/time.
- `existingSolutionsGap`: why current tools are not enough.
- `severity`: frequency, time/money/emotional cost, operational risk.
- `kevinFit`: why this matches Kevin's observed project style.
- `mvp`: smallest runnable artifact Kevin could build.
- `validationPlan`: how to test with real users or realistic artifacts.
- `killCriteria`: what evidence would make Kevin drop it.

### Daily Pick

The daily pick is not a popularity ranking. It is the one problem that best balances evidence, real workflow pain, Kevin fit, and small-MVP feasibility. It must include a clear reason why other candidates were not picked today.

## Source Strategy

Start narrow and explicit:

- Public web search queries for pain-pattern phrases such as `有沒有工具可以`, `每次都要手動`, `只能用 Excel`, `截圖傳來傳去`, `is there a tool for`, `manual workaround`, `spreadsheet workflow`, `wish there was`.
- Public forums/reviews/issues only when accessible without private credentials and allowed by policy.
- Kevin-owned signals: stored ideas, durable backlog, project READMEs, prior observation reports, and explicit supplements typed by Kevin.
- News only as a trigger for workflow change: law/platform/policy/market event -> affected people -> changed workflow -> new pain.

Do not treat a source as valuable because it is technical or recent. Treat it as valuable only if it reveals human workflow pain.

## AI Classification Rules

The classifier must reject or downgrade:

- Pure technology keywords with no person/workflow/pain.
- Generic startup ideas without evidence.
- Problems where Kevin has no plausible path to a small runnable artifact.
- Signals with no source snippet or unverifiable provenance.
- Monitoring/infra tasks unless they are framed as a real user workflow pain outside Kevin's own system.

The classifier should promote:

- Repeated manual work.
- Workarounds with spreadsheets, LINE, screenshots, copy/paste, files, or platform hopping.
- Local/Taiwan workflows that global SaaS tools underserve.
- Non-engineer users who need a narrow, practical tool.
- Problems that resemble Kevin's proven pattern: organize messy data/process first, prototype fast, then add automation/AI.

## Dashboard Direction

The default page should become `今日真實問題`:

1. One sentence: who is stuck and in what workflow.
2. Evidence snippets.
3. Current workaround.
4. Why existing solutions are inadequate.
5. Kevin-fit explanation.
6. One-day MVP.
7. Validation plan.
8. Copyable OpenCode prompt for research/spec/prototype, clearly marked as read-only unless approved.

Graph views become secondary:

- Problem landscape exploration.
- Relationships between people/workflows/workarounds/HomeProject precedents.
- Debugging why the daily pick was selected.

## Data Model Sketch

```ts
type ProblemSignal = {
  id: string
  sourceType: 'web-search' | 'news' | 'forum' | 'review' | 'github-issue' | 'kevin-input' | 'homeproject'
  sourceName: string
  url?: string
  title: string
  snippet: string
  language?: string
  fetchedAt: string
  query?: string
}

type ProblemBrief = {
  id: string
  title: string
  people: string
  workflow: string
  pain: string
  workaround: string
  evidence: Array<{ signalId: string; quote: string; url?: string }>
  existingSolutionsGap: string
  severity: { score: number; rationale: string }
  kevinFit: { score: number; rationale: string; relatedProjects: string[] }
  mvp: string
  validationPlan: string
  killCriteria: string[]
  createdAt: string
  updatedAt: string
}

type DailyProblemPick = {
  date: string
  briefId: string
  whyThis: string
  whyNotOthers: string[]
  generatedAt: string
}
```

## Risks / Trade-offs

- **Noise from public sources:** mitigate with hard schema requirements and rejection rules.
- **Tech-trend drift:** require `people + workflow + pain + workaround`; trends are only context.
- **Over-crawling:** start with configured, small, rate-limited sources and persist provenance.
- **Fake certainty:** every brief must expose missing evidence and kill criteria.
- **UI regression:** keep graph available but move it out of the first decision surface.

## Migration Plan

1. Land this OpenSpec change.
2. Implement the data model and persistence with no UI replacement yet.
3. Add a manual/on-demand endpoint to generate problem briefs from Kevin-owned signals.
4. Add limited public-source ingestion behind explicit config and timeouts.
5. Replace homepage with Daily Problem once brief quality is acceptable.
6. Demote graph tab to exploration/debug.

## Open Questions

- Which first external public sources should be enabled by default: web search only, or also HN/GitHub issues/public Reddit-style pages?
- Should the first version avoid live web entirely and only use Kevin-owned signals plus manual pasted links until quality is proven?
- Should the daily pick be date-based (`Asia/Taipei`) or observation-cycle-based?
