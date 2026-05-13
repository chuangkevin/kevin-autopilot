## ADDED Requirements

### Requirement: Proactive Read-Only Thought Generation
Kevin Autopilot SHALL generate Autopilot-owned proactive thought nodes from configured project observations, stored ideas, recurring keywords, and safe deterministic heuristics without requiring Kevin to type first.

#### Scenario: Daily thought seed generation
- **WHEN** the background observation loop completes
- **THEN** Kevin Autopilot may add research, extension, signal, or task nodes that explain what the double found interesting and why.

#### Scenario: No external web access configured
- **WHEN** no approved web search source is configured
- **THEN** Kevin Autopilot generates research queries or seeds but does not claim it searched the public web.

### Requirement: Dream Nodes Are Labeled As Speculation
Kevin Autopilot SHALL allow dream-like speculative nodes that make the double feel alive, but SHALL distinguish them from evidence-backed project signals.

#### Scenario: Dream node shown in cockpit
- **WHEN** Kevin Autopilot shows a dream-like speculative idea or association
- **THEN** the node is labeled as a dream/research seed and includes why the double imagined it, without claiming it is a verified fact.

#### Scenario: Dream node becomes actionable
- **WHEN** Kevin asks to extend or turn a dream node into work
- **THEN** Kevin Autopilot first converts it into a research, prototype, or OpenCode handoff candidate with explicit missing evidence and safety boundaries.

### Requirement: Visible Double Thinking Summary
Kevin Autopilot SHALL expose reviewable thinking summaries for proactive thoughts and selected graph nodes.

#### Scenario: Show why a node exists
- **WHEN** Kevin selects a proactive node
- **THEN** Kevin Autopilot shows a visible summary covering what the double noticed, why it may matter to Kevin, related keywords/projects, missing evidence, and the next exploration step.

#### Scenario: Avoid private chain-of-thought
- **WHEN** Kevin Autopilot shows thinking output
- **THEN** the output is a structured explanation artifact and not raw private model chain-of-thought.

### Requirement: Idea Extension Suggestions
Kevin Autopilot SHALL suggest extensions from selected ideas or keywords into research directions, prototype ideas, existing-project integrations, or bounded OpenCode tasks.

#### Scenario: Extend idea node
- **WHEN** Kevin extends an idea node
- **THEN** Kevin Autopilot creates or previews extension nodes that describe possible research, prototype, integration, or task directions.

#### Scenario: Existing project integration
- **WHEN** an extension resembles a configured project or service
- **THEN** Kevin Autopilot links the extension to that project and explains whether it should be integrated, researched further, or kept separate.

### Requirement: Web Research Boundary
Kevin Autopilot SHALL treat public web research as an explicit approved-source capability rather than an implied behavior.

#### Scenario: Web research not yet enabled
- **WHEN** the cockpit shows research nodes before web research sources are configured
- **THEN** the nodes are labeled as research seeds or planned queries, not as fetched web findings.

#### Scenario: Future web source enabled
- **WHEN** an approved web research source is configured in a later change
- **THEN** every fetched finding must record source URL, query, fetched time, timeout/error status, and why it was connected to Kevin's graph.
