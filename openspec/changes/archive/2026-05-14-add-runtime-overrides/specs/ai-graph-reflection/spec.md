## ADDED Requirements

### Requirement: Reflection Module Respects Effective Overrides
Kevin Autopilot's AI reflection module SHALL receive its config from the caller's effective-config read (file config merged with runtime overrides), so flipping `aiReflection.enabled`, `aiReflection.maxOutputTokens`, or `aiReflection.maxPendingAiIdeas` via the settings API changes reflection behaviour on the next cycle without a restart.

#### Scenario: Override disables reflection
- **WHEN** the effective `aiReflection.enabled` is false because of an override
- **THEN** the reflection call SHALL return `skipped: true, reason: 'disabled'` even if the file config sets `aiReflection.enabled = true`.

#### Scenario: Override raises the pending cap
- **WHEN** the effective `aiReflection.maxPendingAiIdeas` differs from the file-config value
- **THEN** `maxNewSeeds = max(0, effectiveCap - pendingCount)` SHALL use the effective cap, and the `pendingAiIdeasCap` returned by `/api/reflection/state` SHALL match.

#### Scenario: Override changes token budget
- **WHEN** the effective `aiReflection.maxOutputTokens` differs from the file-config value
- **THEN** the next Gemini call SHALL use the effective value as `maxOutputTokens`.
