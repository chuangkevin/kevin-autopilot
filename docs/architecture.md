# Architecture Plan

## System Shape

```text
Kevin Autopilot
├─ Scheduler
├─ Runtime Config Loader
├─ Rule Source Resolver
├─ Context Collector
├─ Service Observer
├─ Project Watcher
├─ Bug Signal Analyzer
├─ Improvement Planner
├─ Persona Loader
├─ Thinking Engine
├─ AI Core Adapter
├─ Task Classifier
├─ Approval Gate
├─ Idea Intake
├─ Existing Project Similarity Analyzer
├─ Project Bootstrap Planner
├─ OpenCode Prompt Builder
├─ Verification Planner
├─ Task Store
├─ Main Agent State
├─ User Supplement Store
└─ Dashboard / Report
```

## Agent Design References

v0.5.9 is aligned with these local references:

1. `homelab-docs/skills/agent-design/SKILL.md` and
   `homelab-docs/docs/agent-architecture-checklist.md` for permission scopes,
   active task state, interruption handling, and observable runtime state.
2. `homelab-docs/opencode-agent-analysis.md` for the principle that UI should be
   a projection of agent runtime state, not just a chat transcript.
3. A local `ai-agents` SQLite store such as `<AI_AGENTS_ROOT>/ai_agents.db` for
   the expert-profile pattern: named roles, system prompts, keyword metadata, and
   conversation feedback.

The first 0.5.9 implementation borrows the role/profile and feedback-state
ideas without copying its DB schema into Autopilot. Autopilot's current main
agent roles remain deterministic and read-only until a later scheduler/worker
runtime is explicitly approved.

## Components

### Runtime Config Loader

Loads deployment-specific settings from a config file or environment variables.
The Docker container must receive rule sources, repositories, services, and data
paths through configuration or mounts. It must not hard-code a Windows,
Linux, RPi, VM, or workstation path as the only valid layout.

### Rule Source Resolver

Resolves `homelab-docs` plus optional user-selected rule sources for the active
environment. Each resolved source should record:

1. Source name.
2. Resolved path or URI.
3. Whether it is required or optional.
4. Last loaded timestamp.
5. Files used for decisions.

Kevin's persona is loaded from the selected rule sources and applied as the
stable decision model. Environment-specific rules may constrain observation,
deployment, and allowed actions, but they do not replace the persona unless Kevin
explicitly chooses a different persona source.

### Scheduler

Runs on demand first, then later on a timer. It should support per-repo budgets
so one slow repository does not block all scans.

v0.5.15 starts the first Web-mode timer. It is deliberately read-only: each run
calls the existing observer, writes reports and loop status under Autopilot-owned
`data/`, and updates dashboard/API state. It does not execute handoff prompts,
modify target repositories, commit, push, deploy, read unmanaged secrets, or run
destructive actions.

### Context Collector

Collects only safe metadata in v0.1:

1. Git branch and status.
2. Recent commit summaries.
3. File names and documentation locations.
4. TODO/FIXME markers.
5. Available package scripts or build commands.
6. Existing rule files such as `AGENTS.md`, `CLAUDE.md`, and `README.md`.

It must not read `.env*`, credential JSON, service-account files, or secret
paths.

### Service Observer

Builds a read-only service inventory from configured sources before candidate
tasks are generated. It should support services from `homelab-docs`, additional
rule sources, and explicit user config. For each service, collect safe facts such
as name, domain, host, port, repo, compose file path if documented, health check
policy, last observation result, and source provenance.

Allowed observation inputs in v0.1:

1. Documentation tables and project docs.
2. Non-secret repository files.
3. Git metadata.
4. Explicitly configured health/status endpoints.

Forbidden observation inputs in v0.1:

1. `.env*` files.
2. Credential JSON or service-account files.
3. Secret paths.
4. Container environment variables.
5. Destructive or mutating service commands.

### Project Watcher

Continuously scans configured repositories and services for safe signals that
may indicate bugs, regressions, stale docs, or useful next work. It should run on
manual demand first, then on a schedule with per-project timeouts and budgets.

The watcher should not only react to Kevin's pasted ideas. It should maintain a
living backlog of observed candidates across projects.

