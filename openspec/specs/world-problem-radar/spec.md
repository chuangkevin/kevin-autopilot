# world-problem-radar Specification

## Purpose

A single-user pain-signal radar. The system pulls posts from public discussion sources, lets Kevin paste his own raw observations, runs each through a three-stage AI pipeline (keep-or-skip → structured pain card → idea-direction seeds), and surfaces the resulting cards on one feed in reverse-chronological order.

The radar deliberately **does not score, rank, or recommend**. Idea seeds are unordered alternatives, not a "best pick." The product exists so Kevin sees raw evidence of human pain and chooses what is worth chasing — not so the system decides for him.

## Requirements

### Requirement: Public Signal Ingestion

World Problem Radar SHALL fetch posts from public Hacker News (Show HN, Ask HN via the Algolia API), Reddit (curated subreddit list mixing tech and non-tech everyday-life pain), and Dcard (Taiwan-primary forum, curated forum list), normalize each into a `ProblemSignal`, and deduplicate by a stable hash of `(sourceType, sourceName, title-prefix)`.

The source mix is deliberately weighted to balance against tech-only signals: Taiwan-local Dcard forums are a primary source so the feed reflects ordinary Taiwanese life pain (workplace, money, daily logistics, pets, food), not just English-speaking founder/engineer pain.

#### Scenario: All three sources are fetched in parallel

- **WHEN** a scan starts
- **THEN** World Problem Radar SHALL call the HN, Reddit, and Dcard fetchers concurrently via `Promise.all` and merge their results into a single signal list.

#### Scenario: Dcard short excerpts use combined title + excerpt text

- **WHEN** a Dcard post has a short excerpt (commonly ~70–120 chars)
- **THEN** the fetcher SHALL combine `title + excerpt` as the text used for the 80-character minimum check and as the AI snippet, so posts with short bodies are not dropped and the AI keep/skip stage has enough context.

#### Scenario: One source failing does not block the other

- **WHEN** the HN Algolia API or one subreddit returns a non-OK response, times out, or throws
- **THEN** World Problem Radar SHALL ignore that source's batch and SHALL still return the signals from the surviving source(s).

#### Scenario: Per-source timeout caps wait time

- **WHEN** an upstream source is slow
- **THEN** each per-source fetch SHALL be bounded by an `AbortController` timeout (default 10 seconds) so one slow source cannot stall the whole scan.

#### Scenario: HTML and entities are stripped from snippets

- **WHEN** an HN hit contains HTML tags or escaped entities in `story_text` or `comment_text`
- **THEN** World Problem Radar SHALL strip tags and decode common entities (`&amp;`, `&lt;`, `&gt;`, `&quot;`, `&#x27;`, numeric refs) before storing the snippet, and SHALL truncate snippets to 1200 characters.

#### Scenario: Short or empty posts are dropped pre-AI

- **WHEN** the cleaned snippet is shorter than 80 characters, or the title is empty
- **THEN** World Problem Radar SHALL discard the signal without calling AI on it.

### Requirement: Manual Signal Ingestion

World Problem Radar SHALL accept Kevin-pasted text via `POST /api/radar/paste`, convert it into a `ProblemSignal` with `sourceType = 'manual'`, and feed it through the same pipeline as external signals.

#### Scenario: Manual paste enters the same pipeline

- **WHEN** Kevin posts text to `/api/radar/paste`
- **THEN** World Problem Radar SHALL store the signal under the same `raw_signals` table and run the same three-stage AI extraction.

### Requirement: Three-Stage AI Pipeline

For each pending signal, World Problem Radar SHALL run three independent AI stages — keep/skip classification, structured card extraction, idea-seed generation — each with its own prompt, timeout, and token budget.

#### Scenario: Skip stage discards non-pain posts

- **WHEN** the extract-stage classifier returns `{"keep": false}` (or fails to parse)
- **THEN** the signal SHALL be marked `processed = 2 (skipped)` and the pipeline SHALL move to the next signal without invoking later stages.

#### Scenario: Structure stage extracts a fixed schema

- **WHEN** a signal passes the keep stage
- **THEN** the structure stage SHALL request JSON with keys `who_is_in_pain` (English), `pain`, `context`, `current_workaround`, `urgency_signal` (Traditional Chinese), and SHALL discard the signal if `who_is_in_pain` or `pain` is missing.

#### Scenario: Token budgets must not truncate JSON

