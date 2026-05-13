## 1. EXTENSION Signature Identity

- [x] 1.1 Add a `stableHash6(input: string): string` helper (FNV-1a, lowercase hex, 6 chars) in `src/idea-graph.ts` next to the existing `safeId` / `hashString` helpers, plus a `signatureForExtension(parentId, title, keywords)` helper that normalises title (NFKC, lowercase, strip leading `延伸：`, collapse whitespace, trim punctuation) and sorts the top 3 keywords before hashing.
- [x] 1.2 Replace the `extension-${safeId(idea.id)}-${index + 1}` id in `makeIdeaExtensionNodes` (`idea-graph.ts:540`) with `extension-${safeId(idea.id)}-${signatureForExtension(...)}`. Keep ordering and content otherwise unchanged.
- [x] 1.3 Replace the `extension-${safeId(selected.id)}-${Date.now()}` id in `extendIdeaGraphNode` (`idea-graph.ts:69`) with the signature-based id. The hash inputs use the proposed extension's title and keywords, not a timestamp.
- [x] 1.4 In the merge path that pushes new nodes into the stored graph, treat an existing node with the same id as an upsert: keep oldest `createdAt`, set `lastSeenAt = now`, increment `seenCount`, and refresh `thinking.evidence` from the new candidate; do not insert a duplicate.
- [x] 1.5 Add a per-parent cap of 6 active EXTENSION children inside `extendIdeaGraphNode`. When the cap is hit and no signature match exists, bump `seenCount` on the most recently inserted EXTENSION child of that parent instead of inserting a 7th node.

## 2. Legacy EXTENSION Migration On Load

- [x] 2.1 In the `loadIdeaGraph` path (or wherever the stored graph is hydrated before use), detect EXTENSION nodes whose stored id does not yet match the signature scheme and rebuild their canonical id with `signatureForExtension`.
- [x] 2.2 When two or more nodes collapse to the same canonical id, keep the oldest by `createdAt`, rewrite every `edge.from` / `edge.to` pointing at a loser to point at the winner, and drop the losers from the in-memory graph.
- [x] 2.3 Add `idea-graph.test.ts` fixtures asserting: (a) legacy `extension-…-1`, `extension-…-2`, and `extension-…-1700000000000` ids that collapse to the same signature reduce to one node; (b) all edges remain valid after migration; (c) the next `saveIdeaGraph` persists the deduplicated form.

## 3. Cockpit Hub-Spoke Focus

- [x] 3.1 In `src/web.ts`, extend `createBrowserGraphLayout(graph, focusedNodeId)` to: place the focused node at center, compute the neighbour set from `graph.edges`, lay neighbours on the inner ring, lay other nodes on an outer ring with reduced opacity (CSS `brain-node--faded`), and respect a max of 14 non-neighbour nodes in DOM with a `+N hidden` chip below the stage.
- [x] 3.2 Add a `focusedNodeId` JS state variable defaulting to `graph.centerNodeId`. Wire `renderGraphStage(graph, selectedNodeId)` to call the extended layout with `focusedNodeId`, and update `focusedNodeId` from the click handler at `web.ts:724`.
- [x] 3.3 Update the existing click handler so: clicking a non-focused brain-node sets `focusedNodeId` to that node and re-renders; clicking the focused brain-node again resets `focusedNodeId` to `graph.centerNodeId`; clicking empty stage resets too; pressing Escape on the stage resets too.
- [x] 3.4 Server-side `renderNeuralCockpit` already renders default layout — ensure SSR layout still uses `graph.centerNodeId` and matches the client's default `focusedNodeId` so first paint is stable.

## 4. Edge Rationale Visible When Focused

- [x] 4.1 In `renderGraphStage`, for every edge incident to the current `focusedNodeId`, emit an additional `<text class="neural-edge-label">` at the midpoint of the line, content = first 18 characters of `edge.rationale` plus `…` if longer. Keep the existing `<title>` tooltip in place.
- [x] 4.2 Add minimal SVG styling so edge labels are readable on dark theme (font-size in viewBox units ≥ 11, a slight stroke shadow for legibility on top of `<line>`).
- [x] 4.3 When the cockpit is in default (unfocused) state, do not emit edge labels; only emit the existing thin `<line>`.

## 5. Tests

- [x] 5.1 Add `idea-graph.test.ts` cases: signature determinism (same inputs → same id), distinct signatures for different keyword sets, upsert behaviour with `seenCount` and `lastSeenAt`, and the 6-child cap in `extendIdeaGraphNode`.
- [x] 5.2 Add `web.test.ts` cases: SSR cockpit shows the default `centerNodeId` ring; client `renderGraphStage` produces edge labels for the focused node only; the `+N hidden` indicator appears once the threshold is crossed; clicking the focused node restores default layout (use a small DOM stub or existing helpers).
- [x] 5.3 Ensure existing `web.test.ts` / `idea-graph.test.ts` cases still pass; update any test that asserts on the old `extension-…-1`-style ids to use the new signature scheme.

## 6. Documentation And Release

- [x] 6.1 Bump `src/version.ts` and `package.json` / `package-lock.json` to `0.10.0`; update `.github/workflows/deploy-dev.yml` `EXPECTED_APP_VERSION` to `0.10.0`.
- [x] 6.2 Add a v0.10.0 entry to `README.md` and `AGENTS.md` describing hub-spoke focus, edge labels, and EXTENSION dedup.
- [x] 6.3 Run `npm run build` and `npm test` and confirm 0 failures.

## 7. Verification And Deploy

- [x] 7.1 Rebuild the local Docker image (`docker build -f Dockerfile.local -t kevin-autopilot:local-test .`) and re-run the kevinhome local container; confirm `/health` returns `0.10.0`, the cockpit renders, clicking a node re-centers it, edge labels appear, and the EXTENSION ring no longer shows duplicates.
- [ ] 7.2 Commit, push, and verify the `deploy-dev` workflow brings `https://kevin.sisihome.org/health` to `0.10.0`.
