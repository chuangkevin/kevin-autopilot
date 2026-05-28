## Context

The brainstorming source for this change is `docs/superpowers/specs/2026-05-15-brain-tab-redesign-design.md` (commit `be09139`). The mobile `/分身` tab fails three concrete jobs: it does not let the user read what the double is thinking about a node, it does not let the user direct the double's attention to or away from a node, and it does not let the user expel a stale idea from the graph. The first failure is a CSS clipping bug; the other two are missing primitives.

The deliberation engine added in v0.15.0 (`add-force-think`) already runs multi-persona debate but only across the whole graph. Personas have no anchor — they can wander, and their candidate pool already includes ideas the user wishes were dead.

`IdeaGraphNode` already carries `archived?: boolean` and `ignored?: boolean` (unused). The existing actions enum already includes `stop-exploring`, but no UI emits it and the runtime handler at `src/web.ts:2133` only returns a "中心節點不可隱藏" message. Persistence and serialization for the existing optional flags are already in place.

## Goals / Non-Goals

**Goals:**

- The selected-node card on mobile shows keywords prominently, full discussion text without truncation, and three action buttons that stay reachable while the user scrolls.
- Users can drive single-node enrichment and focused multi-persona debate from the card; debate always starts from enriched context.
- Archived nodes are invisible to default rendering, to the observation loop, and to deliberation candidate sampling, but recoverable from a frozen-vault view.
- A node can be permanently deleted with its edges in one trusted-gated call.
- Deploy-dev brings `kevin.sisihome.org/health` to `0.16.0` before archive.

**Non-Goals:**

- No new layout for the Cytoscape graph itself (sizes, physics, click semantics unchanged).
- No change to the desktop two-pane structure (right-aside cockpit panel stays; only its content reorders).
- No snooze / dormancy state. Archive is binary and manual-only.
- No multi-user archive scoping. Archive is workspace-global.
- No background re-evaluation of archived nodes. They stay archived until the user un-archives them.

## Decisions

### 1. `boost` is a standalone capability, not a method on the deliberation engine

The same enrichment work powers two user-facing actions: the standalone "多想一點" button and the implicit step 0 of "深度辯論". Folding it into `deliberation.ts` would make the standalone path require importing half the deliberation module, and would couple the simple case to the complex one. Pulling it into a new `src/boost.ts` keeps the API surface (`enrichNode(node, graph, snapshot) -> { thinking, edgeCandidates }`) tight and lets the deliberation engine import the same function as its step 0.

**Alternative considered:** put `enrichAnchorNode` as a private method of `runDeliberation`. Rejected — that duplicates logic for the standalone boost endpoint.

### 2. Per-node concurrency lock, not a global lock

Boosting two different nodes at once should be allowed; boosting the same node twice in parallel will race on persistence. The lock is a `Map<nodeId, Promise<void>>` held in the boost module. New `POST /api/idea/:id/boost` requests against a locked node return `409`.

**Alternative considered:** global "one Gemini job at a time" lock. Rejected — that throttles unrelated work and conflicts with the existing parallel-personas pattern in deliberation.

### 3. Archive is a flag on `IdeaGraphNode`, not a separate collection

Soft delete via `archived: true` + `archivedAt` keeps the snapshot format forward-compatible and preserves edges for the case where the user un-archives. Hard delete (`DELETE /api/idea/:id`) is a separate, explicit user action; it also removes connected edges.

**Alternative considered:** move archived nodes into a separate `archivedNodes` array in the snapshot. Rejected — schema migration cost, and we lose the ability to render archived nodes in the frozen vault with their edges intact for context.

### 4. Frozen vault is an inline page switch, not a modal or separate route

The mobile-first goal is "see the vault, do stuff, come back". A modal overlay obscures the graph context; a separate route loses the tab state. Swapping the workbench section between "graph + selected node" and "vault list" preserves the tab and keeps the back-affordance a single button.

### 5. Mobile layout fix uses `calc(100dvh - var(--cy-h, 48dvh) - 160px)`, not flexbox

The brain section is already a fixed-structure markup with the graph, the right-aside, and the capture strip. Restructuring it into a flex column with `flex: 1 1 0` on the panel would touch desktop layout and risk regressing the right-aside experience. A scoped `height: calc()` on `.cockpit-panel` inside the `(max-width: 520px)` query is minimal, easy to verify, and keeps desktop CSS untouched.

The 160 px reserve covers the page header, the bottom tab bar (`.tab-panels { padding-bottom: 74px }` exists at line 936), and iOS safe-area inset. The fallback `var(--cy-h, 48dvh)` matches the existing `.cy-container { height: min(48dvh, 430px) }`. If those values change, the variable centralises the math.

**Risk:** if the bottom tab bar height changes, the card overflows the viewport or leaves a gap. Mitigation: define `--cy-h` and `--tab-bar-h` as CSS custom properties on `:root` so layout math is centralised. Out of scope to do now, noted in Risks.

