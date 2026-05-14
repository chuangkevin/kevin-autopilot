## Context

`AutopilotConfig` is loaded once at startup from
`$KEVIN_AUTOPILOT_CONFIG`. The observation loop, reflection module,
and web handlers all reach into `config.aiReflection?.enabled`,
`config.aiReflection?.maxPendingAiIdeas`, and
`config.backgroundObservation?.enabled` directly. There is no
intermediate effective-config layer, so any toggle today requires
editing the mounted JSON and restarting the container.

`/settings` already has a precedent for Autopilot-owned mutable state:
Gemini keys live in `data/autopilot.db`. That trusted-settings-gated
pattern is the right model for these overrides too.

## Goals / Non-Goals

**Goals:**

- A whitelisted runtime override layer for a small, explicit set of
  operator toggles.
- All decision points that read those toggles use an effective-config
  helper, not the raw file config.
- Settings page and API can flip toggles without restarting the
  container; the next observation cycle picks them up.
- Read-only safety: target-repo / service / rule-source / AI key
  config stays file-only.

**Non-Goals:**

- No full "edit any config field" UI. The whitelist is the contract.
- No multi-user / multi-tenant override scope. There is one Kevin and
  one Autopilot.
- No history of override changes (who changed what when). If audit is
  needed later it lives in `data/`, separate change.
- No hot-reload of `repositories[]`, `services[]`, `ruleSources[]`,
  `ai.model`, `ai.timeoutMs`, `dataDir`, or `webResearch.*`. These
  affect the safety boundary or require a deeper rewire.

## Decisions

### Decision 1: Whitelist lives in `src/runtime-overrides.ts`, not in user config

The set of overridable fields is hard-coded in the new module. A
field that is not in the whitelist is ignored on read and rejected on
write. The whitelist is the only place to expand the surface, which
keeps the safety-boundary review in code rather than per-config.

Initial whitelist:

```
aiReflection.enabled            (boolean)
aiReflection.maxOutputTokens    (integer 100..2000)
aiReflection.maxPendingAiIdeas  (integer 1..50)
backgroundObservation.enabled   (boolean)
backgroundObservation.intervalMs (integer 60_000..3_600_000)
```

**Alternative considered**: free-form `Partial<AutopilotConfig>` merge.
Rejected — any future config addition would silently become
toggleable, bypassing safety review.

### Decision 2: `getEffectiveConfig(config)` returns a fresh merged object per call

The override file is small (a few KB at most). Loading + merging on
each call costs ~1–3ms which is negligible compared to one
observation cycle. Read-on-demand means we don't need a cache
invalidation story; the next call sees the latest disk state.

Signature:

```ts
export async function getEffectiveConfig(config: AutopilotConfig): Promise<AutopilotConfig>
```

The returned object is a structural clone of `config` with whitelisted
fields shallow-merged from the override file. The original `config`
object stays immutable.

**Alternative considered**: synchronous in-memory cache invalidated by
the PUT handler. Rejected — observation loop runs in the same process
so it would race; we'd need locking. On-demand read is simpler and
fast enough.

### Decision 3: `data/runtime-overrides.json` is JSON, not SQLite

The Gemini key DB pattern was chosen because keys are sensitive and
benefit from per-row access control. Overrides are non-sensitive
toggles read+written as a whole. JSON is simpler and lets Kevin
hand-edit the file in emergencies. Schema validation happens in
`loadRuntimeOverrides` so a hand-edit error fails closed (returns
empty overrides, logs a warning) rather than crashing the loop.

### Decision 4: PUT semantics are "merge by deep-set", not "replace"

`PUT /api/runtime-overrides` accepts a partial overrides shape. The
handler:

1. Loads the existing overrides file.
2. For each whitelisted field present in the request body, sets it.
3. For each whitelisted field NOT present, keeps the existing value.
4. Rejects (400) any field not in the whitelist.
5. Writes the merged result to disk and returns it.

To remove an override (revert to config-file value), send `null` for
that field. The handler removes the key.

**Alternative considered**: PUT-as-full-replace. Rejected — UI would
have to always submit the full whitelist, brittle.

### Decision 5: Settings page renders a single overrides section, not a per-capability page

Keep `/settings` as one scroll. The new section sits below the Gemini
key section. Each field is rendered with its current effective value
and whether it's "overridden" or "default". An inline reset button
sends `{ [field]: null }`.

The cockpit reflection status line stays untouched in terms of layout;
it just gets correct numbers because it now reads effective config.

## Risks / Trade-offs

- [Risk] Two browsers open `/settings` and PUT simultaneously → last
  write wins. Mitigation: rare in practice (single-user system); add
  an ETag/If-Match later if it bites.
- [Risk] Hand-edited overrides JSON contains invalid types →
  Mitigation: `loadRuntimeOverrides` validates per field and silently
  drops invalid entries with a console warning; the system falls back
  to file-config behavior.
- [Risk] Effective config is read at the wrong moment, leading to
  inconsistent reads within one cycle → Mitigation: each
  `executeRun()` calls `getEffectiveConfig` once and threads it
  through the cycle. Inside the cycle the config stays consistent.
- [Risk] User flips `backgroundObservation.enabled = false` while a
  cycle is mid-flight → Mitigation: the cycle finishes normally; the
  *next* scheduling check sees the new value and stops scheduling.
  The override does not abort an in-flight cycle.
- [Trade-off] Slightly more code surface vs. directly editing config
  JSON. Justified by avoiding SSH-into-prod and matching how Gemini
  keys are already managed.

## Migration Plan

1. Ship code with no override file in place. `loadRuntimeOverrides`
   returns `{}`, behavior is identical to v0.11.0.
2. After deploy, Kevin uses `/settings` to flip
   `aiReflection.enabled = true`. The override file is created on the
   first PUT.
3. Rollback: delete `data/runtime-overrides.json`, restart container,
   behavior reverts to file-config defaults.

## Open Questions

- Should the cockpit show a visible "OVERRIDDEN" badge next to fields
  whose effective value differs from the file config? Defer to user
  feedback after v0.12.0 — the settings page itself shows
  overridden/default, which is probably enough.
