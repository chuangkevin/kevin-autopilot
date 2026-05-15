## 1. Persona Source Mirror

- [x] 1.1 Copy `D:/Projects/_HomeProject/homelab-docs/kevin-ai-persona/PERSONA.md` into this repo as `persona/PERSONA.md` (manual mirror for v0.17.0).
- [x] 1.2 Update `Dockerfile`: add `COPY persona/PERSONA.md /app/persona/PERSONA.md` so the image bundles the persona at build time.
- [x] 1.3 Document the manual sync step in `README.md` (a follow-up change will automate it).

## 2. Mood Module

- [x] 2.1 Add `MoodState` and `MoodLabel` types to `src/types.ts`.
- [x] 2.2 Create `src/mood.ts` exporting `computeMood(config): Promise<MoodState>`, `readMoodState(config): Promise<MoodState | null>`, `persistMoodState(config, state): Promise<void>`.
- [x] 2.3 Implement signal collection: read backlog (`listBacklog` active count + `created_at` within 24h), idea-graph (`archivedAt` and `createdAt` within 24h), deliberation directory (sum `synthesis.seedsInjected` for records finished within 24h), and observation loop excitement-score history.
- [x] 2.4 Implement deterministic mood rule per design (tense → excited → idle → flow precedence).
- [x] 2.5 Persist to `data/mood-state.json`.
- [ ] 2.6 Add `src/mood.test.ts`: each rule branch fires for the right signal combination; missing inputs default to `flow`; persistence round-trips.

## 3. Preferences Module

- [x] 3.1 Add `Preferences` and `PreferenceMode` types to `src/types.ts`.
- [x] 3.2 Create `src/preferences.ts` exporting `recomputePreferences(config): Promise<Preferences>`, `readPreferences(config): Promise<Preferences | null>`.
- [x] 3.3 Implement Stage A keyword frequency for `archivedCount < 10` (no Gemini call).
- [x] 3.4 Implement Stage B Gemini theme abstraction for `archivedCount >= 10`, with structured JSON output and validation.
- [x] 3.5 Implement 24h throttle for Stage B: if cached `mode === 'themes'` and `now - computedAt < 24h`, skip Gemini and reuse themes (refresh Stage A keyword summary as cheap supplement).
- [x] 3.6 Implement Stage B fallback to Stage A on Gemini failure.
- [x] 3.7 Persist to `data/preference-cache.json`.
- [ ] 3.8 Add `src/preferences.test.ts`: Stage A under threshold; Stage B at threshold; throttle skips Gemini within 24h; Gemini failure falls back to Stage A; archive 5 times triggers at most 1 Gemini call.

## 4. Persona Composer

- [x] 4.1 Create `src/persona.ts` exporting `buildPersonaPrefix(mode, config)`, `buildCastPrefix(castId, config)`, `CAST` (the four cast definitions), and `loadPersona(): Promise<string>`.
- [x] 4.2 Implement `loadPersona`: read `/app/persona/PERSONA.md` once at first call, cache in memory, return stub `"你是 Kevin 的分身。"` on read failure.
- [x] 4.3 Define the four cast members in `src/persona.ts`: `engineer` (工程師 Kevin), `designer` (設計師 Kevin), `risk` (風險 Kevin), `vacation` (休假 Kevin), each with `displayName`, `lensSections: string[]`, `characteristicChallenges: string[]`.
- [x] 4.4 Implement `buildPersonaPrefix(mode, config)`: concat persona + mood line + preferences summary + delimiter.
- [x] 4.5 Implement `buildCastPrefix(castId, config)`: cast identity preamble + persona + deliberation-mood line (with cast-speaks-louder hint) + preferences summary + delimiter; throw on unknown castId.
- [ ] 4.6 Add `src/persona.test.ts`: each cast yields distinct preamble; mood missing defaults to flow; preferences missing yields "(尚無紀錄)"; persona missing returns stub.

## 5. Wire Reflection / Boost / Deliberation

- [x] 5.1 `src/reflection.ts`: prepend `await buildPersonaPrefix('reflection', config)` + delimiter to the existing reflection system instruction; preserve all other behavior.
- [x] 5.2 `src/boost.ts`: prepend `await buildPersonaPrefix('boost', config)` + delimiter to the boost system instruction in `enrichNode`.
- [x] 5.3 `src/deliberation.ts`: change `runDeliberation` default path to skip `pickRoles` and use the four-cast. Each cast member's `analyzeAsPersona` system instruction prepends `await buildCastPrefix(castId, config)` + delimiter. Keep `pickRoles` and the legacy path as a fallback when `buildCastPrefix` throws for any cast.
- [ ] 5.4 Update existing reflection / boost / deliberation tests to expect persona-prefix presence (or mock `buildPersonaPrefix` to return a known stub for unit-test simplicity).

## 6. Observation Loop Wiring

- [x] 6.1 `src/observation-loop.ts`: at the end of `executeRun` (after the reflection call returns), call `computeMood(config).then(persistMoodState).catch(...)` so mood updates per cycle.
- [x] 6.2 Confirm cycle still marks success even when mood compute throws.
- [ ] 6.3 Add a unit test in `src/observation-loop.test.ts`: cycle persists `data/mood-state.json` on success; cycle still succeeds when mood compute is forced to throw.

## 7. Preference Trigger Wiring

- [x] 7.1 `src/web.ts`: in the `POST /api/idea/:id/archive` handler, after successful persistence, fire `void recomputePreferences(config).catch(...)`.
- [x] 7.2 Same in `POST /api/idea/:id/unarchive`.
- [ ] 7.3 Add `src/web.test.ts` cases: after a successful archive POST, `data/preference-cache.json` exists and contains the just-archived node's keywords (Stage A); after a successful unarchive POST, the cache reflects the reduced archived set.

## 8. Tests And Build

- [x] 8.1 Run `npm test` — confirm 0 failures.
- [x] 8.2 Run `npm run build` — confirm 0 errors.

## 9. Documentation And Release

- [x] 9.1 Bump `src/version.ts`, `package.json`, `package-lock.json`, `.github/workflows/deploy-dev.yml` `EXPECTED_APP_VERSION` to `0.17.0`.
- [x] 9.2 Add v0.17.0 entry to `README.md` and `AGENTS.md` describing persona injection, the four cast, mood, and preferences.

## 10. Verification And Deploy

- [ ] 10.1 Commit, push, verify `deploy-dev` brings `https://kevin.sisihome.org/health` to `0.17.0` (probe from a Tailscale-connected host).
- [ ] 10.2 Open `/分身` after a fresh cycle, confirm a refreshed node's `thinking` reads in Kevin's voice (priorities + dislikes + report shape recognisable).
- [ ] 10.3 Trigger 🧠 深度辯論 on a non-center node; confirm the persisted `DeliberationRecord.personas[]` contains the four cast names in canonical order.
- [ ] 10.4 Inspect `data/mood-state.json` after a cycle completes; confirm a mood label and signal block are present.
- [ ] 10.5 Archive a node, wait ~30 s, inspect `data/preference-cache.json`; confirm the archived node's keywords are reflected.
- [ ] 10.6 Archive change via `openspec archive add-persona-injection` once 10.1–10.5 pass (and v0.16.0 has already been archived).
