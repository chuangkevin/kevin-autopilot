## Context

The cockpit currently shows three observation surfaces that all derive from
the latest report:

- **Project Radar**: per-repo / per-service signals (one row per project).
- **Observation Workbench**: a non-prioritized list of candidates from the
  most recent cycle.
- **Cockpit graph**: SIGNAL and RESEARCH nodes around the central double.

All three are recomputed each cycle. The user-visible problem is that
Workbench items and graph SIGNAL nodes are presented as "what the double
sees right now" without any sense of "I have already seen this five times".

Project Radar is per-project rather than per-signal, so it does not need to
change. The durable layer applies to Workbench and the graph SIGNAL /
RESEARCH nodes.

## Data Model

### `backlog_items` (SQLite)

```sql
CREATE TABLE IF NOT EXISTS backlog_items (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  repo TEXT,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  prev_evidence_json TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  seen_count INTEGER NOT NULL,
  miss_count INTEGER NOT NULL,
  status TEXT NOT NULL,
  snoozed_until TEXT,
  strength TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS backlog_items_status_idx
  ON backlog_items(status, last_seen_at DESC);
```

### Identity

`id = sha1(JSON.stringify([repo ?? "", kind, normalizedKey]))` truncated to
the first 16 hex characters, where `normalizedKey` is a tuple of the
identity-defining fields per `kind`. Each candidate kind owns its own
`buildIdentityKey` function so the keys stay readable and stable.

Examples:

| kind | normalizedKey |
|---|---|
| `suspected_bug` | `[file_path, signal_subtype]` |
| `likely_bug` | `[failing_check_name]` |
| `improvement` | `[improvement_subtype, target]` |
| `prototype` | `[idea_id]` |
| `needs_decision` | `[decision_topic]` |
| `research_seed` | `[keyword]` |

### State Transitions

```
active ─dismiss→ dismissed (terminal)
active ─snooze(N)→ snoozed(snoozed_until=now+N)
snoozed ─time-up (read-side filter)→ active
active ─resolve→ resolved (terminal)
* ─re-observe→ active (resets miss_count to 0; preserves seen_count)
```

`snoozed → active` is read-side: the backlog query filters
`status='snoozed' AND snoozed_until > now` as snoozed and treats expired
rows as active without a background scheduler.

Re-observing a `dismissed` row deliberately does NOT revive it. Kevin's
dismiss is final; if he wants to see it again he must un-dismiss explicitly
(no UI for that in v0.7.0; he can edit `data/autopilot.db` if needed).
Re-observing a `resolved` row revives it to `active` because resolved means
"I fixed it"; if it recurs, Kevin should know.

### Strength

Derived each cycle from `seen_count` and `miss_count`:

| seen_count | miss_count | strength |
|---|---|---|
| `>= 5` | `0` | `strong` |
| `>= 2` | `0` | `medium` |
| else (with `miss_count == 0`) | `0` | `weak` |
| `miss_count >= 3` | | one level lower than computed |
| `miss_count >= 6` | | auto-transition to `dismissed` (auto-stale) |

Strength is recomputed every cycle and stored, so the cockpit can read it
without re-deriving.

## Merge Algorithm (per cycle)

`mergeCandidatesIntoBacklog(candidates: ObservationCandidate[], now: Date)`:

1. Build `idMap` from candidates: `Map<id, candidate>`.
2. Read all `active` and `snoozed` rows from `backlog_items`.
3. For each existing row:
   - If `id` is in `idMap`: UPSERT with `seen_count += 1`, `miss_count = 0`,
     `prev_evidence_json = evidence_json`, `evidence_json = candidate.evidence`,
     `last_seen_at = now`, `updated_at = now`. If row was `snoozed` but
     `snoozed_until <= now`, also flip `status = 'active'` and clear
     `snoozed_until`. If row was `resolved`, flip to `active`. Remove `id`
     from `idMap`.
   - If `id` is NOT in `idMap`: `miss_count += 1`.
4. For each remaining candidate in `idMap` (truly new):
   INSERT row with `seen_count = 1`, `miss_count = 0`, `status = 'active'`,
   `first_seen_at = last_seen_at = updated_at = now`.
5. Recompute `strength` for every touched row using the table above.
6. Apply auto-stale: rows hitting `miss_count >= 6` flip to `dismissed`.
7. Commit transaction.

