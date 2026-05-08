# Architecture Plan

## System Shape

```text
Kevin Autopilot
├─ Scheduler
├─ Context Collector
├─ Persona Loader
├─ Thinking Engine
├─ Task Classifier
├─ Approval Gate
├─ OpenCode Prompt Builder
├─ Verification Planner
├─ Task Store
└─ Dashboard / Report
```

## Components

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

### OpenCode Prompt Builder

Generates bounded prompts with:

1. Persona and rule files to read.
2. Exact task objective.
3. Forbidden actions.
4. Files or repo scope.
5. Verification requirement.
6. Commit and push expectation when safe.

### Task Store

Use SQLite in the first implementation. Store tasks, decisions, runs, approvals,
and reports.

## Recommended Stack

1. TypeScript.
2. Node.js worker.
3. SQLite.
4. React dashboard later.
5. OpenCode as the first execution backend.
