# idea-graph Specification

## Purpose
TBD - created by archiving change add-ai-graph-reflection. Update Purpose after archive.
## Requirements
### Requirement: IdeaRecord Carries AI-Source Provenance
Kevin Autopilot SHALL extend `IdeaRecord` with an optional `aiSource` field, an optional `aiReflection` provenance block, and SHALL filter dismissed AI-generated ideas out of the visible idea list.

#### Scenario: User-submitted idea persists with user source
- **WHEN** Kevin submits a new idea through the dashboard or `/api/ideas` POST
- **THEN** the saved `IdeaRecord` SHALL omit `aiSource` or set it to `'user'`, and the cockpit SHALL render the idea card without the "AI 生" pill.

#### Scenario: AI-generated idea persists with provenance
- **WHEN** the AI reflection mints an idea seed
- **THEN** the saved `IdeaRecord` SHALL set `aiSource = 'ai-reflection'`, populate `aiReflection.evidence` from the AI output, and `aiReflection.generatedAt` and `aiReflection.model` from the reflection record.

#### Scenario: Dismissed AI idea drops out of the visible list
- **WHEN** an idea has been moved to `data/ideas-dismissed/` via the dismiss API
- **THEN** `listIdeas` SHALL NOT return the dismissed idea, `getIdea` SHALL respond as if the idea does not exist, and the graph projection SHALL NOT include the dismissed idea as an IDEA node.

#### Scenario: User idea cannot be dismissed by the AI dismiss path
- **WHEN** any caller invokes `POST /api/ideas/:id/dismiss` for an idea without `aiSource = 'ai-reflection'`
- **THEN** Kevin Autopilot SHALL respond 400 and SHALL NOT move the idea file.

### Requirement: EXTENSION Node Signature-Based Identity
Kevin Autopilot SHALL identify extension nodes by a deterministic signature derived from their parent id, normalised title, and top keywords, so the same conceptual extension does not produce multiple stored nodes across observation cycles or user-triggered extensions.

#### Scenario: Two cycles generate the same extension idea
- **WHEN** the background observation loop generates an EXTENSION node for an idea, and a later cycle generates an EXTENSION with the same parent, the same normalised title, and the same top keywords
- **THEN** Kevin Autopilot updates `lastSeenAt` and `seenCount` on the existing node instead of inserting a duplicate.

#### Scenario: User clicks Extend twice on the same node
- **WHEN** Kevin uses the in-drawer "延伸" action on the same parent node multiple times within one or more sessions
- **THEN** Kevin Autopilot stops inserting fresh nodes once the parent already has 6 active EXTENSION children, and instead upserts into the closest existing match by signature similarity or bumps the most recent EXTENSION child's `seenCount`.

#### Scenario: Distinct extensions stay distinct
- **WHEN** two extension candidates share the same parent but have different normalised titles or top keywords
- **THEN** they receive different signatures and remain as separate nodes.

### Requirement: Legacy EXTENSION Duplicate Migration
Kevin Autopilot SHALL collapse stored EXTENSION nodes that originated from the pre-v0.10.0 unbounded-id schema into the new signature-based identity on graph load, without requiring a manual migration step.

#### Scenario: Load graph containing legacy timestamp-suffix duplicates
- **WHEN** Kevin Autopilot loads `data/idea-graph.json` containing two or more EXTENSION nodes that map to the same new-style signature id
- **THEN** Kevin Autopilot keeps the oldest one by `createdAt`, rewrites every edge whose endpoint pointed at a loser so it points at the winner, and drops the losing duplicates from the in-memory graph.

#### Scenario: Persist deduplicated graph on next save
- **WHEN** Kevin Autopilot writes the in-memory graph back to disk after a normal observation or extension action
- **THEN** the persisted `data/idea-graph.json` reflects the deduplicated nodes and edges, so the migration is permanent without an explicit migration script.

#### Scenario: Non-extension nodes are not affected
- **WHEN** the loader encounters IDEA, KEYWORD, RESEARCH, PROJECT, SIGNAL, or TASK nodes
- **THEN** their ids and identities are preserved verbatim, regardless of any matching signature collision logic.

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

