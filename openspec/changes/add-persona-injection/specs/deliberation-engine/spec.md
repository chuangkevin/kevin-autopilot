## ADDED Requirements

### Requirement: Deliberation Uses A Fixed Four-Cast By Default

Kevin Autopilot SHALL run deliberation with four fixed cast members (`engineer`, `designer`, `risk`, `vacation`, all named "Kevin") by default. Each cast member's system instruction SHALL be produced by `buildCastPrefix(castId, config)`. The cast member identities (display name, lens sections, characteristic challenges) SHALL be defined in `src/persona.ts` and SHALL NOT change between deliberation runs.

#### Scenario: Default deliberation deploys all four cast

- **WHEN** `runDeliberation(config, report, graph, backlog, options)` is invoked with PERSONA.md present
- **THEN** Kevin Autopilot SHALL bypass `pickRoles`, set `personas` to the four cast members in canonical order (`engineer`, `designer`, `risk`, `vacation`), and run round 0 / round 1 / round 2 / synthesis with these four cast members as before.

#### Scenario: Cast prompts include their distinct preamble

- **WHEN** the four cast members run round 0 in parallel
- **THEN** each Gemini call's `systemInstruction` SHALL begin with the output of `buildCastPrefix(castId, config)` for that cast, which includes a cast-specific identity preamble before the shared PERSONA.md content.

#### Scenario: Cast loading failure falls back to dynamic pickRoles

- **WHEN** `buildCastPrefix` throws for any cast member (PERSONA.md missing, cast definition error)
- **THEN** Kevin Autopilot SHALL log a warning, invoke the legacy `pickRoles` dynamic-persona path, and continue the deliberation with those personas so a record is still produced.

#### Scenario: Mood influences cast speaking emphasis

- **WHEN** `buildCastPrefix` composes its mood line
- **THEN** the line SHALL include a hint about which cast member should speak louder for the current mood: `tense` → 風險 Kevin, `excited` → 工程師 Kevin, `idle` → 休假 Kevin, `flow` → equal weight.

#### Scenario: Persisted record uses cast names

- **WHEN** a deliberation completes via the four-cast path
- **THEN** the persisted `DeliberationRecord.personas[]` SHALL contain the four cast members' display names and perspectives; the `anchorNodeId` field added in v0.16.0 SHALL continue to be populated when an anchor was supplied.