### Bug Signal Analyzer

Turns observation signals into bug candidates with confidence levels:

1. `suspected`: weak signal that needs more evidence.
2. `likely`: repeated failure, failed check, or clear docs/runtime mismatch.
3. `confirmed`: reproducible failure or trusted check evidence.

Bug candidates must include symptom, evidence source, affected repo/service,
expected behavior, actual behavior, and the smallest verification step.

### Improvement Planner

Finds non-bug work worth planning, such as docs drift, missing verification,
hard-coded paths, workflow friction, untested behavior, or prototype hardening.
It should preserve candidates with Kevin-relevant context and classify whether
the work can be prepared read-only, needs approval, should only be observed, or
is blocked.

### Persona Loader

Loads Kevin's persona from `homelab-docs/kevin-ai-persona/PERSONA.md` and records
the loaded path and timestamp in every decision.

### Thinking Engine

Turns context into candidate tasks. It should prefer:

1. Real user pain.
2. Existing behavior preservation.
3. Verifiable improvements.
4. Small runnable prototypes.
5. Documentation/behavior alignment.

v0.5.9 exposes a deterministic Kevin sub-persona main agent on the dashboard. It
does not execute tools by itself; it turns observation signals into visible
self-Q&A rounds, feasible options, a recommendation, and an active task snapshot
that can be audited without reading a chat transcript.

### AI Core Adapter

Uses `@kevinsisi/ai-core` for AI-backed thinking. v0.2 uses Gemini through
`GeminiClient` and an environment-backed in-memory `KeyPool`; if no key is
configured or the AI call fails, Autopilot records the failure and falls back to
deterministic classification. Secrets stay in environment variables and are not
read from `.env` files.

Known limitation: ai-core's current `GenerateParams` does not expose Gemini
structured output MIME settings or `thinkingBudget`, so v0.2 validates JSON after
the response instead of relying on provider-enforced JSON. Higher-risk automation
should wait until this is supported in ai-core.

### Task Classifier

Classifies each task as:

1. `auto_candidate`: safe later for automation.
2. `needs_approval`: requires Kevin decision.
3. `blocked`: unsafe or out of scope.
4. `observe`: useful signal but no action yet.

### Approval Gate

Blocks tasks involving user-flow changes, data deletion/rebuild, deployment,
secrets, large refactors, external cost, API contract changes, or existing user
habit changes.

### Idea Intake

Accepts Kevin's raw ideas as messy text and converts them into structured work.
It should preserve the original intent, identify the real user pain, ask only for
missing product or safety decisions, and then produce a handoff plan.

In v0.2, idea intake can call ai-core to classify the idea and suggest next
steps. It still does not create repositories, write product code, deploy, commit,
or push.

In v0.5.14, idea intake also attaches deterministic `existingProjectAnalysis` to
each stored idea. The analyzer compares idea text against configured repository
names, repository path basenames, service names, domains, sources, and service
repository hints. It only uses safe configuration metadata and gives a planning
recommendation: extend an existing project, treat as a new project, or keep the
decision unclear until Kevin/OpenCode gathers more evidence.

Idea intake should classify an idea into:

1. `explore`: needs research or clarification.
2. `plan`: enough information to draft architecture and OpenSpec.
3. `prototype`: safe to create a minimal runnable prototype after approval.
4. `blocked`: touches production, secrets, cost, data deletion, or unclear user
   flow decisions.

### Project Bootstrap Planner

Plans new repo creation, stack selection, deployment target, architecture,
OpenSpec changes, implementation prompts, tests, and release handoff. It must not
create repositories, deploy, or execute implementation until Kevin approves that
specific step.

### OpenCode Prompt Builder

Generates bounded prompts with:

1. Persona and rule files to read.
2. Exact task objective.
3. Forbidden actions.
4. Files or repo scope.
5. Verification requirement.
6. Commit and push expectation when safe.

For idea handoff, prompts should also include the original idea, chosen deployment
target, architecture decision, OpenSpec change ID, and explicit approval state.

### Task Store

Use SQLite in the first implementation. Store tasks, decisions, runs, approvals,
and reports.

### Main Agent State

