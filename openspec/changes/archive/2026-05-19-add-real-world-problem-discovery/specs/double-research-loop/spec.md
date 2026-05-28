## MODIFIED Requirements

### Requirement: Proactive Read-Only Thought Generation

Kevin Autopilot SHALL generate Autopilot-owned proactive thought nodes from configured project observations, stored ideas, recurring keywords, safe deterministic heuristics, and real-world problem discovery outputs without requiring Kevin to type first.

#### Scenario: Daily thought seed generation

- **WHEN** the background observation loop completes
- **THEN** Kevin Autopilot may add research, extension, signal, task, or problem-opportunity nodes that explain what the double found interesting and why.

#### Scenario: No external web access configured

- **WHEN** no approved web search source is configured
- **THEN** Kevin Autopilot generates research queries, Kevin-owned problem candidates, or planned source probes but does not claim it searched the public web.

#### Scenario: Problem discovery stage fails

- **WHEN** the problem discovery stage fails, times out, or has no acceptable source signals
- **THEN** the observation loop SHALL still finish successfully if its existing observation work succeeded, and SHALL persist a diagnostic skip/error record for the problem-discovery stage.
