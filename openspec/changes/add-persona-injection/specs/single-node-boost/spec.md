## ADDED Requirements

### Requirement: Boost Uses Kevin Voice Via Persona Prefix

Kevin Autopilot's single-node boost SHALL prepend the persona prefix returned by `buildPersonaPrefix('boost', config)` to its existing system instruction before every Gemini call. The boost output (rewritten `thinking.*` and edge candidates) is expected to reflect Kevin's priorities and dislikes.

#### Scenario: Boost prompt carries persona prefix

- **WHEN** `enrichNode` is invoked from either a standalone `POST /api/idea/:id/boost` or from the deliberation engine's anchor step 0
- **THEN** the Gemini call SHALL receive a `systemInstruction` whose first portion is the output of `buildPersonaPrefix('boost', config)`, followed by the delimiter, followed by the existing boost task instruction.

#### Scenario: Persona prefix failure does not abort boost

- **WHEN** `buildPersonaPrefix` throws
- **THEN** boost SHALL use the minimal stub prefix, log a warning, and proceed; the per-node lock and persistence behavior SHALL be unchanged.
