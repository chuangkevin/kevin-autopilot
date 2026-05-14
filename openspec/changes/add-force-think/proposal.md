## Why

The observation loop runs every 5 minutes automatically, but Kevin has no way to manually trigger a single cycle on demand — and no way to stress-test the double's reasoning by having multiple AI personas independently analyse the current project state, debate each other's blind spots, and surface insights the scheduled cycle would miss.

## What Changes

- Add `ObservationLoop.forceRun()`: identical to `executeRun` but bypasses the `enabled` guard so it fires even in manual mode.
- Add `src/deliberation.ts`: orchestrates a multi-agent deliberation — role picker, N independent persona analyses, up to 2 debate rounds (each persona reads all others' prior output), synthesis agent that produces a summary + `ReflectionIdeaSeed[]` injected into the idea graph.
- Add `GET /api/deliberation/latest` and `POST /api/deliberation` (trusted-settings gated): start a deliberation and poll for the result.
- Add a "強制思考" button in the 分身 tab and a deliberation-result card below it; the card shows running state while in flight and the latest record (personas, round highlights, synthesis, seeds injected) once done.
- Persist each deliberation record to `data/deliberations/<id>.json`.
- Bump to v0.14.0.

## Capabilities

### New Capabilities

- `deliberation-engine`: Multi-agent deliberation pipeline — role picker AI decides which 2–4 personas to deploy based on current project state; personas observe independently (parallel AI calls from same raw data); up to 2 debate rounds where each persona reacts to all others; synthesis agent produces a summary, consensus points, blind spots found, and idea seeds; records persisted and the cockpit surfaces the latest result.

### Modified Capabilities

- `neural-cockpit`: 分身 tab gains a "強制思考" button (trusted-settings source required) and a deliberation-result card that polls for status and renders the latest deliberation record inline.
- `double-research-loop`: gains `forceRun()` which bypasses the `enabled` guard and the in-flight deduplication reset, allowing a one-shot cycle regardless of background observation config.

## Impact

- New file: `src/deliberation.ts`, `src/deliberation.test.ts`
- Modified: `src/observation-loop.ts` (add `forceRun`), `src/web.ts` (API endpoints + UI), `src/types.ts` (new deliberation types)
- New persisted path: `data/deliberations/` (Autopilot-owned, reversible)
- No new npm dependency; reuses existing `GeminiClient` / `KeyPool` pattern from `reflection.ts`
- Bumps `src/version.ts`, `package.json`, `package-lock.json`, `.github/workflows/deploy-dev.yml` `EXPECTED_APP_VERSION` to `0.14.0`
- Updates `README.md` and `AGENTS.md` with v0.14.0 entry
