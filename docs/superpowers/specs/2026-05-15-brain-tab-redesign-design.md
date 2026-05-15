# Brain Tab Redesign — Selected Node Card + Per-Node Actions + Archive Vault

Date: 2026-05-15
Status: Draft (awaiting user review)
Target version: v0.16.0

## Problem

Mobile users on the `/分身` tab cannot use the selected-node card effectively:

1. **Discussion content gets truncated.** Only the first few characters of the node's `thinking.*` fields are visible. Root cause: `src/web.ts:936` caps `.node-drawer` at `max-height: 24dvh` (≈ 200 px) with `overflow-y: auto`, creating a tiny inner scroll container nested inside an already-scrollable `.cockpit-panel` (`max-height: 72vh` on mobile).
2. **Big empty space below the card.** `.cockpit-panel`'s 72vh cap plus the inner 24dvh cap leaves the lower viewport unused.
3. **No way to express "stop thinking about this" or "think harder about this".** The `actions` enum on `IdeaGraphNode` has `stop-exploring` and `mark-interesting` but no UI button. There is no "boost / think more" primitive at all.
4. **Information priority is wrong.** Keywords — the cheapest at-a-glance summary of what a node is about — are buried below `summary`, `type · confidence · source`, and the entire thinking block.

## Goals

- On mobile, keywords are the first thing the eye lands on after the node title.
- The full discussion (`thinking.understanding`, `whyItMatters`, `nextExploration`, `questions`, `evidence`, `missingEvidence`) is visible without truncation.
- Below the card there is no wasted vertical space — the card fills the viewport below the graph and scrolls internally.
- Three per-node user actions: **多想一點** (single-node Gemini enrichment), **深度辯論** (focused multi-persona deliberation anchored on the node, which internally re-uses the enrichment as step 0), **先不要想** (archive — hidden from the default graph, frozen until manually unarchived).
- A 冷凍庫 view that lists archived nodes with **解凍** and **永久刪除** actions.
- Observation loop and deliberation engine both skip `archived === true` nodes when sampling candidates.

## Non-goals

- No redesign of the Cytoscape graph itself.
- No change to the desktop two-pane layout's overall structure (right-aside cockpit-panel stays).
- No new field on `IdeaGraphNode` for snooze / dormancy. Archive is binary on/off (`archived: boolean`, `archivedAt: string | null`).
- No multi-user / per-user archive state. Archive is workspace-wide.

## User-facing changes

### Selected-node card layout (new order)

```
┌────────────────────────────────────────┐
│ [⚡ 多想一點] [🧠 深度辯論] [❄ 先不要想]│ ← sticky action bar
├────────────────────────────────────────┤
│ <Node title>                            │ ← h2
│ #keyword1  #keyword2  #keyword3         │ ← keyword strip (accent color, prominent)
├────────────────────────────────────────┤
│ 💭 分身怎麼想這個                       │
│    understanding (full text)            │
│    為什麼有關：whyItMatters (full text) │
│    下一步：nextExploration (full text)  │
├────────────────────────────────────────┤
│ ❓ 分身正在問                            │
│    • question 1 (full)                  │
│    • question 2 (full)                  │
│    • question 3 (full)                  │
├────────────────────────────────────────┤
│ 🔗 相連節點                              │
│    [pill] [pill] [pill] (wrap)          │
├────────────────────────────────────────┤
│ 📎 證據                                  │
│    • evidence 1 (full)                  │
│ 🕳 缺的證據                              │
│    • missing 1 (full)                   │
├────────────────────────────────────────┤
│ 🔬 詳情 ▾ (collapsed by default)        │
│    type · confidence · source            │
│    建立於 / 上次想 / 觀察過 N 次          │
│    [延伸] [找關聯] [複製 prompt] [標記★]│
│    OpenCode prompt (existing details)   │
└────────────────────────────────────────┘
```

The primary sticky action bar carries only the three new actions. The four existing actions (`extend`, `find-relationships`, `copy-opencode-prompt`, `mark-interesting`) move into the collapsed `🔬 詳情 ▾` block — they remain reachable but de-prioritized so they do not crowd the at-a-glance area. `stop-exploring` is removed.

### Three new actions

