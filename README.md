# Kevin Autopilot

Kevin Autopilot is a read-only real-world workflow pain discovery agent. It
looks for people stuck in messy workflows, thinks with Kevin's decision model,
and turns safe findings into bounded research, spec, or prototype-planning tasks
for OpenCode or another coding agent.

Its north star is to act like Kevin's product-engineering brain: not a passive
chatbot, not an infra monitor, not a tech trend radar, and not a graph toy. The
first question is: which people's workflow is being dragged down by bad tools,
manual workarounds, information chaos, or platform limits?

The first implementation is a read-only Dockerized observer and idea intake
prototype. It runs consistently on different HomeProject hosts without hard-coded
application paths.

## Goal

Build an AI system that can proactively:

1. Notice repeated real-world workflow pain, manual workarounds, stale docs,
   failing checks, and small improvement opportunities.
2. Preserve each problem signal with people, workflow, pain, workaround, and
   provenance.
3. Pick one daily problem opportunity that balances evidence, Kevin fit, and
   small-MVP feasibility.
4. Decide whether a task can be prepared read-only, needs Kevin approval, or must
   be blocked.
5. Produce bounded OpenCode prompts for safe research/spec/prototype planning.
6. Verify, commit, and push completed low-risk changes when allowed.

The core expectation is continuous observation across Kevin's projects. Autopilot
should keep watching for possible bugs, regressions, stale docs, failing checks,
workflow friction, and small improvement opportunities, then maintain a living
plan of what can be done next.

Autopilot should especially notice repeated manual work, messy data flows,
half-finished prototypes, missing verification, and places where a small tool or
automation could create immediate user value.

It should also become an idea handoff surface: Kevin can paste a raw idea, and
Autopilot turns it into a bounded workflow covering repo creation, deployment
target selection, architecture, OpenSpec, implementation prompts, verification,
and release handoff.

## Persona Source

The canonical persona is outside this repo and must be resolved from configured
rule-source locations rather than a single hard-coded path:

`homelab-docs/kevin-ai-persona/PERSONA.md`

The service must load that file before making work decisions. Different runtime
environments may select different rule-source mounts or paths, but Kevin's
persona remains the decision model layered on top of those environment-specific
rules.

## Initial Scope

Version 0.1 observes and reports:

1. Run as a Docker service with configured read-only mounts for repositories and
   rule sources.
2. Resolve `homelab-docs` and any user-selected rule sources from configuration,
   not hard-coded machine paths.
3. Observe all configured services first, using safe metadata from docs,
   repository files, and allowed health/status endpoints.
4. Scan configured repositories.
5. Collect git status, recent commits, TODO/FIXME notes, docs drift signals, and
   build/test command availability.
6. Generate candidate tasks.
7. Classify tasks and record missing evidence.
8. Show a daily or on-demand report.
9. Generate OpenCode prompts, but do not automatically run implementation.

Version 0.2 adds idea intake and AI thinking through `@kevinsisi/ai-core`, but it
still does not execute implementation automatically.

Version 0.3 adds app-owned Gemini key import and records the first read-only
superpowers / multi-agent handoff summary for each accepted idea. Kevin can paste
keys through the dashboard; Autopilot stores them only under ignored local
`data/keys.json` and shows only masked suffixes in API/UI responses. Version
0.5.3 migrates this store into ignored SQLite DB `data/autopilot.db`.

Version 0.4 adds kevinhome CI/CD and private Tailnet domain routing at
`https://kevin.sisihome.org`. The deployed dashboard runs in Docker Web mode on
`100.83.112.20:3023`; RPi Caddy only terminates TLS and reverse-proxies to that
desktop Tailscale port.

Version 0.5 turns accepted ideas into read-only project handoff plans. Kevin
writes rough thoughts; Autopilot stores a repo name candidate, project objective,
OpenSpec draft, architecture notes, implementation tasks, verification checklist,
bounded prompt, open questions, and approval gates without creating repos,
deploying, or modifying target projects.

Version 0.5.1 adds no-store cache headers to the dashboard and JSON APIs so the
deployed page refreshes to the current application version immediately.

Version 0.5.3 moves Gemini key management to a dedicated `/settings` page and
stores imported keys in Autopilot's SQLite DB at `data/autopilot.db`. No admin
token input is required on the page; API/UI responses still expose only masked
suffixes.

