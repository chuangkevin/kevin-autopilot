## ADDED Requirements

### Requirement: Typed Idea Graph Nodes
Kevin Autopilot SHALL store Autopilot-owned graph nodes with explicit types for idea, keyword, project, signal, research, extension, and task concepts.

#### Scenario: Store graph node
- **WHEN** Kevin Autopilot creates a graph node
- **THEN** the node records its id, type, title, summary, source, created time, updated time, confidence, and read-only safety status.

#### Scenario: Project node source
- **WHEN** Kevin Autopilot creates a project node
- **THEN** the node is derived from configured repository/service metadata and does not require reading unmanaged secrets or writing to the target project.

### Requirement: Typed Idea Graph Edges
Kevin Autopilot SHALL store typed relationships between graph nodes so Kevin can understand why nodes are connected.

#### Scenario: Store graph edge
- **WHEN** Kevin Autopilot links two nodes
- **THEN** the edge records its type, source node id, target node id, rationale, confidence, and source provenance.

#### Scenario: Explain relationship
- **WHEN** Kevin inspects an edge or a connected node
- **THEN** Kevin Autopilot shows a human-readable explanation such as contains keyword, resembles project, extends idea, integrates with project, needs evidence, can become research, or can become OpenCode task.

### Requirement: Graph Continuity
Kevin Autopilot SHALL persist graph records under Autopilot-owned data so the neural cockpit can grow across observation cycles.

#### Scenario: Restart service
- **WHEN** Kevin Autopilot restarts
- **THEN** previously stored graph nodes and edges remain available unless they were archived or ignored.

#### Scenario: Filter old nodes
- **WHEN** the graph has more nodes than can be shown clearly
- **THEN** the cockpit can focus the visible graph by recency, selected node neighborhood, node type, or interesting/ignored status.

### Requirement: Existing Records Become Graph Records
Kevin Autopilot SHALL project existing ideas, project radar items, observation candidates, and OpenCode handoff candidates into graph nodes and edges.

#### Scenario: Existing idea appears in graph
- **WHEN** an idea record exists
- **THEN** Kevin Autopilot exposes it as an idea node linked to extracted keyword nodes, related project nodes, and generated extension/task nodes when available.

#### Scenario: Project anomaly appears in graph
- **WHEN** an observation candidate identifies a project signal or anomaly
- **THEN** Kevin Autopilot exposes it as a signal node linked to the affected project and any task or evidence-collection node.