The main agent surface should externalize state instead of relying on chat
memory. The v0.5.9 report includes objective, current step, checkpoints,
blockers, update time, and supplement count. Later background execution should
promote this into a persisted scheduler/worker record before it can edit repos or
deploy.

v0.5.16 promotes the deterministic main-agent trace to a first-class dashboard
section and `/api/main-agent/thinking`. The trace includes auditable artifacts:
current task, role rounds, observations, judgments, outputs, feasible options,
recommendation, next action, and evidence summaries. It is not private
chain-of-thought and should remain safe to show to Kevin.

v0.5.17 adds `qualityReview` to the main-agent state. It scores the decision
against Kevin's persona priorities: real pain or clear signal, user experience /
stability / verifiability, smallest executable next step, safety and approval
gates, and avoiding fake busywork. Rounds that do not meet the bar are explicitly
marked `needs_more_context` or `not_qualified` with improvements.

v0.5.18 adds explicit quality gaps with required evidence and upgrade conditions.
When the top signal is only `suspected`, the main recommendation changes to
`collect-more-evidence` instead of `prepare-read-only-handoff`, so the dashboard
shows what is missing before claiming a Kevin-quality decision.

v0.5.19 adds `projectRadar` to each observation report. It groups every configured
repository and service into per-project cards, including repo status, service
health policy, linked candidates, and the next read-only observation step, so the
dashboard can show global HomeProject coverage while still focusing on one top
priority.

v0.5.20 adds a visible Priority Board for multiple observation candidates. The
command center still highlights the first priority, but the board ranks up to
twelve candidates, separates evidence-first items from read-only handoff items,
and keeps bounded prompts collapsed to preserve scanability.

v0.5.21 changes that visible board into a non-prioritized Observation Workbench.
The main agent may keep one operational focus for evidence collection, but the UI
and thinking API keep every observed candidate visible without ranking or
truncation, because Kevin treats each idea as important until he decides
otherwise.

v0.7.0 adds a persisted Durable Backlog table in `data/autopilot.db`. Observation
cycles upsert candidates by deterministic id, keep previous/current evidence,
derive strength from recurrence, and expose `GET /api/backlog` plus trusted
metadata-only action APIs for snooze, resolve, and dismiss. The dashboard renders
this as a filterable cockpit panel so Kevin can inspect repeated signals across
cycles without treating the list as an importance ranking.

v0.8.0 turns the Neural Cockpit node actions into metadata-backed operations.
Finding relationships writes Autopilot-owned graph edges, OpenCode task conversion
copies a bounded read-only prompt for any node, marking interesting persists on
the node and boosts its focused-graph weight, and stop-exploring persists an
ignored flag so the node leaves the focused graph. These actions do not mutate
target repositories or external services.

v0.8.1 adds automatic idea extension nodes. During graph projection, each idea
turns one or two suggested next steps into read-only extension nodes connected
back to the original idea, so the cockpit visibly grows along Kevin's thoughts
without requiring an initial manual extend action.

The first persisted loop status is `observation-loop-state.json`, which records
enabled/running state, interval, run count, last run, next run, report paths, and
last error. This is status telemetry only, not permission to execute changes.

### User Supplement Store

Kevin's mid-run supplements are app-owned data. v0.5.9 stores them under
`data/supplements` and merges recent supplements into the next observation run.
Supplements may influence context, but they do not grant new write,
commit, push, deployment, secret, or destructive permissions.

### Docker Runtime

The first runnable version should be packaged as a Docker image. It should use
read-only mounts for rule sources and repositories, plus one writable volume for
its own SQLite store and generated reports. Host-specific paths belong in Docker
Compose or runtime config, not in application logic.

The first deployment target is `kevinhome`. The compose file for that host may
bind Windows paths, but the Node.js application must only see container paths
such as `/rules/homelab-docs`, `/repos/<name>`, `/config/config.json`, and
`/data`.

The worker includes its app version in console status output and generated
reports so bug reports can reference the exact observer version.

## Recommended Stack

1. TypeScript.
2. Node.js worker.
3. SQLite.
4. React dashboard later.
5. OpenCode as the first execution backend.
6. Docker Compose for local/self-hosted deployment.