Version 0.5.4 accepts key-manager copied key-pool text, including comment
headers and mobile-wrapped Gemini keys, and tightens the dashboard/settings
mobile layout so tables and long idea text no longer push the page sideways.

Version 0.5.5 displays dashboard/settings timestamps in GMT+8 / Asia/Taipei and
sets the kevinhome container timezone to `Asia/Taipei`.

Version 0.5.6 adds a read-only Observation Backlog to the report and dashboard.
It turns rule-source, repository, and service signals into categorized candidates
such as `bug_watch`, `improvement_candidate`, and `needs_kevin_decision` with
evidence and suggested next steps.

Version 0.5.7 adds bounded OpenCode prompts to each observation candidate so the
dashboard can hand off safe, constrained investigation or planning work without
automatically modifying target projects.

Version 0.5.8 makes the dashboard usage explicit: the home page explains how to
use Observation Backlog, clarifies that Autopilot does not auto-edit projects,
and adds a copy button for each bounded OpenCode prompt.

Version 0.5.9 turns the dashboard into a read-only Kevin sub-persona main agent
surface. It shows deterministic self-Q&A rounds, an explicit active task state,
feasible options, and a recommendation. Kevin can add mid-run supplements from
the dashboard; these are stored only in Autopilot-owned `data/supplements` and
are merged into the next observation cycle without writing target repositories.

The v0.5.9 boundary is deliberate: Autopilot may observe on request and prepare
handoff artifacts, but it still does not background-execute repo edits, commits,
pushes, deployments, or destructive actions. Any true background observation or
execution requires a later scheduler state, permission gate, interrupt classifier,
pending action record, health surface, and explicit Kevin approval.

Version 0.5.10 consolidates the dashboard around one decision center. The top of
the page now answers what to do next, why, where to copy the primary prompt, and
where to correct the next observation. Self-Q&A, backlog, service, and repository
tables move under `細節與證據` so the page has a clear main flow instead of many
competing sections.

Version 0.5.11 reduces the dashboard further into a single-focus card. The first
screen now says only whether to act, what the one recommended item is, and the
one primary button to copy its prompt. New ideas, self-Q&A, backlog, service, and
repository details are secondary folded panels so they no longer compete with the
main recommendation.

Version 0.5.12 makes the dashboard goal explicit. The first screen now states
that Autopilot is a read-only decision helper that chooses the next worthwhile
OpenCode handoff, not a chat page or autonomous repair tool. The correction box
is labeled as a way to fix the current observation judgment, while new product
goals stay in a separate folded idea intake.

Version 0.5.13 makes the current execution mode explicit: Autopilot does not yet
run a background thinking loop. It only observes when the home dashboard or
`/api/report` is loaded, and the UI now says there is no interval or next-run
time until a later background observation scheduler is implemented.

Version 0.5.14 turns stored ideas into a clickable idea desktop. Each idea card
shows what the Kevin double is currently doing, its classification/approval state,
handoff state, and a deterministic existing-project similarity summary based on
configured repositories and services. Each idea also has a detail page at
`/ideas/<id>` with the raw idea, handoff status, and matched HomeProject projects.

Version 0.5.15 starts a read-only background observation loop in Web mode. The
loop runs on idle every configured interval, writes observation reports and
`observation-loop-state.json` under Autopilot-owned `data/`, and exposes last run,
next run, running, run count, and last error on the dashboard plus
`/api/observation-loop`. It still cannot edit repos, commit, push, deploy, read
unmanaged secrets, or run destructive actions.

Version 0.5.16 makes the Kevin-double thinking trace visible on the dashboard and
through `/api/main-agent/thinking`. It shows auditable reasoning artifacts:
current task, role self-Q&A rounds, feasible options, recommendation, next action,
and evidence summaries. This is intentionally not private chain-of-thought; it is
a reviewable explanation of what the agent considered and decided.

Version 0.5.17 adds a Kevin-style thinking quality review to every main-agent
brief. The review scores whether the double is actually following Kevin's
decision style: real pain or clear signal, UX/stability/verifiability priority,
smallest executable next step, safety/approval boundaries, and avoidance of fake
busywork. Low-scoring rounds are marked `needs_more_context` or `not_qualified`
with concrete improvements instead of pretending the thinking is good.

