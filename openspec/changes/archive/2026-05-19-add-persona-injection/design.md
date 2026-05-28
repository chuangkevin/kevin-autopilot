## Context

Source: `docs/superpowers/specs/2026-05-15-persona-injection-design.md` (commit `119ae89`). PERSONA.md content lives at `homelab-docs/kevin-ai-persona/PERSONA.md` and is the canonical source of Kevin's working-decision persona. It already documents core priorities, default problem-solving pattern, autonomy rules, debugging order, dislikes, and reporting style. No code path in `kevin-autopilot` currently reads it.

Existing AI entry points: `src/reflection.ts` (background reflection at end of each observation cycle), `src/boost.ts` (single-node enrichment from v0.16.0), `src/deliberation.ts` (multi-persona deliberation from v0.15.0, anchored from v0.16.0). All three call `GeminiClient.generateContent({ systemInstruction, prompt })`. None currently receive any persona context.

`excitementMode` (excited / cooling / normal) exists on `ObservationLoopState` and controls observation cadence. It is not a mood and does not influence prompts; it coexists with the new mood layer.

## Goals / Non-Goals

**Goals:**

- Every Gemini call (reflection, boost, deliberation) receives a PERSONA.md-derived system-instruction prefix so the output reads like Kevin.
- Deliberation uses four named, fixed cast members (`engineer` / `designer` / `risk` / `vacation`, all "Kevin") whose identity persists across runs; each cast's prompt names which slice of PERSONA.md shapes its lens.
- A `mood` label (`excited` / `flow` / `tense` / `idle`) is computed once per observation cycle from existing signals (no new telemetry) and injected into every Gemini call's prefix.
- An archive-derived `preferences` summary is computed asynchronously after every archive/unarchive operation and injected into every Gemini call's prefix.
- `src/persona.ts` is the single composer; the three AI entry points each call it once and concatenate the result before their existing task-specific system instruction.

**Non-Goals:**

- No edits to `homelab-docs/kevin-ai-persona/PERSONA.md`. It is the upstream source.
- No automated sync of `homelab-docs` → repo `persona/PERSONA.md`; manual sync for this change, automated in a follow-up.
- No multi-user persona scoping.
- No long-term episodic memory beyond what archive + observation history already supply.
- No real-time per-request mood recomputation. Mood is cycle-cached.
- No hard filtering on preferences. The preference summary is advisory in the prompt; the AI is allowed to surface an avoided direction if it explains why this time is different.

## Decisions

### 1. PERSONA.md loading: build-time mirror, not runtime mount

The GitHub Actions runner that builds the image does not have `homelab-docs/` mounted. To keep the image self-contained, this change mirrors `homelab-docs/kevin-ai-persona/PERSONA.md` into the repo as `persona/PERSONA.md` and the Dockerfile `COPY persona/PERSONA.md /app/persona/PERSONA.md` at build time. The initial mirror is committed manually as part of this change; a follow-up backlog item adds an automated sync.

**Alternative considered:** runtime volume mount. Rejected because (a) CI / GitHub Actions runner does not have the path, (b) container-startup ordering becomes a failure mode, (c) PERSONA.md changes are rare enough that the cost of a redeploy is acceptable.

### 2. `persona.ts` is the single composer; three entry points each call it once

Reflection / boost / deliberation each compose their prefix at the start of their main function via `await buildPersonaPrefix(mode, config)` (single-voice) or `await buildCastPrefix(castId, config)` (cast-per-persona). The composed prefix is then concatenated with the existing task-specific system instruction. No call site touches mood or preferences directly — both flow through `persona.ts`.

**Alternative considered:** inline composition at each call site. Rejected — three duplicated copies of the same composition logic.

### 3. `mood.ts` is rule-based, not AI-based

Mood must be computed every observation cycle (5-min cadence by default). Spending one Gemini call per cycle just to label the mood is wasteful and adds latency to the loop. Rules are explicit and debuggable. Initial thresholds are guesses (`backlog_active >= 15`, `backlog_added_24h >= 8`, `seeds_injected_24h >= 3`, `score_avg_24h >= 5`); they are concentrated in `src/mood.ts` so tuning is one PR.

### 4. `preferences.ts` is hybrid by archive count, with throttle on the AI path

