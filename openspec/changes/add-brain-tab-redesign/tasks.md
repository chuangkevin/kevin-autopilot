## 1. Types And Data Model

- [ ] 1.1 Add `archivedAt?: string | null` to `IdeaGraphNode` in `src/types.ts`.
- [ ] 1.2 Update `IdeaGraphAction.id` enum: add `'boost' | 'deliberate' | 'archive'`, remove `'stop-exploring'`.
- [ ] 1.3 Add `anchorNodeId?: string | null` to `DeliberationRecord` in `src/types.ts`.
- [ ] 1.4 Add `BoostState` type (`{ status: 'idle' | 'running', updatedAt: string | null }`) to `src/types.ts`.

## 2. Idea Graph Operations

- [ ] 2.1 Add `archiveNode(id)` in the idea-graph persistence module: sets `archived = true`, `archivedAt = nowIso()`, refuses center node.
- [ ] 2.2 Add `unarchiveNode(id)`: sets `archived = false`, `archivedAt = null`.
- [ ] 2.3 Add `deleteNode(id)`: removes node + every edge where `from === id || to === id`; refuses center node; idempotent for unknown id.
- [ ] 2.4 Add `getActiveNodes(graph)` helper returning `graph.nodes.filter(n => n.archived !== true)`.
- [ ] 2.5 Add unit tests in `src/idea-graph.test.ts` (or matching test file): archive/unarchive round-trip, delete removes edges, center-node refusal, `getActiveNodes` filter, forward-compatible snapshot (node without `archived` field loads as `false`).

## 3. Single-Node Boost Module

- [ ] 3.1 Create `src/boost.ts` exporting `enrichNode(node, graph, snapshot, config)`, `isBoostRunning(id)`, and an internal per-node lock map.
- [ ] 3.2 Implement Gemini prompt construction: node + direct neighbours + observation report snapshot + backlog summary; request structured JSON via `responseMimeType` + `thinkingBudget=0` (per HomeProject rules).
- [ ] 3.3 Implement JSON validation: reject malformed output, accept up to 3 edges whose `to` ids exist in the graph, discard edges to unknown ids.
- [ ] 3.4 On success: replace `thinking.*`, bump `updatedAt`, `seenCount++`, `lastSeenAt = nowIso()`, persist edges with `source: 'boost'`.
- [ ] 3.5 On failure: log node id + error, release lock, do not modify the graph.
- [ ] 3.6 Add `src/boost.test.ts`: lock prevents duplicate concurrent boost on same id; parallel boosts on different ids both run; failure releases lock; success rewrites thinking and bumps counters; unknown-edge ids are discarded.

## 4. Deliberation Engine Anchor Wiring

- [ ] 4.1 Extend `runDeliberation` signature in `src/deliberation.ts` to accept `options?: { anchorNodeId?: string | null }`.
- [ ] 4.2 Implement step 0 `enrichAnchorNode`: when `options.anchorNodeId` is set and references an existing non-archived node, call `enrichNode` from `src/boost.ts` and await completion. On enrichment failure, abort the deliberation (no record written).
- [ ] 4.3 Plumb the post-enrichment anchor node into `pickRoles`, `runIndependentAnalysis`, `runDebateRound`, and `runSynthesis` prompts as a "central topic to debate" preamble.
- [ ] 4.4 Route non-anchor context-node sampling through `getActiveNodes(graph)` so personas never see archived nodes.
- [ ] 4.5 Persist `anchorNodeId` on the resulting `DeliberationRecord` (null when no anchor).
- [ ] 4.6 Add tests in `src/deliberation.test.ts`: unknown anchor id falls back to whole-graph; archived anchor causes 400 via `POST /api/deliberation`; pickRoles + persona prompts include the anchor block; record carries `anchorNodeId`.

## 5. Observation Loop

- [ ] 5.1 Route proactive-thought candidate sampling in `src/observation-loop.ts` through `getActiveNodes(graph)`.
- [ ] 5.2 Refuse extension generation when the parent node is archived; surface the "node is archived; unarchive first" reason in the cycle log.
- [ ] 5.3 Add tests in `src/observation-loop.test.ts` (or matching test file): cycle with archived nodes never emits new edges into them; archived parent refused for extension.

## 6. API Endpoints

- [ ] 6.1 Add `POST /api/idea/:id/boost` in `src/web.ts`: trusted-settings gated; returns `202`, `409`, `403`, or `404`; fires `enrichNode` asynchronously with structured error logging.
- [ ] 6.2 Add `GET /api/idea/:id/boost-status`: returns `{ status, updatedAt }`; read-only, no trust gate.
- [ ] 6.3 Add `POST /api/idea/:id/archive`: trusted-settings gated; refuses center node with `400`; returns `200 { id, archived: true, archivedAt }`.
- [ ] 6.4 Add `POST /api/idea/:id/unarchive`: trusted-settings gated; returns `200 { id, archived: false, archivedAt: null }`.
- [ ] 6.5 Add `DELETE /api/idea/:id`: trusted-settings gated; refuses center node with `400`; returns `200 { id, deleted: true }`.
- [ ] 6.6 Extend `POST /api/deliberation` to accept `{ anchorNodeId?: string | null }`; validate against current graph and `archived` flag; return `400` on unknown or archived anchor.
- [ ] 6.7 Add `src/web.test.ts` cases: trust gate enforcement on all five new endpoints; `409` on duplicate boost; `404` on unknown id; `400` on center-node archive/delete; `400` on archived/unknown anchor; `GET /api/idea/:id/boost-status` works for any source.

