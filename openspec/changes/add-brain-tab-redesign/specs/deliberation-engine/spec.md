## ADDED Requirements

### Requirement: Anchored Deliberation Focuses Personas On A Single Node

Kevin Autopilot's `runDeliberation` SHALL accept an optional `options.anchorNodeId: string | null`. When set, the deliberation engine SHALL focus every persona's prompt, every debate round, and the synthesis output on the anchor node by including its identity, post-enrichment thinking, keywords, and incident edges as a "central topic" preamble.

#### Scenario: Anchor preamble reaches every persona prompt

- **WHEN** `runDeliberation` is invoked with `options.anchorNodeId` set to an existing node id
- **THEN** the role-picker prompt, every persona's independent-analysis prompt, every debate-round prompt, and the synthesis prompt SHALL each include the anchor node's id, title, post-enrichment thinking, keywords, and incident edges as a "central topic to debate" block.

#### Scenario: Synthesis seeds reference the anchor when relevant

- **WHEN** the synthesis output proposes idea seeds related to the anchor's findings
- **THEN** the resulting `ReflectionIdeaSeed` records SHALL carry the anchor node id in their evidence trail so the cockpit can show "seeded from anchor X".

#### Scenario: Unknown anchor id treated as no anchor

- **WHEN** `options.anchorNodeId` is a non-empty string that does not match any node in the current graph
- **THEN** Kevin Autopilot SHALL log a warning, SHALL drop the anchor wiring, and SHALL run the deliberation against the whole-graph snapshot as if no anchor were provided.

### Requirement: Deliberation Candidate Sampling Skips Archived Nodes

Whenever `runDeliberation` builds the non-anchor context-node sample for personas (and the role-picker), it SHALL draw only from `getActiveNodes(graph)`. Archived nodes SHALL NOT be presented to any persona or to the role-picker as context.

#### Scenario: Archived node never appears in persona prompt

- **WHEN** a deliberation runs against a graph containing at least one node with `archived === true`
- **THEN** that node SHALL NOT appear in the role-picker prompt, in any persona's independent-analysis prompt, in any debate-round context, or in the synthesis prompt, unless it is itself the anchor.

#### Scenario: Anchor that is archived is unarchived implicitly is refused

- **WHEN** `options.anchorNodeId` points to a node with `archived === true`
- **THEN** Kevin Autopilot SHALL respond `400 { error: 'anchor is archived' }` from `POST /api/deliberation` and SHALL NOT begin the deliberation; the user SHALL be required to unarchive the node first.

## MODIFIED Requirements

### Requirement: POST /api/deliberation Is Trusted-Settings Gated

`POST /api/deliberation` SHALL only accept requests from trusted sources (loopback, private LAN, Docker internal, or Tailscale) matching the existing `isTrustedSettingsRequest` guard. Requests MAY include an optional `{ anchorNodeId?: string | null }` body to focus the deliberation on a single node.

#### Scenario: Trusted source triggers deliberation

- **WHEN** `POST /api/deliberation` is called from a trusted source and no deliberation is currently running
- **THEN** the response SHALL be `202 { status: 'started' }` and the deliberation SHALL begin asynchronously.

#### Scenario: Untrusted source rejected

- **WHEN** `POST /api/deliberation` is called from an untrusted source
- **THEN** the response SHALL be `403` with a plain-text explanation.

#### Scenario: Anchored deliberation accepted

- **WHEN** `POST /api/deliberation` is called from a trusted source with body `{ anchorNodeId: '<existing non-archived id>' }`
- **THEN** the response SHALL be `202 { status: 'started' }` and `runDeliberation` SHALL be invoked with that anchor id.

#### Scenario: Anchored deliberation against unknown id

- **WHEN** `POST /api/deliberation` is called with `anchorNodeId` set to an id that does not exist in the current graph
- **THEN** the response SHALL be `400 { error: 'unknown anchor node' }` and no deliberation SHALL start.

#### Scenario: Anchored deliberation against archived node

- **WHEN** `POST /api/deliberation` is called with `anchorNodeId` set to a node whose `archived === true`
- **THEN** the response SHALL be `400 { error: 'anchor is archived' }` and no deliberation SHALL start.

### Requirement: Deliberation Records Persisted And Retrievable

Kevin Autopilot SHALL write each completed deliberation to `data/deliberations/<id>.json` and expose the latest record at `GET /api/deliberation/latest`. A maximum of 10 records SHALL be kept; older ones are pruned on each new write. Each record SHALL include the `anchorNodeId` used (or `null` for whole-graph deliberations).

#### Scenario: Record persisted after completion

- **WHEN** a deliberation finishes (synthesis done)
- **THEN** Kevin Autopilot SHALL write a `DeliberationRecord` to `data/deliberations/<YYYY-MM-DD-HHmmss>.json` containing `id`, `startedAt`, `finishedAt`, `environment`, `personas`, `rounds`, `synthesis`, `model`, `tokenUsage`, and `anchorNodeId`.

#### Scenario: Latest record returned

- **WHEN** `GET /api/deliberation/latest` is called and at least one record exists
- **THEN** the response SHALL be `{ status: 'idle' | 'running', record: DeliberationRecord }` where `record` is the most recently finished deliberation including its `anchorNodeId` field.

#### Scenario: No record exists

- **WHEN** `GET /api/deliberation/latest` is called and no deliberation has ever completed
- **THEN** the response SHALL be `{ status: 'idle', record: null }`.

#### Scenario: Deliberation in progress

- **WHEN** `GET /api/deliberation/latest` is called while a deliberation is running
- **THEN** the response SHALL be `{ status: 'running', record: <last completed or null> }`.