Version 0.5.18 makes the quality review evidence-gap driven. Weak `suspected`
signals now change the main recommendation to `collect-more-evidence`, add
explicit gaps, required evidence, and upgrade conditions, and show a `差在哪`
section on the dashboard. This prevents dirty-worktree or other weak signals from
being packaged as implementation-quality work.

Version 0.5.19 adds an all-project Project Radar. The dashboard now shows every
configured repository/service as a first-class card with status, signals,
candidate links, and the next read-only observation step, while the command center
still keeps one focused top priority.

Version 0.5.20 adds a multi-item Priority Board above the debug sections. It
shows up to twelve ranked candidates at once, labels whether each item should
collect evidence or can use a read-only handoff prompt, and keeps prompts tucked
behind details so ten-plus items remain scannable.

Version 0.5.21 corrects the product semantics: the dashboard no longer presents
candidates as an importance ranking. It uses an Observation Workbench that keeps
all observed candidates in place, labels evidence-first versus read-only handoff
work, and makes room for past problems, ideas, and research directions without
deciding which one matters most to Kevin.

Version 0.6.0 replaces the dashboard-first home screen with a graph-first Neural
Cockpit. Kevin Autopilot now opens like a visible read-only double brain: ideas,
keywords, existing projects, observation signals, research seeds, dream-like
speculative associations, extensions, and OpenCode tasks appear as connected
nodes. Kevin can click a node to see what the double understands, why it connected
the node, what evidence is missing, and how to extend it. Plain-text idea capture
remains available, but the page is useful even when Kevin only opens it to see
what the double thought of today. Dream/research nodes are labeled as speculative
seeds/planned queries unless evidence or an approved web source is added in a
later change.

Version 0.6.1 keeps "dreaming" as a capability and metaphor rather than a literal
keyword. Background observation now refreshes the Autopilot-owned idea graph after
each run, records `lastGraphAt`, and the open cockpit page checks for graph
updates every minute so the visible double can continue feeling alive while Kevin
is away.

Version 0.7.0 adds the Durable Backlog cockpit panel. Repeated observation
candidates are deduplicated in Autopilot-owned SQLite, accumulate `seen_count`,
`miss_count`, and strength, and appear on the dashboard with current versus
previous evidence. Kevin can filter active/snoozed/resolved/dismissed/all items
and snooze, resolve, or dismiss a row inline; those actions only mutate
`data/autopilot.db` metadata and never touch target repositories, commits, pushes,
deployments, or secrets.

Version 0.7.1 clarifies Neural Cockpit node actions. Implemented actions stay as
clickable buttons, while planned-but-not-yet-implemented actions are shown as
disabled chips with the reason, such as missing prompt/evidence or not-yet-open
relationship search.

Version 0.8.0 makes the Neural Cockpit actions real. Nodes can find additional
relationships by shared keywords/projects, copy a generated read-only OpenCode
prompt, persist an `interesting` mark so the thought stays visible, or stop
exploring a node by hiding it from the focused graph. These actions only write
Autopilot-owned graph metadata under `data/idea-graph.json`.

Version 0.8.1 makes the graph grow automatically from ideas. Each idea projects
one or two read-only extension nodes from its next-step suggestions, so the
cockpit shows the double continuing Kevin's thoughts without waiting for a manual
extend click.

Version 0.9.0 adds bounded public web research. When enabled, the cockpit uses a
small cached DuckDuckGo Instant Answer query set for recent ideas, stores findings
in Autopilot-owned `data/web-research.json`, and connects web findings back into
the graph as read-only research nodes.

Version 0.9.1 hardens mobile node details: the selected-node drawer no longer
expands horizontally on long pills/prompts, and node action buttons stay at the
top of the drawer.

Version 0.9.2 moves graph node actions to the top of the cockpit panel directly
below the brain graph on mobile, and graph actions update the selected-node panel
in place without refreshing the page or moving focus.

Version 0.9.3 makes graph action updates feel immediate by refreshing the graph
stage in place, suppresses stopped keyword projections so rejected keywords do not
return after reload, varies automatic extension prompts with creative lenses, and
falls back to DuckDuckGo HTML search results when Instant Answer has no summary.

Version 0.9.4 starts using Kevin's graph feedback as a quality loop: marked
interesting keywords and project links now lift related graph nodes and steer the
limited web-research query budget toward matching ideas.

