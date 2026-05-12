## 1. Durable Backlog Foundation

- [ ] 1.1 Add `BacklogItem`, `BacklogKind`, `BacklogStatus`, and `BacklogStrength` types in `src/types.ts`.
- [ ] 1.2 Add `src/backlog.ts` with: `ensureBacklogSchema(db)`, `buildBacklogId(candidate)`, `deriveStrength(seen, miss)`, `mergeCandidatesIntoBacklog(db, candidates, now)`, `listBacklog(db, status)`, `dismiss/snooze/resolve(db, id, …)`.
- [ ] 1.3 Add `src/backlog.test.ts` covering identity hashing, strength derivation, merge upsert / first-seen / miss-count / auto-stale, status transitions, and snooze-expiry read-side filter.
- [ ] 1.4 Run `ensureBacklogSchema` on app start so existing deploys gain the table without manual migration.

## 2. Observation Loop Integration

- [ ] 2.1 In `src/observation-loop.ts`, call `mergeCandidatesIntoBacklog` after each successful observe and before the idea-graph refresh.
- [ ] 2.2 Record `lastBacklogAt` on `ObservationLoopState` so the cockpit poller can surface backlog freshness.
- [ ] 2.3 Extend `src/observation-loop.test.ts` to assert two consecutive cycles upsert the same candidate (seen_count goes from 1 to 2) and that a missing candidate increments miss_count.

## 3. Cockpit Graph Sourcing

- [ ] 3.1 Extract SIGNAL and RESEARCH node generation in `src/idea-graph.ts` so they read from the durable backlog instead of raw report candidates.
- [ ] 3.2 Propagate `BacklogStrength` to the existing node `confidence` field so the cockpit's CSS visual treatment reflects recurrence.
- [ ] 3.3 Exclude `dismissed`, `resolved`, and currently-`snoozed` rows from the graph; keep them reachable via the backlog API.
- [ ] 3.4 Extend `src/idea-graph.test.ts` for backlog-sourced node generation, strength → confidence mapping, and status-based filtering.

## 4. Backlog API And UI

- [ ] 4.1 Add `GET /api/backlog` returning items + filter counts; honour `?status=active|snoozed|resolved|dismissed|all`.
- [ ] 4.2 Add `POST /api/backlog/:id/{dismiss,snooze,resolve}` with snooze body validation (`days ∈ {1, 7, 30}`) and 404 for unknown id.
- [ ] 4.3 Replace the Observation Workbench section in `renderNeuralCockpit` with a `Durable Backlog` panel: filter chips, sort selector, evidence-side-by-side rows, per-row action buttons.
- [ ] 4.4 Add client-side handlers so dismiss / snooze / resolve update the row inline and refresh filter counts without a full reload.
- [ ] 4.5 Extend `src/web.test.ts` for the new endpoints and the inline-update behaviour.

## 5. Documentation And Release

- [ ] 5.1 Bump `package.json`, `package-lock.json`, `src/version.ts`, and `.github/workflows/deploy-dev.yml` `EXPECTED_APP_VERSION` to `0.7.0`.
- [ ] 5.2 Add the v0.7.0 entry to `README.md` and `AGENTS.md`.
- [ ] 5.3 Add OpenSpec `durable-backlog` capability spec at `specs/durable-backlog/spec.md` describing the persistent backlog requirements and Kevin-facing actions.

## 6. Verification And Release

- [ ] 6.1 Run `npm run build` and `npm test`; suite stays green with the new tests.
- [ ] 6.2 Smoke test in a locally-built Docker container: trigger two consecutive observations, confirm seen_count increments, dismiss / snooze a row, confirm the cockpit graph reflects the strength visuals.
- [ ] 6.3 Commit and push; verify CI, Docker image publish, and `Deploy Kevinhome` succeed and `https://kevin.sisihome.org/health` reports `0.7.0`.
