## ADDED Requirements

### Requirement: Adaptive Observation Timer
Kevin Autopilot's background loop SHALL adjust its cadence based on an excitement score derived from each cycle's outputs, entering excited mode (faster cycles), cooling mode (slightly slower), or normal mode, with a minimum floor of 60 seconds.

#### Scenario: Excited mode after high-signal cycle
- **WHEN** a cycle produces a high excitement score (new interesting backlog signals, AI-minted ideas)
- **THEN** the loop SHALL enter `excitementMode: 'excited'`, set the next interval to `excitedIntervalMs`, and expose `excitementMode: 'excited'` on `GET /api/observation-loop`.

#### Scenario: Cooling mode after excited cycle
- **WHEN** a cycle runs in excited mode but the excitement score drops below the excited threshold
- **THEN** the loop SHALL enter `excitementMode: 'cooling'` and schedule the next cycle at `coolingIntervalMs`.

#### Scenario: Minimum interval floor
- **WHEN** any computed next interval would be shorter than 60 seconds
- **THEN** the loop SHALL clamp the interval to 60 000 ms.
