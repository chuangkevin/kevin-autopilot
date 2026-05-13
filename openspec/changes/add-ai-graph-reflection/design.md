## Context

`observation-loop.ts:65 executeRun` runs every 5 minutes. After
`observe` + report write + backlog merge it calls
`getIdeaGraph(config, report, ideas)` which projects everything into the
stored graph and persists it. The result is a deterministic graph with
templated EXTENSION / RESEARCH nodes.

`ai.ts:17 analyzeIdeaWithAiCore` already wires Gemini through ai-core's
`KeyPool` + `FileKeyStorageAdapter`. The existing call is bounded
(maxOutputTokens 900, timeout 20s) and parses a strict JSON output
schema. Reflection should follow the same shape: single bounded call,
JSON-only output, fail-soft fallback.

`IdeaRecord` JSON files live under `data/ideas/idea-*.json`. They are
read by `listIdeas` (latest 20–40) and projected into the graph as
IDEA nodes. AI-generated ideas can reuse this pipeline if we just add
an `aiSource` field and a dismiss path.

## Goals / Non-Goals

**Goals:**

- The double actually reasons over the visible graph + backlog + recent
  ideas at a 5-minute cadence, with token + timeout caps and a hard cap
  on unread AI-generated ideas.
- Reflection is opt-out-able by config and Autopilot stays usable (with
  deterministic projection only) when AI is disabled or offline.
- AI-generated ideas are clearly labelled, individually auditable
  (evidence chain), and one-click dismissable.
- Focused nodes get an AI-written `nextExploration` instead of the
  deterministic template, only when the AI specifically returned one.
- Reflection state is queryable for UI + tests.

**Non-Goals:**

- No autonomous mutation of target repos. AI cannot trigger commits,
  pushes, deploys, or `extendIdeaGraphNode`. It only proposes ideas and
  rewrites text fields.
- No deletion of existing IDEA / EXTENSION / RESEARCH nodes via AI. AI
  cannot archive or ignore nodes in this change — pruning is deferred.
- No reflection-of-reflection: an idea minted by reflection MUST NOT
  feed back into the same reflection's prompt within the same cycle.
- No continuous chain-of-thought storage. Each reflection is a single
  bounded round-trip; we keep the resulting record and discard the
  prompt body.

## Decisions

### Decision 1: Reflection lives in a new `src/reflection.ts` module

Keep `ai.ts` focused on the idea-creation path. Reflection is a new
concern (graph-aware, multi-input, multi-output), and isolating it
makes the token cap, dedup logic, and prompt shape easy to test.

Public surface:

```ts
export interface ReflectionInput {
  graph: IdeaGraph
  backlog: BacklogItem[]
  recentIdeas: IdeaRecord[]
  focusedNodeId?: string
  previousSignature?: string
  pendingAiIdeaCount: number
  config: AutopilotConfig
}

export interface ReflectionRecord {
  generatedAt: string
  model: string
  graphSignature: string
  skipped: false
  newIdeaSeeds: ReflectionIdeaSeed[]
  nextExplorationRewrites: ReflectionNextExploration[]
  tokenUsage?: { input: number; output: number }
}

export interface SkippedReflectionRecord {
  generatedAt: string
  skipped: true
  reason: 'unchanged' | 'pending-cap' | 'disabled' | 'offline' | 'error'
  detail?: string
  graphSignature: string
}

export function reflect(input: ReflectionInput):
  Promise<ReflectionRecord | SkippedReflectionRecord>
```

The skipped record distinguishes "nothing to do" from "we tried and
something failed" so the cockpit can show distinct copy.

### Decision 2: Graph signature is a sorted hash of node ids + backlog seenCounts

```
signature = stableHash6(
  sortedNodeIds.join('|') +
  '::' +
  backlogItems.map(b => `${b.id}:${b.seenCount}:${b.lastSeenAt}`).sort().join('|')
)
```