### 6. Keep `ignored?: boolean` in place

It is unused but referenced in serialization paths. Removing it would force a snapshot migration for zero gain. Leave it; do not surface it; do not reference it.

### 7. `stop-exploring` action ID is removed, not aliased

Aliasing keeps dead code alive forever. The current code path at `src/web.ts:2133` returns a "中心節點不可隱藏" message and is the only consumer; rip it. Anyone migrating saved actions from before this change reads from the existing serialized `IdeaGraphAction[]`; deserialization drops unknown IDs (already the case for `interesting?` style fields in `renderNodeAction`).

### 8. Deliberation anchor wiring: extend `runDeliberation` signature, not overload

```ts
async function runDeliberation(
  config: AutopilotConfig,
  report: ObservationReport,
  graph: IdeaGraph,
  backlog: BacklogItem[],
  options?: { anchorNodeId?: string | null }
): Promise<DeliberationRecord>
```

Step 0 inside `runDeliberation` is:

```ts
if (options?.anchorNodeId) {
  const anchor = graph.nodes.find(n => n.id === options.anchorNodeId)
  if (anchor) await enrichNode(anchor, graph, snapshot, config) // shared with boost
}
```

`pickRoles`, `runIndependentAnalysis`, `runDebateRound`, and `runSynthesis` each receive the optional `anchorNode` via their prompt context. Their prompts gain a "central topic to debate" preamble when the anchor is set; otherwise the existing whole-graph behaviour is unchanged.

### 9. UI polling, not server-sent events

Boost status uses `GET /api/idea/:id/boost-status` at 3 s intervals, matching the existing deliberation polling pattern. Adding SSE for a 5–15 s job is over-engineering for the rendering cost. On completion, the page reloads — same UX pattern as deliberation.

## Risks / Trade-offs

- **Mobile viewport calc** → Mitigation: variable-driven values (`--cy-h`, future `--tab-bar-h`), tested at 360 px and 414 px widths. If the calc is wrong, the user sees either an overflow scroll on the outer page or a gap below the card — both visible immediately during manual QA.
- **Boost ↔ deliberation contention on the same node** → Mitigation: the per-node lock from decision 2 applies to both paths. A focused deliberation that enrichs node X will block a parallel `POST /api/idea/X/boost`, and vice versa.
- **Archive doesn't tombstone references in old snapshots** → Mitigation: archive is a soft hide. Old observation reports that name a now-archived node still serialize the name. Acceptable — those reports are immutable history.
- **`DELETE /api/idea/:id` is destructive** → Mitigation: trusted-settings gated; UI requires `confirm()` before sending. No undo. Acceptable — the frozen vault is the safer path; permanent delete is the explicit "I really mean it" exit.
- **Deliberation cost grows** → Anchored deliberation pays one extra Gemini call (the enrichment) on every invocation. Acceptable per the brainstorming Q5-B decision.
- **`add-force-think` archival ordering** → This change references `deliberation-engine` requirements that have not yet been promoted into `openspec/specs/deliberation-engine/spec.md`. Mitigation: archive `add-force-think` first (it is already implementation-complete; only its tasks.md checkboxes 4.1/4.2/8.1/8.2 and the Android UI verification remain). If that is not feasible before this change lands, the delta file `specs/deliberation-engine/spec.md` in this change can still be authored against the spec content drafted in `add-force-think/specs/deliberation-engine/`, and OpenSpec archive will reconcile on the second pass.

## Migration Plan

1. Implement boost module, archive operations, and the deliberation anchor wiring behind no flag (the new endpoints simply do not exist on the deployed image until the v0.16.0 build lands).
2. Bump version to 0.16.0; update README + AGENTS.
3. Commit + push to `main`. CI builds and publishes `ghcr.io/chuangkevin/kevin-autopilot:latest`.
4. GitHub Actions `docker-publish.yml` triggers deploy-dev on the kevinhome self-hosted runner; `EXPECTED_APP_VERSION` guard requires `0.16.0` to come up.
5. Manual QA on Android browser: open `https://kevin.sisihome.org/分身`, confirm card layout, sticky action bar, full discussion visible, keyword strip prominent, boost / deliberate / archive buttons work, frozen vault populated, unarchive + delete work.
6. Archive change via `openspec archive add-brain-tab-redesign` once health endpoint and Android QA pass.

**Rollback:** redeploy the previous image tag from GHCR; the persisted snapshots remain forward-compatible (new fields read as `null`). No DB migration to reverse.

## Open Questions

- Should the boost button also be reachable from the Cytoscape graph node tooltip, or only from the selected-node card? **Decision deferred to implementation:** card-only first; tooltip only if user requests it after using the card path for a week.
- Should there be a daily auto-archive sweep for nodes with `seenCount === 0` older than N days? **Out of scope.** Auto-archive belongs in a future change once we see how manual archive is used.
