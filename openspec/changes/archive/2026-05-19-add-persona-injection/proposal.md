## Why

The 分身 framing is everywhere in the UI, but the AI behind it speaks generic-analyst voice. `kevin-ai-persona/PERSONA.md` describes Kevin's working style (priorities, problem-solving pattern, autonomy rules, dislikes, reporting style) but no code path loads it — reflection writes "提升使用者體驗" instead of "別碰 worker pool，先讓 status 露出來". Deliberation personas are picked dynamically per run with no continuity; the system has no persistent mood derived from a longer-than-one-cycle window; archive (`先不要想`) is a one-way hide that nothing learns from.

## What Changes

- Mirror `homelab-docs/kevin-ai-persona/PERSONA.md` into this repo as `persona/PERSONA.md` (committed). Dockerfile copies it into `/app/persona/PERSONA.md` at build time.
- Add `src/persona.ts` exporting `buildPersonaPrefix(mode, config)` and `buildCastPrefix(castId, config)`. Both compose: PERSONA.md content + current mood line + preference summary + the original task system instruction.
- Add `src/mood.ts` exporting `computeMood(config)` and `readMoodState(config)`. Deterministic rule from 24h signals: `score_avg_24h`, `backlog_active_count`, `backlog_added_24h`, `archive_added_24h`, `seeds_injected_24h`, `nodes_added_24h`. Labels: `excited` / `flow` / `tense` / `idle`. Recomputed at end of every observation cycle; cached at `data/mood-state.json`.
- Add `src/preferences.ts` exporting `computePreferences(config)` and `readPreferences(config)`. Hybrid: `< 10` archived nodes → keyword frequency (no AI call); `>= 10` → Gemini theme abstraction (throttled to once per 24h). Cached at `data/preference-cache.json`. Recomputed fire-and-forget after each `POST /api/idea/:id/archive` and `POST /api/idea/:id/unarchive`.
- Switch `runDeliberation` to use a fixed 4-cast (`engineer`, `designer`, `risk`, `vacation` — all named "Kevin") by default, each with its own lens slice of `PERSONA.md`. `pickRoles` is retained as a fallback when PERSONA.md or cast loading fails.
- Wire `buildPersonaPrefix` into `reflection.ts` and `boost.ts`; wire `buildCastPrefix` into each cast's persona prompt inside `deliberation.ts`. The original task-specific system instruction is concatenated after the prefix.
- Bump to v0.17.0 (`src/version.ts`, `package.json`, `package-lock.json`, `.github/workflows/deploy-dev.yml` `EXPECTED_APP_VERSION`).

## Capabilities

### New Capabilities

- `persona-injection`: persistent persona / mood / preference layer that composes a Kevin-flavoured system-instruction prefix for every Gemini call. Owns `persona/PERSONA.md` loading, mood-state computation from existing observation signals, preference derivation from archived nodes, the 4-cast definition, the prefix composition functions, and the persistence files `data/mood-state.json` and `data/preference-cache.json`.

### Modified Capabilities

- `ai-graph-reflection`: reflection prompts get the persona prefix prepended; reflection output is expected to sound like Kevin (use his priorities, his report shape, his dislikes).
- `single-node-boost`: boost prompts get the persona prefix prepended; enrichment output is expected to sound like Kevin.
- `deliberation-engine`: deliberation switches from `pickRoles` dynamic personas to a fixed 4-cast by default; each cast member's system instruction is built by `buildCastPrefix`. `pickRoles` becomes a fallback used only when PERSONA.md is missing.
- `double-research-loop`: observation cycle calls `computeMood` at end of cycle and persists `data/mood-state.json`.

## Impact

- **Modified files**: `src/reflection.ts` (persona prefix), `src/boost.ts` (persona prefix), `src/deliberation.ts` (4-cast + cast prefix), `src/observation-loop.ts` (compute mood at cycle end), `src/web.ts` (preference recompute on archive/unarchive), `src/version.ts`, `package.json`, `package-lock.json`, `.github/workflows/deploy-dev.yml`, `README.md`, `AGENTS.md`, `Dockerfile`.
- **New files**: `persona/PERSONA.md` (initial mirror of homelab-docs), `src/persona.ts`, `src/mood.ts`, `src/preferences.ts`, `src/persona.test.ts`, `src/mood.test.ts`, `src/preferences.test.ts`.
- **Persisted data**: `data/mood-state.json` and `data/preference-cache.json`. Forward-compatible — older deployments without these files start fresh.
- **No new npm dependency.** Reuses existing `GeminiClient` / `KeyPool` pattern.
- **PERSONA.md sync is manual for this change.** A separate change later adds an automated sync script.
- **Token cost**: PERSONA.md ≈ 1500 tokens added to every AI call. < $0.003 per cycle on Gemini 2.5 pricing.
- **Deployment**: same image / runner / health-gate path. Deploy-dev must come back green at `kevin.sisihome.org/health=0.17.0` before archiving.
- **Dependency on add-brain-tab-redesign**: v0.16.0 archive infrastructure must ship first. Implementation can start without it but archival of v0.17.0 requires v0.16.0 archived first.
