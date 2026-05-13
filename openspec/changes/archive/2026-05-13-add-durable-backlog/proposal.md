## Why

Today the cockpit shows observation results as if every cycle is the first
time Kevin has ever seen them: each 5-minute observation re-derives the
candidate list, the cockpit graph re-draws SIGNAL nodes from the freshest
report, and last cycle's view is gone. Kevin reported that the same
"kevin-autopilot has uncommitted work" candidate keeps appearing as new, with
no way to say "I already saw this, don't keep nagging" or "snooze it for a
week", and the cockpit gives no sense of which signals have been recurring.

The v0.6 README already calls for "continuous multi-project observation as a
first-class workflow: suspected bugs, likely bugs, improvement candidates,
prototype candidates, and items that need Kevin's decision should be shown
as a durable planning backlog rather than only as one-off reports." This
change is the smallest implementation of that promise.

## What Changes

- Add an Autopilot-owned `backlog_items` table inside the existing
  `data/autopilot.db` SQLite database. Each row has a deterministic id
  (`repo + kind + key_fields` hash) so the same underlying signal upserts
  rather than duplicates across cycles.
- Extend the background observation loop so each successful run upserts that
  cycle's candidates into the backlog, increments `seen_count` for hits,
  increments `miss_count` for active items that did not recur, derives a
  per-item `strength` (`weak` / `medium` / `strong`) from `seen_count`, and
  auto-stales items that go missing for several cycles.
- Replace the per-cycle Observation Workbench section in the cockpit with a
  Durable Backlog table that filters by `active` / `snoozed` / `resolved` /
  `dismissed`, shows first-seen, last-seen, seen-count, and a side-by-side
  view of this round's evidence versus the previous round's evidence.
- Add three Kevin-facing actions on each backlog item: `dismiss` (permanent),
  `snooze` for `1` / `7` / `30` days, and `mark-resolved`. All actions are
  pure metadata writes and do not touch target repositories.
- Re-source cockpit SIGNAL and RESEARCH graph nodes from the durable backlog
  rather than from the raw observation report. Node strength controls border,
  glow, and font weight so recurring items visibly stand out. `snoozed`,
  `dismissed`, and `resolved` items do not appear on the graph (but remain
  reachable via the backlog filter).
- Preserve the read-only safety boundary: the backlog is purely
  Autopilot-owned metadata. No commit, push, deploy, target-repo write, or
  unmanaged-secret read is introduced by this change.

## Capabilities

### New Capabilities

- `durable-backlog`: SQLite-backed persistent backlog of observation
  candidates with deterministic identity, per-item status / strength, and
  Kevin-facing dismiss / snooze / resolve actions.

### Modified Capabilities

- `double-research-loop`: every background observation cycle now upserts
  candidates into the durable backlog before producing the idea graph and
  observation report.
- `neural-cockpit`: replaces the per-cycle Observation Workbench panel with
  a Durable Backlog view; SIGNAL and RESEARCH graph nodes are read from the
  durable backlog so node visuals reflect recurrence strength.
- `idea-graph`: SIGNAL and RESEARCH nodes derive their `confidence` /
  `strength` from the durable backlog row instead of from raw observation
  candidates.

## Impact

- Adds `src/backlog.ts` (repository + merge logic) and
  `src/backlog.test.ts`.
- Extends `src/observation-loop.ts` to call the backlog merge step before
  graph refresh; extends `src/observation-loop.test.ts` accordingly.
- Extends `src/idea-graph.ts` to read SIGNAL / RESEARCH nodes from the
  backlog; extends `src/idea-graph.test.ts` for strength → visual mapping.
- Extends `src/web.ts` with `GET /api/backlog` and `POST
  /api/backlog/:id/{dismiss,snooze,resolve}`; extends `src/web.test.ts`.
- Adds a SQLite migration step that creates `backlog_items` if missing
  (idempotent, runs on app start). No data migration from existing JSON
  reports; the backlog starts empty and fills up from the next cycle.
- Bumps `package.json`, `package-lock.json`, `src/version.ts`, and
  `.github/workflows/deploy-dev.yml` `EXPECTED_APP_VERSION` to `0.7.0`.
- Updates `README.md` and `AGENTS.md` with the v0.7.0 entry.
- Does not require a new external dependency. SQLite is already used for
  Gemini key storage.
