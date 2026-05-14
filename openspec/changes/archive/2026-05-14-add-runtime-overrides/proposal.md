## Why

v0.11.0 shipped AI reflection dark (`aiReflection.enabled: false` in
`config/kevinhome.example.json`). Flipping it on currently requires SSH
into the kevinhome host, editing the mounted config JSON, and
restarting the container. The same pain applies to other operator
toggles like `backgroundObservation.enabled` or
`aiReflection.maxPendingAiIdeas`.

Kevin asked for a settings-page toggle, and chose a general runtime
override layer over a single-flag hack. The cockpit / observation loop
should read an effective config that merges the file config with an
Autopilot-owned override file, both written from the existing
`/settings` page behind the same trusted-settings guard used by Gemini
key import.

The override surface MUST be whitelisted: only the fields explicitly
documented as runtime-safe can be toggled. Repository lists, service
endpoints, AI provider, key storage, dataDir, and rule-source paths
stay file-only so a UI bug cannot reshape the read-only safety
boundary.

## What Changes

- Add a `data/runtime-overrides.json` Autopilot-owned file with a
  whitelisted shape: `{ aiReflection?: { enabled?, maxOutputTokens?,
  maxPendingAiIdeas? }, backgroundObservation?: { enabled?,
  intervalMs? } }`. Unknown keys are ignored on read.
- Add `src/runtime-overrides.ts` exporting `loadRuntimeOverrides`,
  `saveRuntimeOverrides`, `applyRuntimeOverrides`, and
  `getEffectiveConfig(config)` helpers. The merge is non-destructive;
  the original config object is not mutated.
- Hook the observation loop, reflection module, web request handlers,
  and cockpit render path to read effective config instead of the raw
  file config when their decision depends on a whitelisted field.
- Add `GET /api/runtime-overrides` returning `{ overrides, schema }`
  and `PUT /api/runtime-overrides` accepting a partial overrides
  object; both gated by `isTrustedSettingsRequest`. PUT validates
  every field against the schema and ignores or rejects keys not in
  the whitelist.
- Add a "Runtime Overrides" section to `/settings` with a checkbox
  per boolean toggle, a number input per numeric toggle (with min/max
  hints), an inline "Reset to config defaults" button, and a small
  reload hint when relevant.
- Surface the *effective* `maxPendingAiIdeas` cap and
  `aiReflection.enabled` state in the cockpit reflection status line
  so the user can tell whether the runtime override is currently in
  effect.

## Capabilities

### New Capabilities

- `runtime-overrides`: Autopilot-owned whitelisted runtime config
  override layer with file persistence, trusted-settings API, and
  settings-page UI.

### Modified Capabilities

- `neural-cockpit`: settings page gains a Runtime Overrides section
  and the cockpit reflection status reflects the effective config
  (overridden cap and enabled state), not the file-only config.
- `double-research-loop`: observation loop reads effective config each
  cycle, so flipping `aiReflection.enabled = true` (or
  `backgroundObservation.enabled = false`) via the settings page takes
  effect on the next cycle without a container restart.
- `ai-graph-reflection`: reflection respects effective
  `aiReflection.*` knobs (enabled, maxOutputTokens, maxPendingAiIdeas)
  and the cockpit / API surface them consistently.

## Impact

- Affects `src/types.ts` (new `RuntimeOverrides` type),
  `src/observation-loop.ts`, `src/reflection.ts`, `src/web.ts`,
  `src/runtime-overrides.ts` (new), plus their tests.
- New persisted file: `data/runtime-overrides.json` (Autopilot-owned).
- Bumps `package.json`, `package-lock.json`, `src/version.ts`, and
  `.github/workflows/deploy-dev.yml` `EXPECTED_APP_VERSION` to
  `0.12.0`.
- Updates `README.md` and `AGENTS.md` with the v0.12.0 entry.
- No new dependency, no Docker image change beyond the rebuilt JS
  bundle, no schema migration (the override file is created on first
  write).
- Read-only safety stays intact: only whitelisted fields are
  overridable; target-repo / service / rule-source structure stays
  file-only.
