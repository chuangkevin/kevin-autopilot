## ADDED Requirements

### Requirement: Background Cycle Invokes AI Reflection
Kevin Autopilot SHALL, at the end of every successful background observation cycle (after graph refresh and backlog merge), invoke the AI reflection module described in the `ai-graph-reflection` capability and persist the resulting record without blocking the next cycle's scheduling.

#### Scenario: Successful cycle triggers reflection
- **WHEN** an observation cycle finishes with a refreshed graph and merged backlog
- **THEN** Kevin Autopilot SHALL call the reflection module exactly once, persist the returned `ReflectionRecord` (or `SkippedReflectionRecord`) to `data/reflection-state.json`, and update `ObservationLoopState.lastReflectionAt` to the reflection timestamp.

#### Scenario: Reflection throws or times out
- **WHEN** the reflection module throws, times out, or returns `skipped: true, reason: 'error'`
- **THEN** Kevin Autopilot SHALL still mark the observation cycle successful, SHALL still schedule the next cycle, and SHALL persist the skipped/error reflection state with its reason so the cockpit can display "反思離線".

#### Scenario: AI reflection disabled
- **WHEN** `aiReflection.enabled` is false in config
- **THEN** Kevin Autopilot SHALL NOT call the AI, SHALL persist `skipped: true, reason: 'disabled'`, and the cycle SHALL behave exactly as it did before this change (graph + backlog refresh only).
