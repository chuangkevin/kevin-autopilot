## 1. Types

- [ ] 1.1 Add `DeliberationPersona`, `PersonaRound`, `DeliberationSynthesis`, `DeliberationRecord`, `DeliberationState` types to `src/types.ts`

## 2. ObservationLoop forceRun

- [ ] 2.1 Add `forceRun()` to `ObservationLoop` in `src/observation-loop.ts`: waits for any in-flight run to settle, then calls `executeRun()` unconditionally (bypasses `enabled` guard)
- [ ] 2.2 Add `observation-loop.test.ts` case: `forceRun()` fires full cycle when `enabled: false`; `forceRun()` waits for in-flight then fires a new cycle

## 3. Deliberation Module

- [ ] 3.1 Create `src/deliberation.ts` exporting `runDeliberation(config, report, graph, backlog): Promise<DeliberationRecord>` and a module-level `isDeliberationRunning(): boolean`
- [ ] 3.2 Implement `pickRoles(config, report, graph): Promise<DeliberationPersona[]>` — one Gemini call with structured JSON output; validates 2–4 personas; throws on failure
- [ ] 3.3 Implement `runIndependentAnalysis(config, personas, snapshot): Promise<PersonaRound[]>` — parallel Gemini calls, one per persona; silently drops failed personas; returns survivors
- [ ] 3.4 Implement `runDebateRound(config, survivors, priorRounds, roundIndex): Promise<PersonaRound[]>` — parallel Gemini calls with all prior output as context; skips round if fewer than 2 survivors
- [ ] 3.5 Implement `runSynthesis(config, allRounds): Promise<DeliberationSynthesis>` — single Gemini call producing summary, consensusPoints, blindspotsFound, seeds (max 3)
- [ ] 3.6 Implement `persistDeliberation(config, record): Promise<void>` — write to `data/deliberations/<id>.json`, prune oldest if count > 10
- [ ] 3.7 Implement `loadLatestDeliberation(config): Promise<DeliberationRecord | null>` — read most recent file from `data/deliberations/`
- [ ] 3.8 After synthesis, call `createAiIdeaFromSeed()` for each seed; store `seedsInjected` count in the record
- [ ] 3.9 Add `src/deliberation.test.ts`: role picker failure aborts; partial persona failure continues; fewer than 2 survivors skips debate; synthesis with zero seeds completes; record persisted and loadLatest returns it; 10-record prune works

## 4. API Endpoints

- [ ] 4.1 Add `POST /api/deliberation` in `src/web.ts`: trusted-settings gated; returns `202 { status: 'started' }` or `409 { status: 'already_running' }` or `403`; starts `runDeliberation()` in the background (fire-and-forget with error logging)
- [ ] 4.2 Add `GET /api/deliberation/latest`: returns `{ status: 'idle' | 'running', record: DeliberationRecord | null }`; no trust gate (read-only)
- [ ] 4.3 Add `web.test.ts` cases: POST from trusted source returns 202; POST while running returns 409; POST from untrusted returns 403; GET returns idle with null before any run; GET returns running status while in-flight

## 5. UI

- [ ] 5.1 Add CSS for deliberation section to `renderPage` styles: `.deliberation-btn`, `.persona-chip`, `.deliberation-round`, `.deliberation-insight`, `.synthesis-box`
- [ ] 5.2 Add `renderDeliberationCard(state: DeliberationState): string` function — shows button + status line + result card (personas, round-0 insights, synthesis, blindspots, seeds count)
- [ ] 5.3 Update `renderBrainTab` to accept and render `DeliberationState`; update `renderPage` signature and the `/` handler to load `DeliberationState` via `loadLatestDeliberation` + `isDeliberationRunning`
- [ ] 5.4 Add client-side JS in `renderBrainTab` inline `<script>`: `triggerDeliberation()` POSTs, disables button, starts 3 s poll; `pollDeliberation()` calls GET every 3 s, calls `updateDeliberationUI(data)` on each tick; `updateDeliberationUI` re-enables button on done/error, reloads page on done

## 6. Tests And Build

- [ ] 6.1 Run `npm test` — confirm 0 failures
- [ ] 6.2 Run `npm run build` — confirm 0 errors

## 7. Documentation And Release

- [ ] 7.1 Bump `src/version.ts`, `package.json`, `package-lock.json`, and `.github/workflows/deploy-dev.yml` `EXPECTED_APP_VERSION` to `0.14.0`
- [ ] 7.2 Add v0.14.0 entry to `README.md` and `AGENTS.md` describing force-think, deliberation engine, and `data/deliberations/`

## 8. Verification And Deploy

- [ ] 8.1 Commit, push, verify `deploy-dev` brings `https://kevin.sisihome.org/health` to `0.14.0`
- [ ] 8.2 Open `/` on Android, tap 分身 tab, tap "⚡ 強制思考", confirm button disables, status shows "辯論進行中…", and result card appears after completion