If `previousSignature === currentSignature` AND last reflection succeeded,
skip with `reason: 'unchanged'`. This is the cheap path that keeps the
worst-case 288 calls/day from being the realistic case.

**Alternative considered**: content-hash everything (titles, summaries).
Rejected — too volatile, would invalidate too often. Node-set churn +
backlog churn is the right granularity for "did the double's view of
the world change?".

### Decision 3: Prompt input is a strictly bounded summary, not the full graph

The full graph could be 21+ nodes × full thinking blobs ≈ many KB. We
cap input by summarising:

- `nodes`: id, type, title, source, top-3 keywords, confidence,
  truncated `summary` to 120 chars. Hard cap 18 nodes (top by visible
  graph priority).
- `backlog`: top 6 active items (`title`, `kind`, `summary` 120c,
  `seenCount`).
- `recentIdeas`: top 5 by createdAt desc (`id`, `title`, `classification`,
  `aiSource`).
- `focusedNodeId` and the node's own thinking block in full (if focused).
- `existingDismissedAiIdeas`: titles of recently dismissed AI ideas
  (last 20) so the model does not propose them again.

This keeps the prompt at roughly 3–4k tokens worst case.

### Decision 4: AI output schema is strict and JSON-only

```json
{
  "newIdeaSeeds": [
    {
      "title": "≤ 60 chars",
      "rawText": "≤ 320 chars",
      "evidence": ["≤ 4 short strings referencing node ids or backlog ids"],
      "approvalRequired": false
    }
  ],
  "nextExplorationRewrites": [
    {
      "nodeId": "must be one of supplied node ids",
      "nextExploration": "≤ 140 chars"
    }
  ]
}
```

Parser hard-rejects:

- `newIdeaSeeds.length > 2` → truncate to 2
- `nextExplorationRewrites.length > 1` → truncate to 1
- Any rewrite whose `nodeId` is not in the supplied set → drop entry
- Empty evidence on a seed → drop seed (no audit trail = no acceptance)

System instruction mirrors `analyzeIdeaWithAiCore` safety bullets and
adds: do not propose repo creation, do not propose deployment, do not
propose secret reads, do not reuse titles from `existingDismissedAiIdeas`.

