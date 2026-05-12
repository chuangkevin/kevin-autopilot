## ADDED Requirements

### Requirement: Graph-First Home Cockpit
Kevin Autopilot SHALL present the home page as a neural cockpit centered on the visible Kevin Autopilot double rather than as a report-first dashboard.

#### Scenario: Open home page without typing
- **WHEN** Kevin opens the home page without submitting new text
- **THEN** the page shows a visible graph of current thought nodes and relationships, plus a concise double status summary.

#### Scenario: Preserve read-only boundary
- **WHEN** the cockpit shows generated ideas, research seeds, project signals, or task candidates
- **THEN** it clearly states that Kevin Autopilot may observe and prepare artifacts but does not modify target repos, commit, push, deploy, read unmanaged secrets, or run destructive actions.

### Requirement: Node Selection Panel
Kevin Autopilot SHALL allow Kevin to select a graph node and inspect what the double understands about that node.

#### Scenario: Select graph node
- **WHEN** Kevin selects a graph node
- **THEN** the page shows the node type, summary, source, connected nodes, visible thinking summary, confidence, and safe next actions.

#### Scenario: Node has no strong evidence
- **WHEN** Kevin selects a node based on weak or suspected evidence
- **THEN** the panel marks it as needing more evidence instead of presenting it as implementation-ready.

### Requirement: Exploration Actions
Kevin Autopilot SHALL expose exploration actions from a selected node without treating them as autonomous mutation approval.

#### Scenario: Extend selected node
- **WHEN** Kevin chooses to extend a selected node
- **THEN** Kevin Autopilot creates or previews Autopilot-owned extension/research nodes linked to the selected node without changing target repositories.

#### Scenario: Convert to OpenCode task
- **WHEN** Kevin chooses to turn a qualified node into an OpenCode task
- **THEN** Kevin Autopilot shows a bounded prompt and approval/risk context for copying, not automatic execution.

### Requirement: Fast Typed Capture
Kevin Autopilot SHALL keep a fast plain-text capture path for Kevin's typed thoughts, but the cockpit SHALL remain useful even when no text is entered.

#### Scenario: Capture typed idea
- **WHEN** Kevin submits a plain-text idea from the cockpit
- **THEN** the idea is stored as an Autopilot-owned idea node, keywords are extracted, project relationships are suggested, and the graph updates with related nodes.

#### Scenario: No manual input
- **WHEN** Kevin has not submitted a new idea recently
- **THEN** the cockpit still shows proactive nodes from observation, stored ideas, project signals, and research seeds.
