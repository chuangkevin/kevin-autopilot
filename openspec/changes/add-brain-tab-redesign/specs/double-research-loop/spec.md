## MODIFIED Requirements

### Requirement: Proactive Read-Only Thought Generation

Kevin Autopilot SHALL generate Autopilot-owned proactive thought nodes from configured project observations, stored ideas, recurring keywords, and safe deterministic heuristics without requiring Kevin to type first. Candidate sampling for proactive thought generation SHALL route through `getActiveNodes(graph)` so that archived nodes are never re-surfaced as proactive thoughts.

#### Scenario: Daily thought seed generation

- **WHEN** the background observation loop completes
- **THEN** Kevin Autopilot may add research, extension, signal, or task nodes that explain what the double found interesting and why, drawing candidate context only from `getActiveNodes(graph)`.

#### Scenario: No external web access configured

- **WHEN** no approved web search source is configured
- **THEN** Kevin Autopilot SHALL generate research queries or seeds but SHALL NOT claim it searched the public web.

#### Scenario: Archived node skipped from candidate pool

- **WHEN** a node has `archived === true` at the start of an observation cycle
- **THEN** that node SHALL NOT be sampled as a candidate seed, MAY NOT receive new outbound edges from this cycle's proactive generation, and SHALL NOT contribute to the cycle's excitement score.

### Requirement: Idea Extension Suggestions

Kevin Autopilot SHALL suggest extensions from selected ideas or keywords into research directions, prototype ideas, existing-project integrations, or bounded OpenCode tasks. Archived nodes SHALL NOT be eligible parents for extension generation.

#### Scenario: Extend idea node

- **WHEN** Kevin extends an idea node whose `archived` is not `true`
- **THEN** Kevin Autopilot SHALL create or preview extension nodes that describe possible research, prototype, integration, or task directions.

#### Scenario: Existing project integration

- **WHEN** an extension resembles a configured project or service
- **THEN** Kevin Autopilot SHALL link the extension to that project and SHALL explain whether it should be integrated, researched further, or kept separate.

#### Scenario: Archived parent refused

- **WHEN** an extension is requested against a node whose `archived === true`
- **THEN** Kevin Autopilot SHALL refuse the extension and SHALL surface "node is archived; unarchive first" instead of silently generating new nodes off a frozen parent.
