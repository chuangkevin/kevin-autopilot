## ADDED Requirements

### Requirement: Single-Node Enrichment Pipeline

Kevin Autopilot SHALL provide a single-node Gemini enrichment pipeline (`boost`) that rewrites one node's `thinking.*` fields and proposes up to 3 new edges to existing nodes, using the node itself, its direct graph neighbours, the latest `ObservationReport` snapshot, and the current `BacklogItem[]` as prompt context.

#### Scenario: Boost rewrites thinking and bumps observation counters

- **WHEN** `enrichNode(node, graph, snapshot, config)` returns successfully
- **THEN** Kevin Autopilot SHALL replace the node's `thinking.understanding`, `whyItMatters`, `nextExploration`, `questions`, `evidence`, and `missingEvidence` with the Gemini output, SHALL set `updatedAt` to now, SHALL increment `seenCount`, and SHALL set `lastSeenAt` to now.

#### Scenario: Boost creates new edges only to existing nodes

- **WHEN** the Gemini output proposes new edges
- **THEN** Kevin Autopilot SHALL accept up to 3 edges whose `to` ids exist in the graph, SHALL discard edges referencing unknown ids, and SHALL persist accepted edges with `source: 'boost'`.

#### Scenario: Boost fails

- **WHEN** the Gemini call fails after retries or returns invalid JSON
- **THEN** Kevin Autopilot SHALL NOT modify the node, SHALL log the failure with the node id, and SHALL release the per-node lock so the user can retry.

### Requirement: Per-Node Boost Concurrency Lock

Kevin Autopilot SHALL enforce a per-node concurrency lock around `enrichNode` such that two parallel boosts targeting the same node are not allowed; parallel boosts on different nodes are allowed.

#### Scenario: Second boost on same node rejected

- **WHEN** a boost on node X is in flight and another `POST /api/idea/X/boost` arrives
- **THEN** the second request SHALL respond `409 { status: 'already_running' }` without invoking Gemini.

#### Scenario: Boosts on different nodes run in parallel

- **WHEN** two boosts target distinct nodes X and Y
- **THEN** Kevin Autopilot SHALL execute both concurrently subject only to the existing Gemini key-pool semantics.

#### Scenario: Lock released on completion or error

- **WHEN** a boost finishes (success or failure)
- **THEN** the per-node lock SHALL be released so subsequent boosts on that node may run.

### Requirement: Boost API Endpoints Are Trusted-Settings Gated

`POST /api/idea/:id/boost` and `GET /api/idea/:id/boost-status` SHALL match the existing `isTrustedSettingsRequest` guard used by `POST /api/deliberation`.

#### Scenario: Trusted source starts a boost

- **WHEN** `POST /api/idea/:id/boost` is called from a trusted source and no boost is in flight for that node
- **THEN** the response SHALL be `202 { status: 'started' }` and `enrichNode` SHALL begin asynchronously.

#### Scenario: Untrusted source rejected

- **WHEN** `POST /api/idea/:id/boost` is called from an untrusted source
- **THEN** the response SHALL be `403` with a plain-text explanation, and no Gemini call SHALL be made.

#### Scenario: Unknown node id rejected

- **WHEN** the requested node id is not present in the current graph
- **THEN** the response SHALL be `404` and the per-node lock SHALL NOT be acquired.

#### Scenario: Status reports running or idle

- **WHEN** `GET /api/idea/:id/boost-status` is called
- **THEN** the response SHALL be `{ status: 'running' | 'idle', updatedAt: string | null }` where `updatedAt` is the node's current `updatedAt` value, regardless of trust gate (read-only).

### Requirement: Deliberation Engine Reuses Boost As Anchor-Enrichment Step 0

The deliberation engine SHALL reuse `enrichNode` as its step 0 when an `anchorNodeId` is provided, so personas always debate context that has just been enriched by the same pipeline as a standalone boost.

#### Scenario: Anchored deliberation enriches before pickRoles

- **WHEN** `runDeliberation` is invoked with `options.anchorNodeId` set to an existing node id
- **THEN** Kevin Autopilot SHALL call `enrichNode` on that node, await its completion, and only then invoke `pickRoles` with the post-enrichment graph snapshot.

#### Scenario: Anchor enrichment failure aborts deliberation

- **WHEN** the anchor enrichment fails
- **THEN** the deliberation SHALL abort, `POST /api/deliberation` SHALL respond `500 { error: 'anchor-enrichment failed' }`, no personas SHALL be deployed, and no `DeliberationRecord` SHALL be written.

#### Scenario: No anchor supplied skips enrichment

- **WHEN** `runDeliberation` is invoked without `options.anchorNodeId`
- **THEN** Kevin Autopilot SHALL skip `enrichNode` and execute the existing pickRoles → personas → synthesis pipeline against the whole-graph snapshot exactly as before this change.
