## ADDED Requirements

### Requirement: Reflection Uses Kevin Voice Via Persona Prefix

Kevin Autopilot's reflection module SHALL prepend the persona prefix returned by `buildPersonaPrefix('reflection', config)` to its existing system instruction before every Gemini call. The reflection output is expected to reflect Kevin's priorities, problem-solving pattern, and report shape as defined in `PERSONA.md`.

#### Scenario: Reflection prompt carries persona prefix

- **WHEN** the background observation loop invokes the reflection module on a successful cycle
- **THEN** the Gemini call SHALL receive a `systemInstruction` whose first portion is the output of `buildPersonaPrefix('reflection', config)`, followed by the delimiter `"—— 下面是這次任務 ——"`, followed by the existing reflection task instruction.

#### Scenario: Persona prefix failure does not abort reflection

- **WHEN** `buildPersonaPrefix` throws (PERSONA.md missing, mood/preference read failure)
- **THEN** the reflection module SHALL fall back to the minimal stub prefix, log a warning, and continue with the reflection so the cycle still produces a record.
