## ADDED Requirements

### Requirement: Node Archive State And Active-Nodes View

Kevin Autopilot SHALL support a per-node `archived: boolean` flag with an `archivedAt: string | null` timestamp on every `IdeaGraphNode`. The persistence layer SHALL provide a `getActiveNodes(graph)` helper that returns only nodes whose `archived` field is not `true`.

#### Scenario: Archive sets flag and timestamp

- **WHEN** `archiveNode(id)` is called on an existing node
- **THEN** the node's `archived` SHALL be `true`, `archivedAt` SHALL be the current ISO timestamp, and the change SHALL be persisted in `data/idea-graph.json` on the next save.

#### Scenario: Unarchive clears flag and timestamp

- **WHEN** `unarchiveNode(id)` is called on an archived node
- **THEN** the node's `archived` SHALL be `false`, `archivedAt` SHALL be `null`, and the change SHALL be persisted.

#### Scenario: getActiveNodes filters archived

- **WHEN** any consumer calls `getActiveNodes(graph)`
- **THEN** the returned array SHALL contain every node from `graph.nodes` where `node.archived !== true`, preserving the original order.

#### Scenario: Forward-compatible snapshot

- **WHEN** Kevin Autopilot loads a `data/idea-graph.json` written by a pre-v0.16.0 image
- **THEN** every loaded node without an explicit `archived` field SHALL be treated as `archived: false` with `archivedAt: null`, and no migration script SHALL be required.

### Requirement: Hard Delete Removes Node And Incident Edges

Kevin Autopilot SHALL provide a `deleteNode(id)` operation that removes the node from `graph.nodes` and removes every edge in `graph.edges` whose `from === id` or `to === id`. The operation SHALL persist the modified graph immediately on success.

#### Scenario: Delete removes node and edges

- **WHEN** `deleteNode(id)` is called on an existing node
- **THEN** the node SHALL no longer appear in `graph.nodes`, no edge in `graph.edges` SHALL reference that id, and the change SHALL be persisted.

#### Scenario: Delete is idempotent

- **WHEN** `deleteNode(id)` is called on an id that is not present in `graph.nodes`
- **THEN** the operation SHALL be a no-op, no error SHALL be raised, and no save SHALL be triggered.

#### Scenario: Delete center node refused

- **WHEN** `deleteNode(id)` is called on the graph's `centerNodeId`
- **THEN** the operation SHALL throw and the graph SHALL be unchanged, because deleting the center would orphan the rendering.

### Requirement: Trusted-Gated Node State Endpoints

Kevin Autopilot SHALL expose `POST /api/idea/:id/archive`, `POST /api/idea/:id/unarchive`, and `DELETE /api/idea/:id` endpoints, all gated by the same `isTrustedSettingsRequest` guard used by other settings-write endpoints.

#### Scenario: Trusted archive request

- **WHEN** `POST /api/idea/:id/archive` is called from a trusted source on an existing non-center node
- **THEN** the response SHALL be `200 { id, archived: true, archivedAt }` and the persistence SHALL reflect the archive state.

#### Scenario: Untrusted node state request rejected

- **WHEN** any of `POST /api/idea/:id/archive`, `POST /api/idea/:id/unarchive`, or `DELETE /api/idea/:id` is called from an untrusted source
- **THEN** the response SHALL be `403` with a plain-text explanation and the graph SHALL NOT be modified.

#### Scenario: Unknown id returns 404

- **WHEN** any of the three endpoints is called with an id that does not exist in the graph
- **THEN** the response SHALL be `404` and no save SHALL be triggered.

#### Scenario: Archive center node refused

- **WHEN** `POST /api/idea/:id/archive` is called on the graph's `centerNodeId`
- **THEN** the response SHALL be `400 { error: 'cannot archive center node' }` and the graph SHALL be unchanged.

## RENAMED Requirements

- FROM: `### Requirement: IdeaGraphAction Includes Stop-Exploring`
- TO: `### Requirement: IdeaGraphAction Includes Archive`

(The current main spec does not yet codify this action enum at the requirement level; the rename above is a defensive declaration so that any future spec-archival pass treats `stop-exploring` and `archive` as the same identity in the action enum. The enum change itself is described in `proposal.md` and `design.md`.)
