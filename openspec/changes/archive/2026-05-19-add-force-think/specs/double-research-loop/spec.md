## ADDED Requirements

### Requirement: Force Run Bypasses Enabled Guard
`ObservationLoop` SHALL expose a `forceRun()` method that executes a full observation cycle (observe, merge backlog, build idea graph, reflect) regardless of the current `backgroundObservation.enabled` value, while still respecting AI key availability.

#### Scenario: Force run fires when loop is disabled
- **WHEN** `forceRun()` is called and `backgroundObservation.enabled` is `false` (either from file config or runtime override)
- **THEN** the loop SHALL execute a full `executeRun()` cycle and return the resulting `ObservationReport`, and SHALL NOT permanently change the `enabled` state.

#### Scenario: Force run does not create duplicate in-flight
- **WHEN** `forceRun()` is called while a scheduled `runOnce()` is already in flight
- **THEN** `forceRun()` SHALL wait for the in-flight run to complete and then start a new cycle, rather than returning the existing in-flight promise.

#### Scenario: Force run respects AI key guard
- **WHEN** `forceRun()` is called and no Gemini keys are configured
- **THEN** the cycle SHALL proceed through observe and backlog merge but SHALL skip reflection (same as the regular cycle's skip behaviour), and no error SHALL be thrown.
