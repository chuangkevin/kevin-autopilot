## Context

The Neural Cockpit (v0.9.x) renders the idea graph as a single static
ring layout in `web.ts:1044 renderNeuralCockpit` and re-renders the same
layout client-side in `renderGraphStage` / `createBrowserGraphLayout`.
Clicking a `brain-node` fetches `/api/graph/nodes/:id` and only swaps
right-side drawer HTML; the SVG `<line>` edges and the ring positions
stay unchanged. Edge rationale is exposed only as a `<title>` attribute
on each `<line>`, which is invisible on touch.

EXTENSION nodes have two creation paths:

- `idea-graph.ts:540 makeIdeaExtensionNodes` runs per idea on every
  graph build, deterministically producing 2 extensions from a small
  pool of "lens" templates. Their ids are
  `extension-${safeId(idea.id)}-${index+1}`, which deduplicates within
  one idea but not across cycles where titles may shift slightly.
- `idea-graph.ts:69 extendIdeaGraphNode` runs when the user clicks the
  in-drawer "延伸" action. Its id is
  `extension-${safeId(selected.id)}-${Date.now()}`, so the same parent
  produces a new node every click forever.

Combined, the cockpit screenshot at v0.9.8 shows a noisy ring of nearly
identical extensions, and the user cannot visually trace which IDEA each
one came from.

## Goals / Non-Goals

**Goals:**

- Make clicking a `brain-node` re-center the layout on that node and
  visually surface its direct neighbours, with edge rationale visible
  inline.
- Restore the default layout when the focused node is re-clicked or the
  user clicks empty stage.
- Stop EXTENSION nodes from accumulating duplicates: deterministic
  identity, upsert-on-merge, capped fan-out per parent.
- Migrate legacy duplicate EXTENSION nodes on load without external
  scripts.

**Non-Goals:**

- No physics-based force layout. The cockpit stays on a deterministic
  hand-computed layout to keep render cheap, SSR-friendly, and testable.
- No change to graph storage schema, no new persistence layer, no new
  API surface beyond the optional `?focus=<nodeId>` query in `/api/graph`
  (used only as a hint; client decides layout).
- No change to other node types' identity rules. Only EXTENSION is
  affected by the dedup work.
- No autonomous mutation: focus is pure rerender, dedup only rewrites
  Autopilot-owned `data/idea-graph.json`.

## Decisions

### Decision 1: Layout focus is client-only, no server round-trip

The clicked node id is held in a JS variable `focusedNodeId` (defaults
to `graph.centerNodeId`). `createBrowserGraphLayout` and `renderGraphStage`
already exist; we extend them to accept a `focusedNodeId`, compute the
neighbour set from `graph.edges`, and place:

- focused node at `(50, 50)`
- direct neighbours on an inner ring at radius `(32, 31)` like today
- everything else on an outer ring at radius `(46, 44)` with reduced
  opacity (CSS class `brain-node--faded`)
- if total `non-neighbour` count exceeds 14, only render the first 14
  in stable id order; the rest are dropped from DOM but the data stays
  in `#graph-data` for restoration

Re-clicking the focused node, clicking empty stage, or pressing `Esc`
sets `focusedNodeId` back to `centerNodeId` and re-renders.

**Alternative considered**: server returns a pre-focused subgraph.
Rejected — adds API surface, splits truth between client and server,
and breaks the existing `/api/graph` shape that `web.test.ts` already
covers.

### Decision 2: Edge rationale rendered as inline SVG text when focused

For edges incident to `focusedNodeId`, additionally emit
`<text class="neural-edge-label">…</text>` positioned at the midpoint
of the line, truncated to 18 chars + ellipsis. The `<title>` tooltip
stays for hover-detail. Non-focused edges keep the existing thin
`<line>` only.

**Alternative considered**: HTML overlay labels positioned by `top/left`.
Rejected — SVG keeps labels in the same coordinate system as the
edges, so they scale with `viewBox`; no second pass needed for resize
or animation.

### Decision 3: EXTENSION identity becomes `extension-${safeId(parentId)}-${signature}`

`signature` = `safeId(stableHash6(normalisedTitle + topKeywordsJoin))`,
where:

- `normalisedTitle` = lowercase, NFKC, collapse whitespace, strip the
  leading `延伸：` prefix, trim trailing punctuation.
