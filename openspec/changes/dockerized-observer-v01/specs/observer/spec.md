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
