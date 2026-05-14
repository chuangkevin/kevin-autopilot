## ADDED Requirements

### Requirement: Role Picker Selects Personas Before Each Deliberation
Before each deliberation run Kevin Autopilot SHALL call an AI role-picker that reads the current `ObservationReport`, idea graph, and backlog, and returns 2–4 named personas each with a distinct analytical perspective tailored to the current project state.

#### Scenario: Role picker produces personas
- **WHEN** a deliberation is triggered
- **THEN** the role-picker AI SHALL return between 2 and 4 `DeliberationPersona` objects each with a `name` and `perspective`, derived from the current project signals, before any independent analysis begins.

#### Scenario: Role picker fallback on AI error
- **WHEN** the role-picker AI call fails or returns an invalid response
- **THEN** the deliberation SHALL abort and `POST /api/deliberation` SHALL return a `500` with `{ error: 'role-picker failed' }` so the caller knows no personas were deployed.

### Requirement: Personas Independently Analyse Project State
Kevin Autopilot SHALL run one AI call per persona in parallel, each receiving the same `ObservationReport` snapshot and the persona's `perspective` as a system instruction, producing an independent analysis with key insights and identified challenges.

#### Scenario: Independent parallel analysis
- **WHEN** the role picker has returned N personas
- **THEN** Kevin Autopilot SHALL fire N AI calls concurrently, each with the full observation snapshot and its persona's perspective as the system instruction, and SHALL collect all N `PersonaRound` objects before advancing to the debate phase.

#### Scenario: Partial analysis failure
- **WHEN** one persona's AI call fails after retries
- **THEN** the deliberation SHALL continue with the remaining personas' outputs rather than aborting, and the failed persona SHALL be omitted from subsequent rounds.

### Requirement: Up To Two Debate Rounds
Kevin Autopilot SHALL run up to 2 debate rounds after the independent analysis. In each round every surviving persona reads all prior-round outputs and produces a response that challenges, confirms, or extends others' findings.

#### Scenario: Debate round fires
- **WHEN** round 0 (independent analysis) is complete and at least 2 persona outputs exist
- **THEN** Kevin Autopilot SHALL run round 1 where each persona receives all round-0 outputs concatenated with its own system instruction, and each produces a `PersonaRound` with `round: 1` containing updated key insights and specific challenges to other personas.

#### Scenario: Second debate round
- **WHEN** round 1 is complete
- **THEN** Kevin Autopilot SHALL run round 2 with the same mechanism using all round-0 and round-1 outputs as context, then stop — no further rounds SHALL be run.

#### Scenario: Only one persona survives
- **WHEN** fewer than 2 personas have outputs after round 0
- **THEN** Kevin Autopilot SHALL skip all debate rounds and proceed directly to synthesis.

### Requirement: Synthesis Agent Produces Summary And Seeds
After all debate rounds Kevin Autopilot SHALL call a synthesis AI that reads all persona outputs across all rounds and produces a deliberation summary, consensus points, blind spots found, and up to 3 `ReflectionIdeaSeed` objects to inject into the idea graph.

#### Scenario: Synthesis produces seeds
- **WHEN** all debate rounds are complete
- **THEN** the synthesis AI SHALL return a `DeliberationSynthesis` containing `summary`, `consensusPoints[]`, `blindspotsFound[]`, and `seeds[]` (max 3 `ReflectionIdeaSeed`), and each seed SHALL be passed to `createAiIdeaFromSeed()` to persist as an AI idea.

#### Scenario: Zero seeds on uninteresting deliberation
- **WHEN** the synthesis AI returns an empty `seeds` array
- **THEN** Kevin Autopilot SHALL complete the deliberation without creating any idea records, and `seedsInjected` SHALL be `0` in the stored record.

### Requirement: Deliberation Records Persisted And Retrievable
Kevin Autopilot SHALL write each completed deliberation to `data/deliberations/<id>.json` and expose the latest record at `GET /api/deliberation/latest`. A maximum of 10 records SHALL be kept; older ones are pruned on each new write.

#### Scenario: Record persisted after completion
- **WHEN** a deliberation finishes (synthesis done)
- **THEN** Kevin Autopilot SHALL write a `DeliberationRecord` to `data/deliberations/<YYYY-MM-DD-HHmmss>.json` containing `id`, `startedAt`, `finishedAt`, `environment`, `personas`, `rounds`, `synthesis`, `model`, and `tokenUsage`.

#### Scenario: Latest record returned
- **WHEN** `GET /api/deliberation/latest` is called and at least one record exists
- **THEN** the response SHALL be `{ status: 'idle' | 'running', record: DeliberationRecord }` where `record` is the most recently finished deliberation.

#### Scenario: No record exists
- **WHEN** `GET /api/deliberation/latest` is called and no deliberation has ever completed
- **THEN** the response SHALL be `{ status: 'idle', record: null }`.

#### Scenario: Deliberation in progress
- **WHEN** `GET /api/deliberation/latest` is called while a deliberation is running
- **THEN** the response SHALL be `{ status: 'running', record: <last completed or null> }`.

### Requirement: POST /api/deliberation Is Trusted-Settings Gated
`POST /api/deliberation` SHALL only accept requests from trusted sources (loopback, private LAN, Docker internal, or Tailscale) matching the existing `isTrustedSettingsRequest` guard.

#### Scenario: Trusted source triggers deliberation
- **WHEN** `POST /api/deliberation` is called from a trusted source and no deliberation is currently running
- **THEN** the response SHALL be `202 { status: 'started' }` and the deliberation SHALL begin asynchronously.

#### Scenario: Untrusted source rejected
- **WHEN** `POST /api/deliberation` is called from an untrusted source
- **THEN** the response SHALL be `403` with a plain-text explanation.

#### Scenario: Duplicate trigger while running
- **WHEN** `POST /api/deliberation` is called while a deliberation is already in flight
- **THEN** the response SHALL be `409 { status: 'already_running' }` and no second deliberation SHALL be started.