- `topKeywordsJoin` = `node.keywords.slice(0, 3).sort().join('|')`.
- `stableHash6` = first 6 hex chars of an in-process FNV-1a hash.

`makeIdeaExtensionNodes` already loops with `index` so we keep
deterministic suffixes; the signature only replaces `Date.now()` and
the bare `index`. Merge behaviour:

- On insert (`mergeNodes` style path in `idea-graph.ts`), if a node
  with the same id exists: bump `seenCount`, set `lastSeenAt = now`,
  refresh `thinking.evidence`, keep oldest `createdAt`. Do not insert
  a duplicate.
- Cap `extendIdeaGraphNode` per parent at 6 active EXTENSION children.
  When the cap is hit, upsert into the closest existing match by
  signature similarity (Jaccard on keywords ≥ 0.5); otherwise bump
  the most recent EXTENSION child's `seenCount`.

**Alternative considered**: full content-hash dedup across all node
types. Rejected — IDEA nodes intentionally retain raw user wording,
RESEARCH seeds are content-addressed by reason already; only
EXTENSION has the unbounded-id-suffix bug.

### Decision 4: Legacy duplicate migration runs on graph load

When `loadIdeaGraph` reads `data/idea-graph.json`:

- Compute the new-style id for every node whose `type === 'extension'`
  and whose stored id matches the old `extension-${safeId(idea)}-${number}`
  or `extension-${safeId(node)}-${timestamp}` pattern.
- If the new-style id is already present, keep the oldest (`createdAt`
  ascending) and rewrite the loser's edges so every `edge.from` /
  `edge.to` pointing at the loser points at the winner instead.
- Drop the loser node from the in-memory graph.
- The migration is read-only with respect to disk on first load; on
  the next successful `saveIdeaGraph`, the deduplicated form is
  persisted (no explicit migration step needed).

**Alternative considered**: separate one-shot migration CLI. Rejected
— the v0.6.1 release already established the precedent that legacy
filtering runs on load (`電子羊` filter) and the user runs a single
container with a shared volume; an extra CLI step would just be a
manual operation hazard.

## Risks / Trade-offs

- [Risk] Focus rerender flickers because we rebuild `stage.innerHTML`
  on every click → Mitigation: the existing `refreshGraphInPlace` path
  already does the same on graph refresh and tested fine; we add a CSS
  transition on `opacity` for the fade ring so the visual feels intentional.
- [Risk] Hiding non-neighbour nodes when graph is large makes the user
  feel data was lost → Mitigation: show a `+N hidden` chip below the
  stage; clicking it expands to full graph at the focused-node radius.
- [Risk] Signature dedup collapses two semantically distinct ideas that
  happen to share keywords → Mitigation: keep `topKeywords` at length
  3 sorted, which preserves enough signal in practice; if a real
  collision shows up, the dedup is metadata-only — we can adjust the
  hash recipe in a follow-up without data migration.
- [Risk] Legacy migration silently rewrites edges incorrectly →
  Mitigation: add a `idea-graph.test.ts` case that loads a fixture
  with known duplicates and asserts every edge endpoint is valid
  post-migration. Migration only runs in-memory; the original
  `idea-graph.json` is only overwritten by the normal `saveIdeaGraph`
  path.
- [Trade-off] Outer ring of faded nodes plus inline edge labels add
  visual density. We accept this because the alternative — collapsing
  invisible relationships into a sidebar list — is what made the
  current UI feel disconnected in the first place.

## Migration Plan

1. Land the dedup code first behind the same release; legacy
   migration runs on the first container restart after deploy.
2. No data migration script. The in-memory dedup + the existing
   `saveIdeaGraph` write path completes the transition opportunistically.
3. Rollback: revert the commit; `data/idea-graph.json` stays compatible
   because new-style ids are still valid `extension-…` ids; only the
   client click behaviour and the dedup logic change.

## Open Questions

- Do we want a keyboard shortcut for "restore default layout" beyond
  `Esc`? Defer to user feedback; ship `Esc` + click-empty + re-click
  for v0.10.0.
- Should focused-node edge labels also show on mobile? Yes — the inline
  SVG `<text>` is naturally touch-friendly; we just keep font-size
  large enough (≥ 11 viewBox units) so they remain readable.