Version 0.9.5 removes visible keyword vocabulary nodes from the cockpit graph,
filters low-value repo/status tokens out of deterministic research seeds, and
reframes research seeds as world-discovery leads instead of word cards.

Version 0.9.6 also hides legacy noisy deterministic research seeds already stored
in the graph, so old repo/status-token cards do not survive upgrades.

Version 0.9.7 expands that low-value filter to internal engineering terms like
tests and handoff so the cockpit does not surface implementation-token cards as
world-discovery leads.

Version 0.9.8 adds bounded outside-world discovery seeds so public web research
can surface interesting AI interface, personal-knowledge, research-workflow, and
calm-computing findings even when Kevin has not typed a new idea first.

Version 0.6 should add an approval-resume flow so Kevin can explicitly approve a
single pending handoff action and Autopilot can resume it deterministically.

Version 0.6 should also introduce continuous multi-project observation as a
first-class workflow: suspected bugs, likely bugs, improvement candidates,
prototype candidates, and items that need Kevin's decision should be shown as a
durable planning backlog rather than only as one-off reports.

## Non-Goals For v0.1

1. No autonomous file modification.
2. No deployment.
3. No secret access.
4. No production actions.
5. No data deletion or rebuild.
6. No force push.

## AI Thinking

v0.2+ uses `@kevinsisi/ai-core` for idea analysis when AI is configured. The
dependency is pinned to verified commit
`f42e3f4ceb14886604bd0c7f248071018c85ff82`. The first integration uses Gemini
through ai-core's `GeminiClient` and `KeyPool`, with a deterministic fallback
when no key is configured or the AI call fails.

Key precedence is app-owned local key store first, then environment fallback.
The dashboard supports batch paste using comma/newline, `KEY=VALUE`, and
`export KEY=VALUE` formats. API/UI status only returns counts and the last four
characters; full key values are never returned. Do not write keys into config
files or `.env` files.

When AI is enabled, imported keys are probed with a minimal Gemini request before
being accepted. Set `ai.validateImportedKeys=false` only for offline local tests.

```powershell
$env:GEMINI_API_KEY="<local key>"
$env:KEVIN_AUTOPILOT_CONFIG="$PWD\config\kevinhome.windows.example.json"
npm run web
```

Known limitation: ai-core's current `GenerateParams` API does not expose Gemini
`responseMimeType` or `thinkingBudget`, so v0.2 enforces JSON by prompt and
parser validation. This should move into ai-core before relying on structured AI
decisions for higher-risk automation.

## Agent Handoff

Each idea record includes a read-only handoff summary that records the selected
superpowers workflow and a small Kevin persona / safety reviewer / spec planner
question-answer exchange. This is metadata for planning only; it does not run
child agents, create repos, deploy, or modify target repositories.

## Project Handoff Plans

Each idea record also includes `existingProjectAnalysis`, a deterministic
comparison against configured repositories and services so Autopilot can say
whether the idea should likely extend an existing HomeProject project, start as a
new project, or remain unclear. The analysis uses safe config metadata only; it
does not inspect target repo contents or secrets.

Each idea record also includes `projectHandoff`, a deterministic read-only plan
for turning a rough idea into a reviewable project start. The plan includes:

1. Candidate project and repo names.
2. First artifact recommendation, such as a problem brief or OpenSpec proposal.
3. Open questions that should be answered before implementation.
4. Approval gates for repo creation, deployment, secrets, production, and
   destructive actions.
5. Architecture notes, OpenSpec requirement draft, implementation tasks,
   verification checklist, and a bounded OpenCode prompt.

This remains planning metadata only. It does not create repositories, deploy,
edit target repos, read unmanaged secrets, or commit/push other projects.

## Status

v0.18.0 adds the first real-world problem discovery slice. Kevin-owned ideas,
supplements, observation candidates, and durable backlog items are converted into
`ProblemSignal` records under `data/problem-signals/`, deduplicated into
evidence-backed `ProblemBrief` records under `data/problem-briefs/`, and selected
as a stable `DailyProblemPick` using `Asia/Taipei` date semantics. The home
dashboard now opens on `今日真實問題` with people, workflow, pain, workaround,
evidence, existing-solution gap, Kevin-fit rationale, MVP, validation plan, kill
criteria, and a bounded OpenCode prompt that forbids repo creation, deployment,
spending, outreach, secrets access, or target-project mutation without explicit
approval. The graph remains as a secondary exploration/debug tab. Problem
discovery runs after observation cycles and exposes `/api/problem-discovery/daily`
plus trusted-gated `POST /api/problem-discovery/run`. All 137 tests pass.

