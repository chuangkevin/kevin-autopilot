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

Version 0.3 adds app-owned Gemini key import and records the first read-only
superpowers / multi-agent handoff summary for each accepted idea. Kevin can paste
keys through the dashboard; Autopilot stores them only under ignored local
`data/keys.json` and shows only masked suffixes in API/UI responses.

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

Version 0.5.2 adds token-protected remote Gemini key management for the private
domain. Loopback clients can still manage keys directly; remote clients only see
the import UI when `AUTOPILOT_KEY_IMPORT_TOKEN` is configured, and writes must
send that token in `x-autopilot-admin-token`.

Version 0.6 should add an approval-resume flow so Kevin can explicitly approve a
single pending handoff action and Autopilot can resume it deterministically.

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

v0.5 prototype started. See `docs/` for architecture, safety, and OpenCode
workflow.

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

Key management writes are loopback-only unless `AUTOPILOT_KEY_IMPORT_TOKEN` is
set in the deployment environment. When configured, the routed domain displays a
password field and sends the token as `x-autopilot-admin-token`; Autopilot stores
only Gemini keys under ignored `data/keys.json`, never the admin token.

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