- **WHEN** an AI stage is configured
- **THEN** its `maxOutputTokens` SHALL be large enough to fit the JSON body plus any ```json fence the model wraps it in (current floors: extract 256, structure 1024, seeds 1024). Token budgets are constants and SHALL NOT be reduced below those floors.

#### Scenario: Stage failure does not crash the scan

- **WHEN** any single stage throws, times out, or returns unparseable text
- **THEN** the radar SHALL catch the error, mark the signal `skipped`, log nothing user-facing, and continue with the next signal.

### Requirement: Strict No-Ranking

World Problem Radar SHALL NOT compute, store, or display scores, priorities, "best" picks, urgency rankings, or quality sorts on problem cards. Idea seeds SHALL be unordered alternatives.

#### Scenario: Idea seeds are bounded and unordered

- **WHEN** the seeds stage returns
- **THEN** World Problem Radar SHALL keep at most 4 string entries and SHALL preserve the model's emitted order without re-sorting.

#### Scenario: Card list is purely chronological

- **WHEN** `GET /api/radar/cards` or the `/` feed renders cards
- **THEN** the cards SHALL be ordered by `created_at DESC` and the response SHALL NOT include any score, priority, or rank field.

### Requirement: Persistent Card Storage

World Problem Radar SHALL persist signals and cards in a SQLite database at `${dataDir}/radar.db`, using two tables: `raw_signals` and `problem_cards`.

#### Scenario: raw_signals tracks processing state

- **WHEN** a new signal is ingested
- **THEN** it SHALL be inserted with `processed = 0`; after the pipeline completes it SHALL be updated to `1` (card produced) or `2` (skipped).

#### Scenario: problem_cards stores the full structured pain card

- **WHEN** a card is inserted
- **THEN** the row SHALL contain `id`, `signal_id`, `who_is_in_pain`, `pain`, `context`, `current_workaround`, `urgency_signal`, `idea_seeds` (JSON-encoded string array), optional `source_url`, and `created_at`.

#### Scenario: Re-inserting the same signal is idempotent

- **WHEN** a scan re-encounters an already-stored signal id
- **THEN** the upsert SHALL be `INSERT OR IGNORE` on `raw_signals`, and the same signal SHALL NOT produce a duplicate card.

### Requirement: Background and Manual Scans

World Problem Radar SHALL run one scan at process startup and a recurring scan on an interval (default 4 hours), and SHALL expose `POST /api/radar/scan` to trigger an on-demand scan.

#### Scenario: Startup scan runs once immediately

- **WHEN** the process starts
- **THEN** `runScan` SHALL be invoked once before `setInterval` schedules the recurring cadence.

#### Scenario: Interval is overridable at runtime

- **WHEN** `radarScan.intervalMs` is set via runtime overrides (within 60_000–86_400_000 ms)
- **THEN** the effective scan cadence SHALL use the override value on the next process start, picked up by `getEffectiveConfig`.

### Requirement: AI Provider Routing

World Problem Radar SHALL prefer OpenCode when configured, fall back to a Gemini API-key pool, and SHALL run the no-AI path (ingest signals only, mark all skipped) when neither is available.

#### Scenario: OpenCode beats Gemini when both are present

- **WHEN** `hasOpenCodeEnv(config)` is true (servers configured via settings store or env)
- **THEN** the radar SHALL route AI calls through the OpenCode provider rather than the Gemini key pool.

#### Scenario: Gemini key pool rotates on 429

- **WHEN** the Gemini provider receives a quota error from one key
- **THEN** the provider SHALL transparently rotate to the next available key in the pool, without surfacing the error to the pipeline.

#### Scenario: No provider available still stores raw signals

- **WHEN** `config.ai.enabled` is false, or neither OpenCode nor Gemini keys are configured
- **THEN** the radar SHALL still upsert raw signals into `raw_signals` and mark each one `skipped`, so the database reflects what was seen even when no AI ran.

### Requirement: Web Feed Surface

World Problem Radar SHALL render the live card feed at `GET /`, a settings page at `GET /settings`, and a card JSON API at `GET /api/radar/cards`. The web server SHALL bind to the port given by the `PORT` env var (default 3023).

#### Scenario: Health endpoint exists

- **WHEN** any caller hits `GET /health`
- **THEN** the server SHALL return 200 with a JSON status payload, independent of AI availability.

#### Scenario: Settings page configures keys, OpenCode, and scan

- **WHEN** Kevin opens `GET /settings`
- **THEN** the page SHALL expose forms backed by `/api/keys/*`, `/api/settings/opencode*`, and `/api/runtime-overrides` so AI provider, OpenCode servers, and scan interval can be configured without editing files or restarting the container.