## 7. UI — Selected Node Card Reorder

- [ ] 7.1 Add `.kw-strip` CSS: flex-wrap pills with `white-space: normal; overflow-wrap: anywhere; text-overflow: clip`; mobile 14 px / desktop 13 px; accent cyan border + tinted background.
- [ ] 7.2 Add `.node-action-bar { position: sticky; top: 0; ... }` CSS with translucent backdrop.
- [ ] 7.3 Add the three new action buttons to `renderNodeAction` rendering paths so `boost`, `deliberate`, and `archive` IDs map to ⚡ 多想一點, 🧠 深度辯論, ❄ 先不要想 respectively; hide ❄ when the selected node is the center.
- [ ] 7.4 Rewrite `renderSelectedNode` content order: action bar → title → keyword strip → thinking discussion (full text, no truncation) → connected nodes → evidence → missing evidence → `🔬 詳情 ▾` collapsible containing type/confidence/source, timestamps, `seenCount`, the four legacy actions, and OpenCode prompt.
- [ ] 7.5 Add long-text safety CSS on `.thought-line`, `.trace-note > div`, `.radar-signals li`: `overflow-wrap: anywhere; word-break: break-word; -webkit-line-clamp: unset; text-overflow: clip; white-space: normal`.

## 8. UI — Mobile Layout Fix

- [ ] 8.1 Replace the existing `@media (max-width: 520px)` rule for `.cockpit-panel` to use `height: calc(100dvh - var(--cy-h, 48dvh) - 160px); max-height: none; overflow-y: auto`.
- [ ] 8.2 Drop the `.node-drawer { max-height: 24dvh; overflow-y: auto }` rule from the same media query so the inner drawer grows naturally.
- [ ] 8.3 Define `--cy-h: 48dvh` on `:root` (or the brain section root) so the calc has an authoritative source.
- [ ] 8.4 Manual mobile QA at 360 px and 414 px widths: card fills viewport below graph; no double scroll; sticky action bar pinned; full discussion visible; keyword strip prominent.

## 9. UI — Frozen Vault

- [ ] 9.1 Add `❄ 冷凍庫 (N)` chip to the 分身 tab header; hidden when N = 0.
- [ ] 9.2 Implement inline view switch on the brain tab: tap chip → swap workbench section to vault list; `← 回腦圖` button restores the graph view.
- [ ] 9.3 Render each archived node row: title, `.kw-strip` keywords, archived timestamp (formatted as `formatTaipeiTime`), `seenCount`, 🔥 解凍 button, 🗑 永久刪除 button.
- [ ] 9.4 Wire 🔥 解凍 to `POST /api/idea/:id/unarchive`; on 200 remove the row and re-render the graph.
- [ ] 9.5 Wire 🗑 永久刪除 to `confirm()` then `DELETE /api/idea/:id`; on 200 remove the row.

## 10. UI — Boost And Anchored Deliberate Click Flows

- [ ] 10.1 Add `triggerBoost(id)` client-side JS: disable the button, `POST /api/idea/:id/boost`, start 3 s polling of `GET /api/idea/:id/boost-status`; on completion reload the page.
- [ ] 10.2 Extend the existing `triggerDeliberation()` client-side JS to pass `{ anchorNodeId }` from the currently selected node when ⚡ 深度辯論 is tapped on a non-center node.
- [ ] 10.3 Show muted "已經在想了…" status on `409`; do not re-enable the button until polling reports completion.

## 11. Tests And Build

- [ ] 11.1 Run `npm test` — confirm 0 failures.
- [ ] 11.2 Run `npm run build` — confirm 0 errors.

## 12. Documentation And Release

- [ ] 12.1 Bump `src/version.ts`, `package.json`, `package-lock.json`, and `.github/workflows/deploy-dev.yml` `EXPECTED_APP_VERSION` to `0.16.0`.
- [ ] 12.2 Add v0.16.0 entry to `README.md` and `AGENTS.md` describing the brain-tab redesign, the three new node actions, the frozen vault, and the anchored deliberation.

## 13. Verification And Deploy

- [ ] 13.1 Commit, push, verify `deploy-dev` brings `https://kevin.sisihome.org/health` to `0.16.0` (probe from a Tailscale-connected host).
- [ ] 13.2 Open `/分身` on Android, tap a non-center node, confirm: keyword strip visible at top of card; full discussion not truncated; sticky action bar with three buttons; ⚡ 多想一點 disables → completes → page reloads with fresh thinking; 🧠 深度辯論 with anchor completes and the persisted `DeliberationRecord.anchorNodeId` matches; ❄ 先不要想 makes the node disappear from the graph and increments the 冷凍庫 count; 🔥 解凍 restores it; 🗑 永久刪除 (after confirm) removes it.
- [ ] 13.3 Archive the change via `openspec archive add-brain-tab-redesign` once 13.1 and 13.2 pass.