v0.17.0 makes the 分身 actually sound like Kevin. `kevin-ai-persona/PERSONA.md`
is mirrored into `persona/PERSONA.md`, copied into the image at build time,
and prepended as a system-instruction prefix on every reflection / boost /
deliberation Gemini call. Deliberation switches from dynamic role-picking to
a fixed four-cast (🔧 工程師 Kevin / 🎨 設計師 Kevin / ⚠️ 風險 Kevin /
🛋 休假 Kevin), each carrying a distinct lens-slice of PERSONA.md so the
voices stay separable across runs. A new `mood` label (`excited` / `flow` /
`tense` / `idle`) is computed at the end of every observation cycle from
24h signals (backlog activity, archive activity, deliberation seeds,
graph growth) and persisted to `data/mood-state.json`; it gets injected
into every prefix and tells deliberation which cast should speak louder.
A new `preferences` summary derived from archived nodes (`< 10` archived →
keyword frequency; `>= 10` → Gemini theme abstraction with 24h throttle)
persists to `data/preference-cache.json` and is also injected into every
prefix so the double avoids directions Kevin has already frozen.
`pickRoles` is retained as a fallback when PERSONA.md or cast loading
fails. All 132 tests pass.

v0.16.0 redesigns the 分身 tab selected-node card and adds three trusted-gated
per-node actions. On mobile, keywords now sit directly under the title in an
accent-coloured `.kw-strip` that wraps and never ellipsizes; the full
discussion (`thinking.*`) renders without truncation because the broken
`.node-drawer { max-height: 24dvh }` cap has been removed and `.cockpit-panel`
now fills `calc(100dvh - var(--cy-h, 48dvh) - 160px)` below the graph with
internal scroll. The card opens with a sticky action bar carrying ⚡ 多想一點
(`POST /api/idea/:id/boost` — single-node Gemini enrichment via a per-node
concurrency lock), 🧠 深度辯論 (`POST /api/deliberation { anchorNodeId }` —
focused multi-persona debate whose step 0 re-runs the same boost path so the
anchor is always enriched first), and ❄ 先不要想 (`POST /api/idea/:id/archive` —
hidden from the default graph and from observation/deliberation candidate
pools). Type/confidence/source meta and the legacy extend/find-relationships/
mark-interesting/copy-prompt actions collapse into `🔬 詳情 ▾`. A new Frozen
Vault card lists archived nodes and offers 🔥 解凍 (`POST .../unarchive`) and
🗑 永久刪除 (`DELETE /api/idea/:id`, with `confirm()`). All 132 tests pass.

v0.15.0 adds the multi-agent deliberation engine (分身辯論) and force-think trigger:
Tap ⚡ 強制思考 in the 分身 tab to instantly start one deliberation cycle without
waiting for the background timer. The engine dynamically picks 2–4 AI personas,
each independently analyzes the current project state, then runs 2 debate rounds
where personas challenge each other's blindspots. A synthesis agent produces a
consensus summary, lists blindspots found, and injects up to 3 high-quality idea
seeds into the graph. Results persist to `data/deliberations/<id>.json` (max 10
records). The deliberation card renders immediately in the 分身 tab after completion
with personas, round-0 key insights, synthesis, and seed count.
`ObservationLoop.forceRun()` was also added: bypasses the `enabled` guard and waits
for any in-flight cycle before starting a fresh one. All 131 tests pass.

v0.14.0 replaces the SVG neural map with a fully interactive Cytoscape.js graph:
Drag nodes freely — positions persist to `data/graph-positions.json` via `PUT /api/graph/positions`.
Force-directed initial layout (`cose`) — no more uniform circle; nodes spread organically.
Zoom (scroll wheel / pinch) and pan (drag background).
Tap node → loads node detail and actions in the drawer (same behaviour as before).
Cyberpunk styling preserved: cyan nodes, magenta for interesting, dimmed for stop-exploring.
All tests pass (119 total).

