## ADDED Requirements

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