| Button | Endpoint | Behavior |
|---|---|---|
| ⚡ 多想一點 | `POST /api/idea/:id/boost` | Single Gemini call; takes the node + neighbors + radar/backlog snapshot as context; produces fresh `thinking.*` and 0–3 new edges; bumps `updatedAt`, `seenCount++`, `lastSeenAt`. Returns 202 / 409 / 403. UI disables the button and polls `GET /api/idea/:id/boost-status` every 3 s; on completion, reload the page. |
| 🧠 深度辯論 | `POST /api/deliberation` body `{ anchorNodeId }` | Existing deliberation engine, but with an explicit step 0 `enrichAnchorNode()` that re-uses the same code path as `boost`. After enrichment, `pickRoles` / personas / synthesis all receive the anchor node's identity + post-enrichment thinking and are prompted to debate around it. The persisted `DeliberationRecord` gains `anchorNodeId`. |
| ❄ 先不要想 | `POST /api/idea/:id/archive` | Sets `archived = true`, `archivedAt = now`. Card switches to show a single **🔥 解凍** button instead of the action bar. |

All three endpoints are **trusted-settings gated** (same gate as existing `/api/deliberation`).

### Frozen vault

- New top-right chip on the 分身 tab: `❄ 冷凍庫 (N)`, hidden when N = 0.
- Click → switch to an inline vault view (no modal — same page, same `/分身` tab, just swap the workbench section):

  ```
  ┌── ❄ 冷凍庫 ─────────── [← 回腦圖] ┐
  │ 共 N 個被冷凍的想法                  │
  ├────────────────────────────────────┤
  │ 🧊 <Node title>                     │
  │    #kw1 #kw2                        │
  │    冷凍於 <ts> · 觀察過 N 次         │
  │    [🔥 解凍] [🗑 永久刪除]          │
  ├────────────────────────────────────┤
  │ ...                                 │
  └────────────────────────────────────┘
  ```

- **🔥 解凍** → `POST /api/idea/:id/unarchive` → `archived = false`, `archivedAt = null`.
- **🗑 永久刪除** → `DELETE /api/idea/:id` → remove node + connected edges. Confirms first via `confirm()`.

## CSS / layout fixes

### Drop the inner scroll, let the outer panel fill the viewport

Replace the existing mobile media query at `src/web.ts:936`:

```css
/* before */
@media (max-width: 520px) {
  .cockpit-panel { max-height: 72vh; padding: 12px; }
  .node-drawer { max-height: 24dvh; overflow-y: auto; padding: 9px 12px; }
}

/* after */
@media (max-width: 520px) {
  .cockpit-panel {
    height: calc(100dvh - var(--cy-h, 48dvh) - 160px);
    max-height: none;
    overflow-y: auto;
    padding: 12px;
  }
  .node-drawer {
    /* no height cap, no nested scroll */
    padding: 9px 12px;
  }
}
```

The 160 px reserve covers the page header (KEVIN AUTOPILOT bar) plus the bottom tab bar (`.tab-panels { padding-bottom: 74px }` already exists at line 936) plus safe-area inset. `--cy-h` defaults to `48dvh` to match the existing `.cy-container { height: min(48dvh, 430px) }`.

### Keyword strip — never truncate

Add a dedicated keyword strip class so it does not inherit the generic `.pill` ellipsis from `src/web.ts:855`:

```css
.kw-strip {
  display: flex; flex-wrap: wrap; gap: 6px;
  margin: 6px 0 14px;
}
.kw-strip .pill {
  white-space: normal;
  overflow-wrap: anywhere;
  text-overflow: clip;
  max-width: 100%;
  font-size: 14px;
  padding: 5px 11px;
  background: rgba(34, 211, 238, 0.16);
  border: 1px solid rgba(34, 211, 238, 0.42);
  color: #cffafe;
}
@media (min-width: 768px) {
  .kw-strip .pill { font-size: 13px; }
}
```

`renderSelectedNode` wraps the keyword pills in `<div class="kw-strip">` instead of `.workbench-meta`.

### Sticky action bar

```css
.node-action-bar {
  position: sticky;
  top: 0;
  z-index: 2;
  background: rgba(11, 9, 7, 0.92);
  backdrop-filter: blur(6px);
  margin: 0 -16px 12px;
  padding: 8px 16px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
```

### Long-text safety

On `.thought-line`, `.trace-note > div`, `.radar-signals li`:

```css
.thought-line, .trace-note > div, .radar-signals li {
  overflow-wrap: anywhere;
  word-break: break-word;
  -webkit-line-clamp: unset;
  text-overflow: clip;
  white-space: normal;
}
```