v0.13.0 ships Android Mode: adaptive observation timer + cyberpunk neural UI.
The timer shortens the reflection interval to 60 s on excited signals (new AI
seeds, newly interesting graph nodes, backlog spikes) and anneals back to the
base interval when signals cool. The UI replaces the old cockpit layout with a
mobile-first tab-based design (分身 / Backlog / 圖 / 想法) using a cyberpunk
color palette (cyan/magenta on near-black), scanline overlay, and a full SVG
neural map in the graph tab. Desktop falls through to a three-column sidebar
layout. All 115 tests pass.

v0.12.0 adds trusted-settings runtime overrides on `/settings`. Kevin can flip
the whitelisted fields `aiReflection.enabled`, `aiReflection.maxOutputTokens`,
`aiReflection.maxPendingAiIdeas`, `backgroundObservation.enabled`, and
`backgroundObservation.intervalMs` without editing the mounted config or
restarting the container. Overrides live in Autopilot-owned
`data/runtime-overrides.json`, are reversible per field, and do not allow editing
repositories, services, rule sources, AI model/provider, key storage, `dataDir`,
or web research settings.

v0.12.x also makes the Neural Cockpit less like a bubble wall and more like a
thinking workbench: repeated "extend" clicks create readable continuation
branches instead of reusing the same extension, manual extension no longer adds
extra research bubbles, and every graph node carries explicit "分身正在問"
questions that challenge the premise, evidence, counterexamples, and whether the
idea should keep going.

v0.11.0 真正的「分身大腦」：每個 5-min observation cycle 在 graph
signature 變動時呼叫一次 Gemini 反思，產出 0–2 個帶 evidence chain 的
AI idea seed 與最多 1 個焦點節點的 nextExploration 改寫。AI idea 顯示
「AI 生」pill、可一鍵「永久略過」；超過 5 個 pending AI idea 會自動
停產（仍可改寫 nextExploration）。token cap、超時、失敗都會記為
skipped record，cockpit 顯示「反思離線」狀態。`aiReflection.enabled`
預設 false；上線前先讓本機驗證 wiring。

v0.10.1 makes hub-spoke focus state legible: right-panel title tracks
the focused node, an "聚焦：X" chip appears with Escape / empty-stage
reset, and the ambiguous 醒著 chip becomes "5 分鐘自動".

v0.10.0 Neural Cockpit hub-spoke focus and EXTENSION dedup. Clicking a node
re-centers the graph on it, lays its direct neighbours on the inner ring, fades
non-neighbours, and shows the relationship rationale inline on every incident
edge (no hover required). EXTENSION nodes now use deterministic
signature-based ids (parent + normalised title + top keywords) so the same
conceptual extension stops duplicating across cycles or user-triggered
extends, and legacy timestamp-suffix duplicates collapse on graph load. See
`docs/` for architecture, safety, and OpenCode workflow.

## Deployment

Kevinhome deployment follows the HomeProject desktop-runner pattern used by
`greed-island`, `frame-processor`, and `media-processor`:

1. `CI` runs `npm ci`, `npm run build`, and `npm test` on `main`.
2. `Build and Push Docker Image` publishes
   `ghcr.io/chuangkevin/kevin-autopilot:<sha>` and `:latest` for `linux/amd64`
   using the built-in GitHub token.
3. `Deploy Kevinhome` runs on the repo self-hosted runner labelled
   `kevin-autopilot-prod`, pulls the commit image, starts
   `docker-compose.kevinhome.yml`, and verifies `/health` reports the expected
   app version.

Runtime target:

- URL: `https://kevin.sisihome.org`
- Host: `kevinhome` / `100.83.112.20`
- Port: `3023`
- Compose: `docker-compose.kevinhome.yml`
- Data: ignored local `data/`

Key management lives at `/settings`. Imported Gemini keys are stored in ignored
SQLite DB `data/autopilot.db`; legacy `data/keys.json` is migrated into the DB
on first read. The dashboard and API only show counts and masked suffixes.

## Run Observer Locally

Build and run the read-only observer once:

```powershell
npm install
npm run build
$env:KEVIN_AUTOPILOT_CONFIG="$PWD\config\kevinhome.windows.example.json"
npm run observe
```

Run the Dockerized `kevinhome` Web dashboard locally:

```powershell
$env:IMAGE_TAG="local"
docker build -t ghcr.io/chuangkevin/kevin-autopilot:local .
docker compose -f docker-compose.kevinhome.yml up -d --pull never --no-build
curl http://100.83.112.20:3023/health
```

Reports are written to `data/`, which is intentionally ignored by git.
