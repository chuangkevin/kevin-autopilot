# World Problem Radar — Design Spec
**Date:** 2026-05-26
**Status:** Shipped — v1.0.0 deployed 2026-05-26 (commit a69d7ff). Freeze tag `v-autopilot-freeze` preserves the prior Autopilot system.
**Migration target:** kevin-autopilot (approach A: same repo, freeze + rebuild)

---

## 1. Mission

Continuously detect and structure emerging real-world problems from external sources into actionable problem cards. No ranking. No recommendations. No decisions.

## 2. Non-Goals (enforced)

The system must never:

- Recommend or rank problems
- Output "best idea", "top pick", or "today's selection"
- Make decisions on behalf of the user
- Track personal threads or life priorities
- Model cognitive cost or opportunity cost
- Monitor infra/systems as a primary goal
- Cluster or deduplicate signals (Phase 2)

## 3. Data Sources

| Source | Scope | Phase |
|--------|-------|-------|
| Hacker News — Show HN | Top stories | 1 |
| Hacker News — Ask HN | Top stories | 1 |
| HN front page trending | Top 30 | 1 |
| Reddit r/programming | New posts | 1 |
| Reddit r/ExperiencedDevs | New posts | 1 |
| Reddit r/SaaS | New posts | 1 |
| Reddit r/startups | New posts | 1 |
| Manual paste (user input) | Unstructured text | 1 |
| GitHub Issues | Selected repos | 2 |

HN queries: no complex query expansion. Only tag-based fetch (Show HN, Ask HN) + front page.
Reddit: fixed 4 subreddits, no search. Stable signal source, not a search engine.

## 4. Core Pipeline

```
[HN / Reddit / Manual Paste]
         ↓
[Signal Collector]          — fetch raw posts, store as raw_signals
         ↓
[Signal Extractor AI]       — filter noise, identify meaningful pain signals
         ↓
[Problem Structurer AI]     — convert signal → structured problem card
         ↓
[Problem Card Store]        — SQLite: problem_cards + raw_signals
         ↓
[UI Feed Renderer]          — chronological feed, no ranking
```

## 5. Schema

### raw_signals
```sql
CREATE TABLE raw_signals (
  id          TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,   -- 'hacker-news' | 'reddit' | 'manual'
  source_name TEXT NOT NULL,
  title       TEXT NOT NULL,
  snippet     TEXT NOT NULL,
  url         TEXT,
  fetched_at  TEXT NOT NULL,
  processed   INTEGER NOT NULL DEFAULT 0  -- 0=pending, 1=done, 2=skipped
);
```

### problem_cards
```sql
CREATE TABLE problem_cards (
  id                TEXT PRIMARY KEY,
  signal_id         TEXT NOT NULL REFERENCES raw_signals(id),
  who_is_in_pain    TEXT NOT NULL,   -- English, direct from source
  pain              TEXT NOT NULL,   -- Chinese: AI extracted
  context           TEXT NOT NULL,   -- Chinese: when/why this pain occurs
  current_workaround TEXT NOT NULL,  -- Chinese: what people do today
  urgency_signal    TEXT NOT NULL,   -- Chinese: why this is surfacing now
  idea_seeds        TEXT,            -- JSON array of strings, nullable
  source_url        TEXT,
  created_at        TEXT NOT NULL
);
```

## 6. AI Responsibilities

### 6.1 Signal Extractor
- Input: raw signal (title + snippet)
- Output: `{ keep: boolean, reason: string }`
- Rules: keep if signal contains a real person workflow problem. Skip: pure tech discussion, job posts, self-promotion, news without pain.
- No scoring. No ranking. Binary keep/skip.

### 6.2 Problem Structurer
- Input: raw signal text
- Output: `{ who_is_in_pain, pain, context, current_workaround, urgency_signal }`
- Language rule: `who_is_in_pain` in English (matches source); all other fields in Chinese.
- Hard constraint: no judgment, no "this is a good opportunity", no confidence scores.

