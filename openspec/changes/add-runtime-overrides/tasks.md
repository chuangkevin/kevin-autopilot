## 1. Types And Whitelist

- [x] 1.1 Add `RuntimeOverrides` type in `src/types.ts` with optional `aiReflection?: { enabled?: boolean; maxOutputTokens?: number; maxPendingAiIdeas?: number }` and `backgroundObservation?: { enabled?: boolean; intervalMs?: number }`.
- [x] 1.2 Add `RuntimeOverrideSchema` type describing each whitelisted field's `type` ('boolean' | 'integer'), `min`/`max` for integers, `label`, and `description` (rendered in the settings UI).

## 2. Runtime Overrides Module

- [x] 2.1 Create `src/runtime-overrides.ts` exporting `loadRuntimeOverrides(config): Promise<RuntimeOverrides>`, `saveRuntimeOverrides(config, overrides): Promise<RuntimeOverrides>`, `applyRuntimeOverrides(config, overrides): AutopilotConfig`, and `getEffectiveConfig(config): Promise<AutopilotConfig>`.
- [x] 2.2 Export `RUNTIME_OVERRIDE_SCHEMA` — a JSON-serialisable description of the whitelist used by the API and the settings UI.
- [x] 2.3 Implement strict per-field validation in `loadRuntimeOverrides`: drop invalid types or out-of-range values, warn on stderr, return a sanitised object. Unknown keys are dropped silently.
- [x] 2.4 Implement `getEffectiveConfig` as a non-destructive structural clone of `config` with whitelisted fields merged from the saved overrides; original `config` object stays unchanged.
- [x] 2.5 Implement `saveRuntimeOverrides` as a partial merge by deep-set: each whitelisted field in the input overwrites; `null` removes; unknown keys throw a `RuntimeOverrideError('not-in-whitelist', key)`.

## 3. Wire Effective Config Into Decision Points

- [x] 3.1 In `src/observation-loop.ts:executeRun`, call `await getEffectiveConfig(this.config)` once at the start of the cycle and thread the result through the cycle (`observe`, `mergeBacklog`, `getIdeaGraph`, `runReflectionSafely`). Tests that rely on no override should still work — `getEffectiveConfig` returns a clone of the file config when no override file exists.
- [x] 3.2 In `src/observation-loop.ts:scheduleNextRun`, read effective `backgroundObservation.enabled` and `intervalMs` so a runtime change kicks in for the next scheduled cycle.
- [x] 3.3 In `src/reflection.ts:reflect`, accept the already-effective config (no internal re-merge — the loop hands it in).
- [x] 3.4 In `src/web.ts` handlers that read `aiReflection.maxPendingAiIdeas` (`/api/reflection/state` response) and any other whitelisted field, call `await getEffectiveConfig(config)` to obtain the effective value.

## 4. API Surface

- [x] 4.1 Add `GET /api/runtime-overrides` returning `{ overrides, schema }`. Trusted-settings gated; non-trusted callers return 403.
- [x] 4.2 Add `PUT /api/runtime-overrides` accepting a partial overrides JSON. Validate every present key against `RUNTIME_OVERRIDE_SCHEMA`; reject (400) on any unknown key with a message that names the offending key. Persist on success; respond 200 with the merged overrides.
- [x] 4.3 PUT MUST treat a `null` value for a whitelisted field as "remove this override" (revert to file-config default).
- [x] 4.4 Both endpoints reuse `isTrustedSettingsRequest` exactly like Gemini key endpoints.

## 5. Settings Page UI

- [x] 5.1 Render a new "Runtime Overrides" section in `renderSettingsPage` below the existing Gemini key section. Initial render lists fields from `RUNTIME_OVERRIDE_SCHEMA` with current effective values, each labelled "已覆蓋" or "預設" plus the file-config default in muted text.
- [x] 5.2 Boolean fields render as a checkbox; integer fields render as a number input with min/max enforced via `min`/`max` HTML attributes. Inline "Reset to default" button per overridden field calls `PUT` with `null`.
- [x] 5.3 Client JS: on submit, POST `PUT /api/runtime-overrides` with the partial body, on success update the section in place using the response shape.

## 6. Cockpit Surfacing Effective Config

- [x] 6.1 Update `/api/reflection/state` to compute `pendingAiIdeasCap` from effective config, not file config.
- [x] 6.2 Update `ObservationLoopState.enabled` to report effective `backgroundObservation.enabled` so the 背景 chip is correct after a runtime toggle.

## 7. Tests

- [x] 7.1 Add `src/runtime-overrides.test.ts`: validation drops invalid values; `getEffectiveConfig` merges only whitelisted fields; `saveRuntimeOverrides` rejects unknown keys; `null` removes an override; missing override file returns empty object.
- [x] 7.2 Add `src/observation-loop.test.ts` case: starting the loop with `aiReflection.enabled = true` via override + file-config false runs reflection; flipping `backgroundObservation.enabled = false` mid-life stops further scheduling.
- [x] 7.3 Add `src/web.test.ts` cases: `GET /api/runtime-overrides` returns `{ overrides, schema }` with 200; PUT body with a non-whitelisted key returns 400; PUT body with `null` removes the field; both endpoints return 403 from non-trusted sources; settings page HTML includes a `Runtime Overrides` section.
- [x] 7.4 Update existing tests if any assertion compared full `AutopilotConfig` JSON shape to ignore optional override data.
- [x] 7.5 Confirm 100% of tests pass.

## 8. Documentation And Release

- [x] 8.1 Bump `src/version.ts`, `package.json`, `package-lock.json`, and `.github/workflows/deploy-dev.yml` `EXPECTED_APP_VERSION` to `0.12.0`.
- [x] 8.2 Add v0.12.0 entry to `README.md` and `AGENTS.md` describing the runtime overrides whitelist, settings UI, and that `data/runtime-overrides.json` is Autopilot-owned and reversible.
- [x] 8.3 Run `npm run build` and `npm test` with 0 failures.

## 9. Verification And Deploy

- [ ] 9.1 Rebuild the local Docker image, verify `/settings` renders the new section, flip `aiReflection.enabled` true via the UI, refresh `/`, and confirm the cockpit reflection-status line transitions from "反思離線：disabled" to a non-disabled state on the next cycle without restarting.
- [ ] 9.2 Commit, push, verify `deploy-dev` brings `https://kevin.sisihome.org/health` to `0.12.0`. Once live, optionally flip `aiReflection.enabled` true on the kevinhome instance via `/settings` to clear `add-ai-graph-reflection` task 10.2 in one click.
