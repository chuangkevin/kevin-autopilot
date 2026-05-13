## Why

After v0.9.8 shipped, the cockpit graph reveals two related usability
problems once Kevin watches background observation accumulate over a few
cycles:

1. The graph layout is statically computed at render time. Clicking a
   `brain-node` only fills the right-side drawer with text pills; the SVG
   edges and node positions do not change, so it is hard to see which
   satellites actually belong to the clicked node. The connection
   rationale lives only in the `<title>` tooltip on the SVG `<line>`,
   which most desktop users never hover and mobile users cannot reach.
2. `EXTENSION` nodes grow without dedup. `idea-graph.ts:540`
   (`makeIdeaExtensionNodes`) produces 2 extensions per idea from a
   small set of template "lenses", so many ideas yield near-identical
   titles like "延伸：把『X』接到『Y』". `idea-graph.ts:69`
   (`extendIdeaGraphNode`) appends `Date.now()` to every on-demand
   extension id, so each click of the "延伸" action creates a fresh
   node forever. The cockpit screenshot at v0.9.8 shows 6+ visually
   indistinguishable EXTENSION cards crowding the ring.

The two problems compound: a noisy ring makes the missing
click-to-expand interaction feel even worse, because the user has no
visual way to ask "which of these 6 EXTENSION cards is connected to
*this* IDEA?".

## What Changes

- Add a hub-spoke focus interaction in the cockpit:
  - Clicking a `brain-node` re-runs layout with the clicked node at the
    center and its direct neighbours arranged as the inner ring;
    non-neighbours dim and sit on an outer ring or hide depending on
    graph size.
  - Edges from the focused node draw their `rationale` as visible inline
    labels (not only `<title>` tooltips) so the relationship reason is
    readable on desktop and tappable on mobile.
  - Clicking the focused node again, or clicking empty stage, restores
    the default `centerNodeId`-rooted layout.
  - The transition is layout-only; node identities, graph data, and the
    right-side drawer behaviour stay the same.
- Deduplicate `EXTENSION` nodes at merge time:
  - Identity becomes `extension-${safeId(parentId)}-${signature}` where
    `signature` is a normalised hash of the extension title plus its
    top keywords. The unbounded `Date.now()` suffix is removed.
  - When a candidate extension matches an existing node, update
    `seenCount`, `lastSeenAt`, and refresh `thinking.evidence` instead
    of inserting a new node.
  - Cap automatically-generated extensions per idea at 2 (matches
    today's intent) and cap on-demand `extendIdeaGraphNode` insertions
    per parent at 6, after which the action upserts the most recently
    matching extension and bumps its strength.
- Filter legacy duplicate EXTENSION nodes on load: when two stored
  nodes share the post-signature id stem, keep the oldest and migrate
  edges to it.
- Bump version to `0.10.0` and update README / AGENTS release notes.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `neural-cockpit`: clicking a brain-node re-centers the graph and
  reveals edge rationale inline; clicking the focused node or empty
  stage restores the default layout.
- `idea-graph`: EXTENSION nodes use a deterministic signature-based
  identity, dedup on merge, cap per-parent fan-out, and migrate legacy
  duplicates on load.

## Impact

- Affects `src/idea-graph.ts`, `src/web.ts`, `src/types.ts`, and their
  test files. No backend schema change; the dedup happens in the
  Autopilot-owned `data/idea-graph.json` store.
- Bumps `package.json`, `package-lock.json`, `src/version.ts`, and
  `.github/workflows/deploy-dev.yml` `EXPECTED_APP_VERSION` to
  `0.10.0`.
- Updates `README.md` and `AGENTS.md` with the v0.10.0 entry.
- No new external service, no new dependency, no Docker image change
  beyond the rebuilt JS bundle.
- Read-only safety boundary stays intact: focus interaction is pure
  client-side rerender; dedup migration only rewrites
  Autopilot-owned graph storage.
