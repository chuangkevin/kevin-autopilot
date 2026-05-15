## ADDED Requirements

### Requirement: Observation Cycle Recomputes Mood

Kevin Autopilot's background observation loop SHALL invoke `computeMood(config)` and persist the result to `data/mood-state.json` at the end of every successful cycle, after the reflection call. Failures in the mood compute SHALL NOT mark the cycle unsuccessful.

#### Scenario: Mood updates at cycle end

- **WHEN** an observation cycle finishes its reflection call (whether the reflection succeeded, was skipped, or errored)
- **THEN** Kevin Autopilot SHALL call `computeMood(config)`, persist the resulting `{ mood, computedAt, signals }` to `data/mood-state.json`, and proceed to schedule the next cycle.

#### Scenario: Mood compute failure is logged but non-fatal

- **WHEN** `computeMood` throws or its persistence write fails
- **THEN** Kevin Autopilot SHALL log a warning, the previous `data/mood-state.json` (if any) SHALL remain unchanged, the next cycle SHALL still be scheduled, and `ObservationLoopState.lastCycleSucceeded` SHALL still be `true` if the rest of the cycle succeeded.
