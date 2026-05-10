# Kevin Autopilot

Kevin Autopilot is a planned background agent service that continuously looks
for useful work, thinks with Kevin's decision model, and turns safe findings into
bounded tasks for OpenCode or another coding agent.

The first implementation is a read-only Dockerized observer and idea intake
prototype. It runs consistently on different HomeProject hosts without hard-coded
application paths.

## Goal

Build an AI system that can proactively:

1. Notice repeated pain, broken workflows, stale docs, failing checks, and small
   improvement opportunities.
2. Rank work using Kevin's priorities: user experience, stability, and
   verifiability.
3. Decide whether a task can be done automatically, needs Kevin approval, or must
   be blocked.
4. Produce bounded OpenCode prompts for safe implementation.
5. Verify, commit, and push completed low-risk changes when allowed.

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
7. Score and classify tasks.
8. Show a daily or on-demand report.
9. Generate OpenCode prompts, but do not automatically run implementation.

Version 0.2 adds idea intake and AI thinking through `@kevinsisi/ai-core`, but it
still does not execute implementation automatically.

Version 0.3 should turn accepted ideas into project handoff plans: Kevin writes
rough thoughts, Autopilot asks only the missing product or safety questions, then
prepares the project plan, repo/setup steps, architecture, specs, implementation
tasks, and verification checklist.

## Non-Goals For v0.1

1. No autonomous file modification.
2. No deployment.
3. No secret access.
4. No production actions.
5. No data deletion or rebuild.
6. No force push.

## AI Thinking

v0.2 uses `@kevinsisi/ai-core` for idea analysis when AI is configured. The
dependency is pinned to verified commit
`f42e3f4ceb14886604bd0c7f248071018c85ff82`. The first integration uses Gemini
through ai-core's `GeminiClient` and `KeyPool`, with a deterministic fallback
when no key is configured or the AI call fails.

Configuration uses environment variables for keys; do not write keys into config
files:

```powershell
$env:GEMINI_API_KEY="<local key>"
$env:KEVIN_AUTOPILOT_CONFIG="$PWD\config\kevinhome.windows.example.json"
npm run web
```

Known limitation: ai-core's current `GenerateParams` API does not expose Gemini
`responseMimeType` or `thinkingBudget`, so v0.2 enforces JSON by prompt and
parser validation. This should move into ai-core before relying on structured AI
decisions for higher-risk automation.

## Status

v0.2 prototype started. See `docs/` for architecture, safety, and OpenCode
workflow.

## Run Observer Locally

Build and run the read-only observer once:

```powershell
npm install
npm run build
$env:KEVIN_AUTOPILOT_CONFIG="$PWD\config\kevinhome.windows.example.json"
npm run observe
```

Run the Dockerized `kevinhome` observer once:

```powershell
docker compose -f docker-compose.kevinhome.yml run --rm kevin-autopilot
```

Reports are written to `data/`, which is intentionally ignored by git.
