## Why

Kevin Autopilot v0.10.1 ships a Neural Cockpit that LOOKS like a thinking
dashboard but is structurally a templated graph builder:

- EXTENSION nodes come from 4 hard-coded "lens" templates in
  `creativeExplorationStep`. No reasoning happens.
- RESEARCH "世界線索：…" seeds mostly never get a real finding attached.
- The thought-line ("我覺得『X』可能可以長出新工具…") is printf, not
  inference.
- AI is invoked only once per idea at creation time (`analyzeIdeaWithAiCore`).
  After that the graph grows via deterministic projection.

The cockpit's value claim — "看分身今天想什麼" — does not match the
mechanism. Kevin explicitly chose Path B during v0.10.1 review: make the
double actually think between cycles, not just decorate.

## What Changes

- Add an AI reflection pass that runs at the end of every observation
  cycle (5 min interval), conditional on either the idea graph or the
  durable backlog having materially changed since the last reflection.
  When nothing changed, skip the call and reuse the previous reflection
  record.
- The reflection call takes a bounded summary of the current graph plus
  recent backlog and existing ideas, and asks the AI to produce:
  - 0–2 "real" IDEA seeds. These become full `IdeaRecord`s with
    `aiSource = 'ai-reflection'`. Each one carries the evidence chain
    (which signals / nodes drove the idea) so Kevin can audit it.
  - A `nextExploration` rewrite for at most one focused or recently
    interesting node. This replaces the deterministic
    `thinking.nextExploration` for that node with the AI's specific
    follow-up.
- Cap pending unread AI-generated ideas at 5. While the cap is hit, the
  reflection call still runs (it may still rewrite a `nextExploration`)
  but it MUST NOT mint new IDEAs.
- Token-cap the call (default `maxOutputTokens = 700`) and timeout
  (default `25_000ms`). Failures fall back to the existing deterministic
  graph; the cockpit surfaces a "reflection offline (reason)" line.
- Persist `data/reflection-state.json`: last graph signature, last
  reflection ISO time, last reflection model, last token usage, last
  error if any, pending AI-idea count.
- Add `IdeaRecord.aiSource` (`'user' | 'ai-reflection'`) and surface it
  in the cockpit IDEA card with an "AI 生" pill and a one-click
  "Dismiss (永久略過)" button. Dismissed AI ideas are filed under
  `data/ideas-dismissed/` so the dedup signature cannot regenerate them
  on the next reflection.
- New API surface:
  - `GET /api/reflection/state` — current reflection record + pending count.
  - `POST /api/ideas/:id/dismiss` — trusted-settings gated; only valid
    for `aiSource = 'ai-reflection'` ideas. Returns the dismissed record.
- New config knobs under `aiReflection` (all optional with sane defaults):
  `enabled`, `maxOutputTokens`, `maxPendingAiIdeas`, `intervalMs`
  override.

Read-only safety stays intact: the reflection only writes Autopilot-owned
files. No target-repo writes. Kevin can dismiss any AI idea in one click.

## Capabilities

### New Capabilities

- `ai-graph-reflection`: Bounded AI reflection over the graph + backlog
  + ideas that runs each cycle (with skip-if-unchanged), mints
  audit-trail AI idea seeds with a strict pending cap, and rewrites
  `nextExploration` on focused/interesting nodes.

### Modified Capabilities

- `double-research-loop`: every successful background cycle, after
  graph refresh, invokes the AI reflection if enabled and conditions
  hold; persists reflection state and tracks last reflection signature
  to skip no-op runs.
- `idea-graph`: `IdeaRecord` carries `aiSource`. AI-generated ideas
  project into the graph identically to user ideas, but their cockpit
  card shows the AI-生 pill and a dismiss action that hides the idea
  permanently and writes it to `data/ideas-dismissed/`.
- `neural-cockpit`: when a node is focused, its
  `thinking.nextExploration` may render the AI-rewritten version with a
  small "AI 改寫" tag; otherwise the deterministic version still shows.
  Top of cockpit gains a small status line: "上次反思：13:30 ·
  pending AI 想法 2/5". When AI reflection is offline the line says
  "反思離線：{reason}".

## Impact

- Affects `src/observation-loop.ts`, `src/ai.ts` (or new
  `src/reflection.ts`), `src/ideas.ts`, `src/types.ts`,
  `src/idea-graph.ts`, `src/web.ts`, and their tests.
- Adds `data/reflection-state.json` and `data/ideas-dismissed/*.json`
  to Autopilot-owned storage.
- Bumps `package.json`, `package-lock.json`, `src/version.ts`,
  `.github/workflows/deploy-dev.yml` `EXPECTED_APP_VERSION` to `0.11.0`.
- Updates `README.md` and `AGENTS.md` with the v0.11.0 entry.
- Gemini API usage: best case (graph unchanged) ≈ 0 extra calls/day;
  worst case (every cycle changes) ≈ 288 calls/day with each call
  bounded by `maxOutputTokens`. Manage via Kevin's existing key pool.
- No new external dependency, no Docker image change beyond the
  rebuilt JS bundle.