## Data model

`IdeaGraphNode`:

```ts
// existing
archived?: boolean
ignored?: boolean        // unused by UI; leave in place for now
interestingAt?: string

// new — single new field
archivedAt?: string | null
```

`IdeaGraphAction.id` enum:

```ts
// before
'extend' | 'find-relationships' | 'copy-opencode-prompt' | 'mark-interesting' | 'stop-exploring'

// after
'boost' | 'deliberate' | 'archive'
  | 'extend' | 'find-relationships' | 'copy-opencode-prompt' | 'mark-interesting'
// `stop-exploring` removed — `archive` replaces it semantically
```

`DeliberationRecord` gains one optional field:

```ts
anchorNodeId?: string | null
```

## Backend changes

### `src/idea-graph.ts` (or wherever nodes are persisted)

- `archiveNode(id)`: set `archived = true`, `archivedAt = nowIso()`.
- `unarchiveNode(id)`: set `archived = false`, `archivedAt = null`.
- `deleteNode(id)`: remove node + edges where `from === id || to === id`.
- `getActiveNodes()` helper: `nodes.filter(n => !n.archived)`.
- `getArchivedNodes()`: `nodes.filter(n => n.archived)`.

### `src/observation-loop.ts`

- Candidate sampling switches to `getActiveNodes()`.

### `src/deliberation.ts`

- New `enrichAnchorNode(config, node, graph, ...)` step before `pickRoles`. When `anchorNodeId` is null, skip enrichment.
- `pickRoles` prompt receives the anchor node (post-enrichment) as context.
- `runIndependentAnalysis` / `runDebateRound` / `runSynthesis` prompts include the anchor node as "central topic to debate".
- Candidate sampling for non-anchor context nodes uses `getActiveNodes()`.

### `src/web.ts` API endpoints

- `POST /api/idea/:id/boost` — trusted-settings; 202/409/403; fire-and-forget.
- `GET /api/idea/:id/boost-status` — `{ status: 'idle' | 'running', updatedAt?: string }`.
- `POST /api/idea/:id/archive` — trusted-settings; 200.
- `POST /api/idea/:id/unarchive` — trusted-settings; 200.
- `DELETE /api/idea/:id` — trusted-settings; 200.
- `POST /api/deliberation` — body extended to accept `{ anchorNodeId?: string }`.

## Testing

- `boost.test.ts`: enrichment writes new thinking, bumps `seenCount`, returns 409 when already running.
- `archive.test.ts`: archive removes node from `getActiveNodes()`; unarchive restores; delete removes node + edges; archived nodes skipped by observation loop and deliberation.
- `deliberation.test.ts` (extend existing): `anchorNodeId` triggers `enrichAnchorNode` first; pickRoles receives anchor; synthesis seeds reference anchor when relevant.
- `web.test.ts` (extend existing): new endpoints trusted-gated; archived/deleted nodes returned correctly from graph API.
- Mobile CSS — manual: card fills viewport below graph; full discussion visible; keyword strip wraps and never ellipsizes; action bar sticky on scroll.

## Version

Bump `src/version.ts`, `package.json`, `package-lock.json`, `.github/workflows/deploy-dev.yml` `EXPECTED_APP_VERSION` to `0.16.0`. README + AGENTS get v0.16.0 entry.

## Rollout

OpenSpec change `add-brain-tab-redesign` will be created from this design. Implementation follows `openspec-apply-change` flow. After merge + deploy-dev green at `kevin.sisihome.org/health=0.16.0`, archive the change.

## Risks

- **Mobile viewport calc**: `calc(100dvh - var(--cy-h, 48dvh) - 160px)` assumes 160 px header/tab-bar margin. If the bottom tab bar height changes, the card overflows or leaves a gap. Mitigation: define `--cy-h` and `--tab-bar-h` as CSS custom properties on `:root` so layout math is centralized.
- **Boost concurrency**: a user can spam-tap 多想一點 across multiple nodes. The 409 lock is per-node; concurrent boosts on different nodes are allowed but compete for the same key pool. Acceptable.
- **Anchor deliberation cost**: every focused deliberation pays the enrichment cost up front. Acceptable per design choice B in Q5.
- **Archive doesn't tombstone references**: if observation loop persists a snapshot referencing an archived node ID, the snapshot still shows it. Acceptable — archive is a soft hide, not a delete.