`< 10` archived nodes → keyword-frequency count (no AI call, sub-50ms). `>= 10` → Gemini theme abstraction. The Stage B re-derive is throttled to once per 24h regardless of archive frequency, so archiving five nodes in a row triggers at most one Gemini call. Implementation: `preferences.ts` reads `data/preference-cache.json`; if `archivedCount >= 10 && (now - computedAt) >= 24h`, re-derive via Gemini; otherwise reuse the cached themes (or recompute the Stage A keyword list, which is cheap).

### 5. Deliberation switches from `pickRoles` dynamic to 4 fixed cast, with `pickRoles` retained as fallback

The four cast (`engineer` / `designer` / `risk` / `vacation`, all "Kevin") are named in `src/persona.ts`. Each has a `lensSections: string[]` naming the PERSONA.md sections that shape its perspective, and a `characteristicChallenges: string[]` of stances it argues for. `runDeliberation` defaults to: skip `pickRoles`, use the cast as `personas`. If `buildCastPrefix` throws (PERSONA.md missing), `runDeliberation` logs a warning and falls back to the legacy `pickRoles` path so deliberation still produces a result.

The `DeliberationRecord.personas[]` shape is unchanged (still `{ name, perspective }`); only the values populated change.

### 6. Mood compute trigger: end-of-cycle in `observation-loop.ts`

`observation-loop.ts` already runs a coherent unit of work per cycle. After the existing reflection call, append `await computeMood(config).then(persistMoodState).catch(logAndContinue)`. The compute reads from `backlog.ts`, `idea-graph.ts` snapshot, and the deliberations directory. It does not block scheduling of the next cycle — failures are caught and logged.

### 7. Preference compute trigger: post-archive / post-unarchive fire-and-forget

`web.ts` POST `/api/idea/:id/archive` and `/unarchive` handlers fire `void recomputePreferences(config).catch(logAndContinue)` after the persistence succeeds. The function internally honours the 24h throttle on Stage B.

### 8. Token cost is acceptable

PERSONA.md ≈ 1500 tokens. With Gemini 2.5 pricing (~$0.002/MTok input), persona injection adds < $0.003 per cycle. Mood line and preference line each add < 50 tokens. Total < 1700 token overhead per call. Acceptable.

## Risks / Trade-offs

- **PERSONA.md drift between `homelab-docs` and `persona/`** → Mitigation: README documents the manual sync step; a follow-up change automates it.
- **Cast voice collapse** (Gemini flattens four voices into one) → Mitigation: each cast preamble explicitly states the lens sections and challenge stance; synthesis prompt lists each cast's expected contribution.
- **Mood thresholds wrong** → Mitigation: thresholds are in one module and tunable; a follow-up change tunes them after a week of real data.
- **Preference shadow-banning useful ideas** → Mitigation: prompt phrasing allows "if you must propose this, say why this time is different"; preferences are advisory.
- **Token cost growth if PERSONA.md balloons** → Mitigation: revisit if `persona/PERSONA.md` grows past 10 KB or pricing changes.
- **Deliberation latency from `buildCastPrefix` × 4** → `buildCastPrefix` is cheap (string concat + cache reads); the four-cast prompts run in parallel as before. No new latency on the critical path.

## Migration Plan

1. Implement `persona.ts` + `mood.ts` + `preferences.ts` + the `persona/PERSONA.md` mirror.
2. Wire prefix composition into reflection / boost / deliberation.
3. Wire mood compute into observation loop; wire preference recompute into web handlers.
4. Update Dockerfile to `COPY persona/PERSONA.md`.
5. Bump version to 0.17.0; update README + AGENTS.
6. Run `npm test` + `npm run build` green.
7. Commit + push.
8. CI builds and publishes image. Deploy-dev brings `kevin.sisihome.org/health` to `0.17.0`.
9. Manual verification: open `/分身`, inspect a refreshed node's thinking — does it sound like Kevin? Trigger 🧠 深度辯論 — verify four cast names in the record. Inspect `data/mood-state.json` and `data/preference-cache.json` after a cycle.
10. Archive change once verification passes.

**Rollback:** redeploy previous image tag. Persisted state files are forward-compatible (older code ignores them).

## Open Questions

- Should preferences be re-derived on a daily cron in addition to archive triggers, to catch the case where archives are old but the threshold has just been crossed via unarchives? **Decision deferred to follow-up.** For v0.17.0, derive only on archive/unarchive operations. If staleness becomes a problem, add a cron in v0.18.
- Should the cast preamble include past deliberation outcomes ("last time you argued X")? **Out of scope.** Persistent cast memory is a much larger change.