**Alternative considered**: free-form prose reflection ("today the
double…"). Rejected per Kevin's scoping in v0.10.1 — pure summary text
was not chosen; actionable seeds + node-specific rewrites were.

### Decision 5: AI-generated idea records carry `aiSource: 'ai-reflection'` and an evidence array

`IdeaRecord` adds:

```ts
aiSource?: 'user' | 'ai-reflection'   // omitted = 'user'
aiReflection?: {
  generatedAt: string
  model: string
  evidence: string[]            // verbatim from AI output, parser-validated
  promptVersion: 'v1'
}
```

When the reflection mints a seed:

1. Build a `baseRecord` like `createIdea` does, with id derived from
   `makeIdeaId(now)` plus a `-r${seq}` suffix to ensure uniqueness across
   multiple seeds in one reflection.
2. Skip `analyzeIdeaWithAiCore` — we already have title/classification
   intent from the reflection output. Classification = `'explore'`
   unless rawText matches the existing BLOCKED_TERMS heuristic; then
   `'blocked'`.
3. Build `existingProjectAnalysis` via `analyzeExistingProjects` to
   keep handoff plan + project relationships consistent.
4. Mark `thinking = { mode: 'ai-core', model, success: true }` and set
   `aiSource = 'ai-reflection'` + `aiReflection` block.
5. Save under `data/ideas/`.

### Decision 6: Dismissed AI ideas are filed, not deleted

`POST /api/ideas/:id/dismiss`:

1. Read `data/ideas/${id}.json`.
2. Refuse 400 if `aiSource !== 'ai-reflection'` (user ideas are not
   dismissable through this path — user must edit / mark stale via
   future flows).
3. Move the file to `data/ideas-dismissed/${id}.json` and add a
   `dismissedAt` timestamp inside.
4. Return the dismissed record.

`listIdeas` ignores `data/ideas-dismissed/`. The reflection prompt
includes recent dismissed AI ideas (by title) so the model is steered
away from re-proposing them.

**Alternative considered**: hard-delete. Rejected — losing audit
makes it impossible to know why the cockpit "forgot" an idea.

### Decision 7: `nextExploration` rewrites are non-destructive

When reflection returns a `nextExplorationRewrites` entry for node X,
we DO NOT mutate the graph store. Instead:

- The reflection record is the source of truth. `data/reflection-state.json`
  holds `nextExplorationRewrites[]` from the latest successful reflection.
- When the cockpit fetches `/api/graph/nodes/:id`, the server merges any
  matching AI rewrite onto the node's `thinking.nextExploration` and
  flags `node.thinking.nextExplorationAi = true` for the UI tag.
- If the next reflection drops the rewrite (because the node fell out
  of focus or the AI didn't return one), the deterministic
  `nextExploration` automatically reappears. No cleanup needed.

**Alternative considered**: write rewrites back into the stored graph
nodes. Rejected — couples persistence to AI output and forces a cleanup
job; this layered approach keeps the rewrite a view-only override.

### Decision 8: Pending cap is checked before minting, not before calling

The reflection call always runs when graph signature changed and AI is
enabled. The `pendingAiIdeaCount` is passed into the prompt as
context: "you may propose at most `max(0, 5 - pending)` new seeds". The
parser then truncates to the same cap as a safety net.

This means even when pending = 5 the AI still gets called for a
potential `nextExploration` rewrite. Saves UX dead-time while staying
under the cap.

## Risks / Trade-offs

- [Risk] AI proposes the same idea repeatedly across cycles →
  Mitigation: pass last-20 dismissed AI titles into prompt; dedup
  parser will drop empty-evidence seeds; titles get
  `analyzeExistingProjects` so near-duplicate projects collapse via the
  existing similarity check at the IDEA-projection layer.
- [Risk] Token bill runs away on a churny day → Mitigation: token cap
  + graph-signature skip; if `key-pool-standard` rate-limits or 429s,
  reflection records `skipped: true, reason: 'offline'` and the loop
  continues without AI for that cycle.
- [Risk] AI invents a `nodeId` for a `nextExplorationRewrite` that is
  not on screen, confusing user → Mitigation: parser drops entries whose
  nodeId isn't in the supplied set; the cockpit only renders rewrites
  whose nodeId exists in the current graph.
- [Risk] AI ideas crowd out user ideas in `listIdeas` → Mitigation:
  pending cap; UI shows AI 生 pill; dismiss path is one click and
  persists.
- [Risk] Reflection write blocks observation cycle if AI is slow →
  Mitigation: 25s timeout; the loop's existing finally-block schedules
  the next cycle regardless of reflection outcome.
- [Trade-off] No prune action means EXTENSION template noise still
  exists. That's intentional — the user wanted Path B (give brain),
  not Path A (cut filler). We can layer prune in a follow-up.

## Migration Plan

1. Ship dark — `aiReflection.enabled` defaults to `false`. First
   release verifies wiring and tests pass without changing user
   experience.
2. On the kevinhome deploy, flip `aiReflection.enabled = true` via the
   config file and observe a few cycles before pushing widely.
3. Rollback: revert the commit OR set `aiReflection.enabled = false`
   in `kevinhome.example.json`. Stored AI-generated ideas remain
   readable; the cockpit just stops minting new ones.

## Open Questions

- Should AI-rewritten `nextExploration` persist across cycles or only
  during the lifespan of the reflection record that produced it?
  Decision: only for the lifespan of the record. If the next
  reflection skips, we keep showing the most recent successful rewrite
  for at most 1 hour, then revert to deterministic to avoid stale text.
- Do we want a "regenerate" button on an AI idea card? Defer — too
  easy to spend quota. v0.11.0 ships dismiss only.
