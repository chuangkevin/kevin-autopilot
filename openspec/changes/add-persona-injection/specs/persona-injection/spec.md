## ADDED Requirements

### Requirement: Persona Source Of Truth Is Bundled With The Image

Kevin Autopilot SHALL bundle a copy of `kevin-ai-persona/PERSONA.md` into the image at `/app/persona/PERSONA.md` at build time, sourced from the repository's `persona/PERSONA.md`.

#### Scenario: Image build copies persona

- **WHEN** the Docker image is built
- **THEN** the resulting image SHALL contain `/app/persona/PERSONA.md` with the contents of `persona/PERSONA.md` at the point the image was built.

#### Scenario: Persona file missing at startup

- **WHEN** the runtime cannot read `/app/persona/PERSONA.md` at startup
- **THEN** Kevin Autopilot SHALL log a warning, `buildPersonaPrefix` and `buildCastPrefix` SHALL return a minimal stub (`"你是 Kevin 的分身。"`), and `runDeliberation` SHALL fall back to the legacy `pickRoles` dynamic-persona path.

### Requirement: Single-Voice Persona Prefix Composition

Kevin Autopilot SHALL provide `buildPersonaPrefix(mode, config)` that returns a system-instruction prefix containing the full PERSONA.md content, the current mood line, the current preference summary, and a trailing delimiter that separates the prefix from the task-specific instruction concatenated by the caller.

#### Scenario: Prefix includes all four components

- **WHEN** `buildPersonaPrefix('reflection', config)` is called with a present PERSONA.md, a present `data/mood-state.json`, and a present `data/preference-cache.json`
- **THEN** the returned string SHALL contain the PERSONA.md content verbatim, the mood line corresponding to the cached mood label, the preference summary string, and the delimiter `"—— 下面是這次任務 ——"` exactly once at the end.

#### Scenario: Mood state missing

- **WHEN** `data/mood-state.json` is missing or unreadable
- **THEN** the returned prefix SHALL use the `flow` mood line (default), and no error SHALL be thrown.

#### Scenario: Preferences missing

- **WHEN** `data/preference-cache.json` is missing or unreadable
- **THEN** the returned prefix SHALL include the line `"最近你（Kevin）冷凍的方向：（尚無紀錄）"`, and no error SHALL be thrown.

### Requirement: Four-Cast Persona Prefix Composition

Kevin Autopilot SHALL provide `buildCastPrefix(castId, config)` for the four cast members `engineer`, `designer`, `risk`, `vacation`. The returned string SHALL include a cast-identity preamble naming the cast's display name, lens sections, and characteristic challenges, followed by the full PERSONA.md content, followed by the deliberation-mood line that names which cast should speak louder, followed by the preference summary, followed by the delimiter.

#### Scenario: Each cast has distinct identity preamble

- **WHEN** `buildCastPrefix(castId, config)` is called for each of the four `castId` values
- **THEN** each returned string SHALL include a different display name (工程師 Kevin / 設計師 Kevin / 風險 Kevin / 休假 Kevin), a different list of `lensSections`, and a different list of `characteristicChallenges`.

#### Scenario: Unknown cast id rejected

- **WHEN** `buildCastPrefix(castId, config)` is called with a `castId` that is not one of the four
- **THEN** the function SHALL throw an `Error` containing the unknown id; callers are expected to catch and either retry with a valid id or use `buildPersonaPrefix` instead.

### Requirement: Mood State Computed Per Cycle From Existing Signals

Kevin Autopilot SHALL compute mood at the end of every successful observation cycle. The compute SHALL read only from existing persistence (backlog database, idea-graph snapshot, deliberation records directory, observation loop state) and SHALL NOT introduce new telemetry. The resulting `{ mood, computedAt, signals }` SHALL be persisted to `data/mood-state.json`.

#### Scenario: Recompute at end of cycle

- **WHEN** an observation cycle finishes (after the AI reflection call)
- **THEN** Kevin Autopilot SHALL call `computeMood(config)`, persist the result to `data/mood-state.json`, and continue scheduling the next cycle without blocking.

#### Scenario: Mood compute failure is non-fatal

- **WHEN** `computeMood` throws or its persistence write fails
- **THEN** Kevin Autopilot SHALL log a warning, the previous `data/mood-state.json` (if any) SHALL remain, and the observation cycle SHALL still be marked successful.

#### Scenario: Deterministic rule

- **WHEN** signals (`score_avg_24h`, `backlog_active_count`, `backlog_added_24h`, `archive_added_24h`, `seeds_injected_24h`, `nodes_added_24h`) are read into `computeMood`
- **THEN** the returned `mood` SHALL be determined by this priority:
  1. `tense` if `backlog_active_count >= 15` OR `backlog_added_24h >= 8`
  2. `excited` if `seeds_injected_24h >= 3` OR `score_avg_24h >= 5`
  3. `idle` if `nodes_added_24h === 0` AND `backlog_added_24h === 0`
  4. `flow` otherwise

### Requirement: Preferences Derived From Archive

Kevin Autopilot SHALL maintain `data/preference-cache.json` summarising directions Kevin has frozen via the archive operation. The summary SHALL be derived from `listArchivedNodes`. When fewer than 10 nodes are archived, the derivation SHALL use deterministic keyword-frequency counting; when 10 or more are archived, the derivation SHALL call Gemini to abstract themes, but SHALL NOT call Gemini more than once per 24 hours regardless of archive frequency.

#### Scenario: Stage A — keyword frequency below threshold

- **WHEN** `archivedCount < 10` and `recomputePreferences` is called
- **THEN** Kevin Autopilot SHALL compute the top-10 keyword frequencies from `listArchivedNodes`, write `mode: 'keywords'` to the cache, and set the `summary` to "Kevin 最近冷凍的方向包含：" followed by the top-5 entries in `keyword(count)` form.

#### Scenario: Stage B — AI theme abstraction at or above threshold

- **WHEN** `archivedCount >= 10` and the last `data/preference-cache.json` `computedAt` is at least 24h old (or the cache is empty)
- **THEN** Kevin Autopilot SHALL call Gemini with the archived nodes (title + summary + keywords) and the system instruction "把以下被使用者冷凍的想法總結成 3-5 個主題", parse the response as a string array, write `mode: 'themes'` to the cache, and set the `summary` to "Kevin 不喜歡的方向：" followed by the themes joined with `、`.

#### Scenario: Stage B throttled

- **WHEN** `archivedCount >= 10` but the cache is younger than 24h
- **THEN** Kevin Autopilot SHALL skip the Gemini call, MAY recompute the Stage A keyword list as a low-cost refresh, and SHALL leave the existing themes in place.

#### Scenario: Stage B failure falls back to Stage A

- **WHEN** the Gemini call in Stage B fails (timeout, invalid JSON, key exhaustion)
- **THEN** Kevin Autopilot SHALL log a warning and write the Stage A keyword-frequency result to the cache for this cycle, so consumers still receive a usable preference summary.

#### Scenario: Trigger on archive

- **WHEN** `POST /api/idea/:id/archive` succeeds
- **THEN** Kevin Autopilot SHALL fire `recomputePreferences(config)` asynchronously and SHALL NOT block the HTTP response on its completion.

#### Scenario: Trigger on unarchive

- **WHEN** `POST /api/idea/:id/unarchive` succeeds
- **THEN** Kevin Autopilot SHALL fire `recomputePreferences(config)` asynchronously and SHALL NOT block the HTTP response on its completion.