The merge runs INSIDE the existing observation-loop tick, BEFORE the idea
graph refresh, so the graph sees backlog-derived nodes immediately.

## Cockpit Graph Sourcing

`idea-graph.ts` currently builds SIGNAL nodes from
`report.candidates` and RESEARCH nodes from a deterministic seed function.
After this change:

- SIGNAL nodes come from `backlog_items WHERE kind IN
  ('suspected_bug', 'likely_bug', 'improvement', 'prototype',
  'needs_decision') AND (status='active' OR (status='snoozed' AND
  snoozed_until <= now))`.
- RESEARCH nodes come from `backlog_items WHERE kind='research_seed' AND
  status='active'`.
- Each node's `confidence` field is set from the backlog row's `strength`.
- Node visual treatment (border, glow, font weight) reads `confidence` in
  CSS just as it already does for the existing `confidence` axis.

Nodes that no longer exist in the backlog (dismissed / resolved /
genuinely-gone) are removed from the graph; the cockpit polling already
auto-reloads when `lastGraphAt` changes, so Kevin sees them disappear.

## API Surface

```
GET  /api/backlog?status=active|snoozed|resolved|dismissed|all
       → { items: BacklogItem[], counts: { active, snoozed, resolved, dismissed } }
POST /api/backlog/:id/dismiss        → BacklogItem
POST /api/backlog/:id/snooze         body: { days: 1 | 7 | 30 }
                                     → BacklogItem
POST /api/backlog/:id/resolve        → BacklogItem
```

All four are read-only-safe (write only to `data/autopilot.db`). Same
no-store cache headers as existing dashboard APIs.

## UI

Cockpit folded section currently labeled `Observation Workbench` becomes
`Durable Backlog`. Header row of filter chips (`active(N)` /
`snoozed(N)` / `resolved(N)` / `dismissed(N)` / `all(N)`), default `active`.
Sort selector (`last-seen` / `seen-count desc` / `first-seen`).

Each item row:

```
[● strength dot] [kind pill] {title}                 last-seen 5/12 · seen 8×
                                                      [dismiss] [snooze ▾] [resolve]
   evidence (this round):    │  evidence (prev round):
   - ...                     │  - ...
```

`snooze ▾` is a dropdown with `1d` / `7d` / `30d`.

On a successful action, the row's status pill animates to the new state and
the filter counts refresh client-side. The next cockpit auto-reload (within
60 seconds) re-renders the graph without the dismissed / snoozed nodes.

## Migrations And Compatibility

The schema migration is idempotent (`CREATE TABLE IF NOT EXISTS`). Old
deploys without the table have it created on first start. There is no
back-fill: backlog starts empty and fills from the next observation cycle.
That is acceptable because old reports were ephemeral by design.

The deploy-dev workflow's `EXPECTED_APP_VERSION` bumps to `0.7.0` so the
deploy verifier confirms the new build is running before declaring success.

## Test Strategy

- `src/backlog.test.ts`: pure functions — identity hashing, strength
  derivation, merge algorithm with in-memory SQLite, snooze expiry as
  read-side filter, dismiss / resolve transitions, auto-stale.
- `src/observation-loop.test.ts`: extend existing suite to assert that one
  cycle calls the merge step and that the second cycle increments
  `seen_count` for the same candidate.
- `src/idea-graph.test.ts`: assert SIGNAL / RESEARCH nodes come from the
  backlog, that `strength` propagates to node `confidence`, and that
  dismissed / snoozed / resolved rows are excluded.
- `src/web.test.ts`: extend for the four new endpoints, including
  validation (`days` must be 1, 7, or 30) and 404 for unknown id.

Total expected new test cases: ~12. The existing 38-pass suite stays
green; total ~50 after this change.

## YAGNI / Non-Goals

- No timeline beyond `prev_evidence_json` (Q4 chose "previous-round only").
- No AI-driven dedup (Q2 chose deterministic-only).
- No backlog → OpenCode automatic execution; that is the scope of the
  approval-resume flow (work item A).
- No cross-host backlog sync; single-host SQLite is sufficient.
- No un-dismiss UI in v0.7.0 (manual DB edit if Kevin ever needs it).
