# Observer Specification

## ADDED Requirements

### Requirement: Dockerized Runtime

Kevin Autopilot v0.1 SHALL be designed to run as a Docker service with
deployment-specific paths supplied through configuration or mounts.

#### Scenario: Different host layout

- GIVEN Autopilot is deployed on a host that does not use Kevin's Windows paths
- WHEN the service starts
- THEN it resolves rule sources, repositories, services, and data paths from
  configuration rather than hard-coded application paths.

#### Scenario: Initial kevinhome deployment

- GIVEN the first deployment runs on `kevinhome`
- WHEN Docker Compose mounts local HomeProject paths into the container
- THEN the application uses only container paths and records `kevinhome` as the
  environment name in reports.

### Requirement: Configurable Rule Sources

Kevin Autopilot v0.1 SHALL load `homelab-docs` and optional user-selected rule
sources from configured locations.

#### Scenario: Multiple rule sources

- GIVEN Kevin configures `homelab-docs` and another rule source
- WHEN Autopilot prepares a decision or OpenCode prompt
- THEN it records which rule files were loaded and uses those resolved sources in
  the report or prompt.

### Requirement: Persona Across Environments

Kevin Autopilot v0.1 SHALL apply Kevin's persona as the stable decision model
while respecting environment-specific rule constraints.

#### Scenario: Environment-specific restriction

- GIVEN an environment rule forbids reaching a specific service endpoint
- WHEN Autopilot scores candidate work
- THEN it keeps Kevin's persona priorities but marks endpoint observation as
  blocked or requiring approval.

### Requirement: First-Phase Service Observation

Kevin Autopilot v0.1 SHALL observe all configured services before generating
candidate tasks.

#### Scenario: Service inventory report

- GIVEN services are configured from docs or an explicit config file
- WHEN an observation run completes
- THEN the report includes each service's name, source provenance, known host or
  domain, observation status, risk level, and not-done items.

### Requirement: Read-Only Safety

Kevin Autopilot v0.1 SHALL avoid secret files, mutable service commands,
production changes, commits, pushes, and deployments.

#### Scenario: Secret-like file discovered

- GIVEN a configured repository contains `.env` or credential JSON files
- WHEN Autopilot scans that repository
- THEN it skips those files and records that secret paths were intentionally not
  inspected.

### Requirement: Future Idea Handoff Boundary

Kevin Autopilot v0.1 SHALL document idea handoff as a future mode, not as part of
the read-only observer execution path.

#### Scenario: Raw idea received during v0.1

- GIVEN Kevin provides a raw idea
- WHEN v0.1 processes the idea
- THEN it may record planning notes or propose next questions, but it does not
  create repositories, write product code, deploy, commit, or push.

### Requirement: AI-Core Thinking With Fallback

Kevin Autopilot SHALL use `@kevinsisi/ai-core` for AI-backed idea analysis when
configured, and SHALL preserve deterministic fallback behavior when AI is
unavailable or invalid.

#### Scenario: AI key missing

- GIVEN AI thinking is enabled but no Gemini API key is configured
- WHEN Kevin submits an idea
- THEN Autopilot stores the raw idea, classifies it with deterministic fallback,
  and records that ai-core thinking did not run.

#### Scenario: AI analysis succeeds

- GIVEN AI thinking is enabled and a Gemini API key is available
- WHEN Kevin submits an idea
- THEN Autopilot uses ai-core to classify the idea, stores the result, and marks
  the thinking mode as `ai-core`.

### Requirement: App-Owned Gemini Key Import

Kevin Autopilot SHALL allow Kevin to import Gemini API keys through the dashboard
without writing keys into config files or `.env` files.

#### Scenario: Batch key paste

- GIVEN Kevin pastes Gemini keys separated by commas, newlines, `KEY=VALUE`, or
  `export KEY=VALUE` formats
- WHEN Autopilot imports the keys
- THEN it validates keys with Gemini when AI is enabled, stores valid unique keys
  in Autopilot-owned local data, and returns only counts plus masked suffixes.

#### Scenario: AI thinking key precedence

- GIVEN stored keys exist under Autopilot-owned data
- WHEN AI thinking runs
- THEN Autopilot uses the stored key pool before falling back to environment keys.

### Requirement: Read-Only Superpowers Agent Handoff

Kevin Autopilot SHALL record the selected superpowers workflow and a minimal
multi-agent question-answer handoff for each idea.

#### Scenario: Idea is stored

- GIVEN Kevin submits an idea
- WHEN Autopilot classifies and stores the idea
- THEN the idea record includes `using-superpowers` plus relevant workflow skills
  and Kevin persona, safety reviewer, and spec planner Q&A metadata.

### Requirement: Kevinhome CI/CD Deployment

Kevin Autopilot SHALL deploy to `kevinhome` through the HomeProject desktop
self-hosted runner pattern and expose the dashboard at `kevin.sisihome.org`.

#### Scenario: Main branch release

- GIVEN changes are pushed to `main`
- WHEN CI succeeds
- THEN GitHub Actions builds and pushes a `linux/amd64` Docker image for
  `ghcr.io/chuangkevin/kevin-autopilot`.

#### Scenario: Desktop deployment

- GIVEN the Docker image is published
- WHEN the deploy workflow runs on the `kevin-autopilot-prod` self-hosted runner
- THEN it pulls the commit image on `kevinhome`, starts Web mode on port `3023`,
  and verifies `/health` reports the expected version.

#### Scenario: Private domain routing

- GIVEN RPi Caddy receives `kevin.sisihome.org`
- WHEN the request is routed
- THEN Caddy reverse-proxies to `100.83.112.20:3023` without exposing the service
  outside the existing private Tailscale `sisihome.org` model.

### Requirement: Read-Only Project Handoff Plan

Kevin Autopilot SHALL turn each stored idea into a read-only project handoff plan
without creating repositories, deploying, modifying target repositories, reading
unmanaged secrets, or committing/pushing other projects.

#### Scenario: Idea is accepted

- GIVEN Kevin submits a raw idea
- WHEN Autopilot stores the idea record
- THEN the record includes a `projectHandoff` with candidate project/repo names,
  objective, first artifact, open questions, approval gates, architecture notes,
  OpenSpec draft, implementation tasks, verification checklist, and bounded
  OpenCode prompt.

#### Scenario: Risky idea is blocked

- GIVEN the idea includes production, secret, deployment, or destructive action
  terms
- WHEN Autopilot creates the handoff plan
- THEN the first artifact is a risk review and approval checklist, and the plan
  keeps all mutating work behind explicit approval gates.
