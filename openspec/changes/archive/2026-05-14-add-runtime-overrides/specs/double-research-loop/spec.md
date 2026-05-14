## ADDED Requirements

### Requirement: Observation Loop Reads Effective Config Each Cycle
Kevin Autopilot's background observation loop SHALL call `getEffectiveConfig` at the start of every cycle and SHALL use the returned config for all decisions about whether to call AI reflection, what cycle interval to schedule next, and whether to continue scheduling future cycles.

#### Scenario: Override flips reflection on between cycles
- **WHEN** `aiReflection.enabled` override is changed from false to true while the loop is idle
- **THEN** the next `executeRun` SHALL load the override and invoke the AI reflection module without requiring a container restart.

#### Scenario: Override stops scheduling
- **WHEN** `backgroundObservation.enabled` override is changed from true to false
- **THEN** the currently in-flight cycle (if any) SHALL finish normally, no further cycles SHALL be scheduled, and `ObservationLoopState.enabled` SHALL report `false` on the next status read.

#### Scenario: Override updates the next interval
- **WHEN** `backgroundObservation.intervalMs` override changes mid-run
- **THEN** the next scheduled cycle SHALL be queued at the new interval, and the persisted `nextRunAt` SHALL match.
