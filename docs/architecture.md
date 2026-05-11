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
├─ Project Bootstrap Planner
├─ OpenCode Prompt Builder
├─ Verification Planner
├─ Task Store
└─ Dashboard / Report
```

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
It should score candidates using Kevin's priorities and classify whether the work
can be auto-prepared, needs approval, should only be observed, or is blocked.

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