### 6.3 Idea Seeds Generator (included in Phase 1, simplified)
- Input: problem card fields
- Output: `string[]` — 2–4 exploratory directions
- Rules: unordered list only. No scoring. No "best". No ranking.
- Label in UI: "Possible directions" — not "recommendations".

## 7. Scan Schedule

- **Background scheduler**: every 4 hours by default (configurable via runtime overrides)
- **Manual trigger**: `POST /api/radar/scan` — immediate full scan
- Both paths run the identical pipeline (collect → extract → structure → store)

## 8. UI Spec

### Feed View
- Chronological order (newest first)
- No ranking labels, no scores, no "top" badges
- Each card shows: who / pain / context / workaround / urgency
- Idea Seeds shown below card (collapsible, labeled "Possible directions")
- Manual paste bar at top
- "Scan now" button triggers immediate scan

### Card Layout (text mockup)
```
┌─────────────────────────────────────────────┐
│ [reddit:SaaS]  2026-05-26 14:32            │
│                                             │
│ Who:       Kubernetes developers            │
│ Pain:      部署配置漂移導致隱性錯誤           │
│ Context:   大型系統快速 scaling 時期          │
│ Workaround: 手動 rollback script           │
│ Why now:   團隊規模突破 20 人               │
│                                             │
│ ▾ Possible directions (3)                  │
│   · drift detection system                 │
│   · config versioning tool                 │
│   · auto rollback agent                    │
└─────────────────────────────────────────────┘
```

### Trending Problems (Phase 2)
Deferred. Do not implement in Phase 1.

## 9. Migration Plan (Approach A)

### Step 1 — Freeze
```
git tag v-autopilot-freeze
```

### Step 2 — Delete modules (in this order)
1. `thread-cost.ts` + tests
2. `deliberation.ts`, `problem-deliberation.ts` + tests
3. `patrol.ts`, `patrol.test.ts`
4. `boost.ts`
5. `preferences.ts`
6. `reflection.ts`, `reflection.test.ts`
7. `backlog.ts`, `backlog.test.ts`
8. `agents.ts`, `agents.test.ts`
9. `handoff.ts`, `handoff.test.ts`
10. `git.ts`
11. `observer.ts`, `observer.test.ts`
12. `observation-loop.ts`, `observation-loop.test.ts`
13. `idea-graph.ts`, `idea-graph.test.ts`
14. `idea-quality.ts`
15. `mood.ts`
16. `supplements.ts`, `supplements.test.ts`
17. `persona.ts`
18. `conversation.ts`, `conversation.test.ts`
19. `web-research.ts`, `web-research.test.ts`
20. `graph-positions.ts`, `graph-positions.test.ts`

### Step 3 — Wipe DB schema
Backup existing SQLite file. Wipe and initialize with new schema (`raw_signals` + `problem_cards`).

### Step 4 — Rebuild (in this order)
1. `types.ts` — stripped to ProblemSignal + new ProblemCard types
2. `radar.ts` — new Signal Extractor + Problem Structurer AI pipeline
3. `problem-cards.ts` — DB read/write for new schema
4. Update `external-sources.ts` — adjust HN queries to Show HN / Ask HN / front page only; update Reddit subreddits
5. `web.ts` — rebuild UI: feed view, card renderer, paste bar, scan trigger
6. `index.ts` — wire up scheduler (4-hour interval) + manual scan endpoint

### Step 5 — Tests
- Unit: radar pipeline (extractor + structurer with mocked AI)
- Integration: web server feed endpoint, scan trigger, paste ingest

## 10. Preserved Modules

These survive unchanged:
- `external-sources.ts` (adjusted queries only)
- `keys.ts`, `provider.ts` (AI pool unchanged)
- `settings-store.ts`
- `config.ts`
- `version.ts`
- `runtime-overrides.ts` (add scan interval override)
- `ai.ts` (base AI client)

## 11. Out of Scope (Phase 1)

- Clustering / deduplication
- Embedding similarity
- GitHub Issues source
- Trending problems section
- Tagging system (infra/dev/consumer)
- Idea seed scoring or ranking of any kind

---

**One-sentence definition:**

A radar that continuously surfaces where the world is in pain — structured as cards, never ranked.
