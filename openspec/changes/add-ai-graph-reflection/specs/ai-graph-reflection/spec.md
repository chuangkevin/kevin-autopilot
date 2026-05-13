## ADDED Requirements

### Requirement: Cycle-Bound AI Reflection With Skip-If-Unchanged
Kevin Autopilot SHALL perform a bounded AI reflection over the current graph, durable backlog, and recent ideas at the end of every successful background observation cycle when AI reflection is enabled, AND it SHALL skip the call when the graph signature plus backlog signature have not changed since the previous successful reflection.

#### Scenario: Graph and backlog unchanged
- **WHEN** the background observation cycle finishes and the graph signature plus backlog signature match the previously stored signature on a successful reflection record
- **THEN** Kevin Autopilot SHALL record a skipped reflection with `reason: 'unchanged'`, SHALL NOT call the AI, and SHALL keep the previous successful reflection record as the active reference for UI rendering.

#### Scenario: Graph changed, AI enabled, AI online
- **WHEN** the cycle ends and the graph signature or backlog signature changed and `aiReflection.enabled` is true and Gemini keys are available
- **THEN** Kevin Autopilot SHALL invoke a single AI call bounded by `aiReflection.maxOutputTokens` (default 700) and the timeout from `config.ai.timeoutMs` (default 25 seconds), and SHALL persist the resulting `ReflectionRecord` to `data/reflection-state.json`.

#### Scenario: AI disabled
- **WHEN** `aiReflection.enabled` is false or no Gemini key is available
- **THEN** Kevin Autopilot SHALL record `skipped: true, reason: 'disabled'` with the current graph signature, SHALL NOT call the AI, and the cockpit SHALL surface the disabled state without claiming reflection ran.

#### Scenario: AI call fails
- **WHEN** the AI call throws, times out, or returns unparseable output
- **THEN** Kevin Autopilot SHALL record `skipped: true, reason: 'offline'` (or `'error'`) with the error detail, SHALL NOT mutate any idea record, and the observation cycle SHALL still mark itself successful.

### Requirement: AI Idea Seeds With Audit Trail And Dismiss Path
Kevin Autopilot SHALL mint AI-proposed idea seeds only when they include non-empty evidence, MUST mark them with `aiSource = 'ai-reflection'`, MUST cap unread AI ideas at `aiReflection.maxPendingAiIdeas` (default 5), and SHALL provide a one-click dismiss path that prevents the same idea from being re-proposed.

#### Scenario: AI returns valid seed with evidence
- **WHEN** the AI returns a seed with non-empty `evidence` and the pending unread AI-idea count is below the cap
- **THEN** Kevin Autopilot SHALL create a new `IdeaRecord` with `aiSource = 'ai-reflection'`, `aiReflection.evidence` populated, `thinking.mode = 'ai-core'`, and `projectHandoff` derived through the same pipeline as user ideas.

#### Scenario: AI returns seed with empty evidence
- **WHEN** the AI returns a seed whose `evidence` array is empty after validation
- **THEN** Kevin Autopilot SHALL drop the seed and SHALL NOT create an idea record.

#### Scenario: Pending cap reached
- **WHEN** the count of `aiSource = 'ai-reflection'` ideas under `data/ideas/` already meets or exceeds `aiReflection.maxPendingAiIdeas`
- **THEN** Kevin Autopilot SHALL NOT mint any new AI seeds in the current cycle, regardless of how many the AI proposed; the reflection MAY still apply `nextExplorationRewrites`.

#### Scenario: Dismiss an AI idea
- **WHEN** Kevin POSTs to `/api/ideas/:id/dismiss` from a trusted-settings source for an idea whose `aiSource = 'ai-reflection'`
- **THEN** Kevin Autopilot SHALL move the idea JSON from `data/ideas/` to `data/ideas-dismissed/` with a `dismissedAt` timestamp, the idea SHALL no longer appear in `listIdeas` or the cockpit, and the next reflection prompt SHALL include the dismissed idea's title in the steer-away list.

#### Scenario: Dismiss a user idea
- **WHEN** Kevin POSTs to `/api/ideas/:id/dismiss` for an idea whose `aiSource` is `'user'` or absent
- **THEN** Kevin Autopilot SHALL respond 400 and SHALL NOT move the idea file.

### Requirement: AI-Rewritten `nextExploration` On Focused Nodes
Kevin Autopilot SHALL allow each successful AI reflection to override the `thinking.nextExploration` text of at most one graph node (typically the focused node or the most-recently interesting node), rendering the override only for the lifetime of that reflection record and only when the node still exists in the visible graph.

#### Scenario: AI rewrites the focused node's next-exploration
- **WHEN** the latest successful reflection contains a `nextExplorationRewrites` entry whose `nodeId` matches a node returned by `/api/graph/nodes/:id`
- **THEN** Kevin Autopilot SHALL render the AI-supplied text as the node's `thinking.nextExploration` and SHALL set a flag (e.g. `nextExplorationAi: true`) so the cockpit can show an "AI 改寫" tag next to it.

#### Scenario: AI proposes a nodeId that does not exist
- **WHEN** the parser receives a rewrite whose `nodeId` is not among the supplied prompt node ids
- **THEN** Kevin Autopilot SHALL drop the rewrite entry and SHALL fall back to the deterministic `nextExploration` for every node.

#### Scenario: Reflection state expires
- **WHEN** the latest successful reflection is older than 1 hour and the current reflection cycle did not return a rewrite
- **THEN** Kevin Autopilot SHALL stop applying the previous rewrite and SHALL render the deterministic `nextExploration` again so stale AI text does not linger.

### Requirement: Reflection Observability And State API
Kevin Autopilot SHALL persist a single `data/reflection-state.json` carrying the latest reflection outcome (success or skip), and SHALL expose it via `GET /api/reflection/state` so the cockpit can show "上次反思" status and pending counts.

#### Scenario: Read reflection state after a successful cycle
- **WHEN** Kevin requests `GET /api/reflection/state`
- **THEN** Kevin Autopilot SHALL return JSON containing `generatedAt`, `model` (when applicable), `graphSignature`, `skipped` flag, `reason` when skipped, `newIdeaSeedCount`, `nextExplorationRewriteCount`, and `pendingAiIdeaCount`.

#### Scenario: Reflection has never run
- **WHEN** Kevin requests `GET /api/reflection/state` before the first successful cycle
- **THEN** Kevin Autopilot SHALL return `{ "skipped": true, "reason": "never-run", "pendingAiIdeaCount": 0 }` without error.
