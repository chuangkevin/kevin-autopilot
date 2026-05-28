## Why

The mobile `/分身` brain tab is unusable for the reading task it was meant for: a 24dvh inner-scroll cap on `.node-drawer` clips the selected node's thinking content to its first few characters, the outer `.cockpit-panel` 72vh cap leaves a large empty band below, keywords are buried under low-value meta (`type · confidence · source`), and there is no per-node primitive for "think harder about this" or "stop thinking about this". The double can deliberate but cannot be told which idea to focus on, and dead ideas pile up in the graph forever.

## What Changes

- **BREAKING (internal):** Replace `IdeaGraphAction.id` value `stop-exploring` with `archive`. UI consumers stop emitting `stop-exploring`; the corresponding handler is dropped.
- Add three new node-scoped trusted-settings-gated actions on every non-center node:
  - **多想一點** (`boost`): single Gemini call that rewrites the node's `thinking.*`, bumps `seenCount` / `lastSeenAt`, and may add 0–3 new edges. Concurrency-locked per node.
  - **深度辯論** (`deliberate`): existing deliberation engine, now accepting `anchorNodeId`. Step 0 internally runs the boost path so personas always debate enriched context.
  - **先不要想** (`archive`): sets `archived = true`, `archivedAt = now`. Node disappears from the default graph and from both the observation loop and the deliberation candidate pools.
- Add a **❄ 冷凍庫** view: a same-tab inline switch listing archived nodes with **🔥 解凍** (unarchive) and **🗑 永久刪除** (hard delete + remove connected edges) actions. Entry chip on the 分身 tab header is hidden when the count is 0.
- Reorder the selected-node card so keywords sit right under the title in an enlarged accent-coloured `kw-strip` that wraps and never ellipsizes. The full discussion (`thinking.understanding`, `whyItMatters`, `nextExploration`, `questions`, `evidence`, `missingEvidence`) renders without truncation. Low-value meta (`type · confidence · source`, timestamps, the four existing actions `extend` / `find-relationships` / `copy-opencode-prompt` / `mark-interesting`, and the OpenCode prompt) collapse into a `🔬 詳情 ▾` block.
- Make the new primary action bar sticky at the card top.
- Replace the broken mobile media query at `src/web.ts:936`: drop `.node-drawer { max-height: 24dvh; overflow-y: auto }` and switch `.cockpit-panel` to `height: calc(100dvh - var(--cy-h, 48dvh) - 160px); max-height: none; overflow-y: auto;` so the card fills the viewport below the graph and scrolls internally.
- Add new API endpoints: `POST /api/idea/:id/boost`, `GET /api/idea/:id/boost-status`, `POST /api/idea/:id/archive`, `POST /api/idea/:id/unarchive`, `DELETE /api/idea/:id`. Existing `POST /api/deliberation` accepts an optional `anchorNodeId` in its body.
- Add `archivedAt: string | null` to `IdeaGraphNode` and `anchorNodeId: string | null` to `DeliberationRecord`.
- Add a `getActiveNodes(graph)` helper and route the observation loop's candidate sampling and `runDeliberation`'s context-node sampling through it.
- Bump to v0.16.0 (`src/version.ts`, `package.json`, `package-lock.json`, `.github/workflows/deploy-dev.yml` `EXPECTED_APP_VERSION`).

## Capabilities

### New Capabilities

- `single-node-boost`: trusted-gated single-node Gemini enrichment pipeline. Owns the boost API endpoints, the per-node concurrency lock, the prompt construction that feeds a node + its neighbours + radar/backlog snapshot, the JSON output schema for the new `thinking.*` and edge candidates, and the persistence path back into the IdeaGraph. The deliberation engine reuses this as its anchor-enrichment step 0.

### Modified Capabilities

- `neural-cockpit`: selected-node card layout, sticky action bar, accent keyword strip, frozen-vault inline view, three new action buttons, removal of the broken mobile `.node-drawer` height cap, demotion of the four existing actions and `type · confidence · source` meta into the collapsible `詳情` block.
- `idea-graph`: new `archivedAt` field; archive / unarchive / delete operations; new `getActiveNodes` view; `IdeaGraphAction.id` `stop-exploring` replaced by `archive`.
- `double-research-loop`: observation loop's candidate sampling skips `archived === true` nodes.
- `deliberation-engine`: `POST /api/deliberation` accepts `anchorNodeId`; `runDeliberation` gains an `enrichAnchorNode` step 0 that delegates to `single-node-boost`; pickRoles / persona prompts / synthesis receive the anchor node identity and post-enrichment thinking; persisted `DeliberationRecord` gains `anchorNodeId`; candidate sampling for non-anchor context nodes uses `getActiveNodes`.

## Impact

- **Modified files**: `src/types.ts` (action enum + `archivedAt` + `anchorNodeId`), `src/idea-graph.ts` (or wherever node persistence lives — archive/unarchive/delete/getActiveNodes), `src/observation-loop.ts` (candidate filter), `src/deliberation.ts` (anchor enrichment, anchor-aware prompts), `src/web.ts` (CSS rewrites, renderSelectedNode reorder, frozen vault view, action wiring, five new endpoints, deliberation body extension), `src/version.ts`, `package.json`, `package-lock.json`, `.github/workflows/deploy-dev.yml`, `README.md`, `AGENTS.md`.
- **New files**: `src/boost.ts` (single-node enrichment runner + concurrency lock), `src/boost.test.ts`, `src/archive.test.ts`.
- **Persisted data**: `archivedAt` and `anchorNodeId` written into existing JSON snapshots. Forward-compatible — older snapshots without these fields read as `null`.
- **No new npm dependency.** Reuses existing `GeminiClient` / `KeyPool` pattern from `reflection.ts` and `deliberation.ts`.
- **Deployment**: same Dockerised observer + kevinhome runner path; no new infra. Deploy-dev gate must come back green at `kevin.sisihome.org/health=0.16.0` before archiving the change.
- **Dependency on add-force-think**: this change modifies the `deliberation-engine` capability introduced by the still-active `add-force-think` change. Implementation does not block on archival, but archiving this change requires `add-force-think` to land its deliberation-engine spec first so the delta has a target.
