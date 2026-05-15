# Persona Injection — Kevin Voice + Cast + Mood + Preferences

Date: 2026-05-15
Status: Draft (awaiting user review)
Target version: v0.17.0

## Problem

The 分身 framing is everywhere in `kevin-autopilot` (the center node is "Kevin Autopilot", `/分身` tab, deliberation prose all say "分身正在想…"), but the actual AI behind it speaks generic-analyst voice. `kevin-ai-persona/PERSONA.md` exists in `homelab-docs` and describes Kevin's working style in detail — priorities, problem-solving pattern, autonomy rules, debugging order, dislikes, reporting style — but no code path loads it. Reflection writes "提升使用者體驗並降低處理時間" instead of "別碰 worker pool，那是 overengineer，先讓 status 露出來".

Three follow-on gaps:
1. Deliberation personas are picked dynamically per run; they have no persistent identity, no stance accumulation across runs, no continuity Kevin would recognise.
2. The system has no mood state — `excitementMode` flips on the latest cycle score, but does not reflect backlog pressure, recent archive cadence, or seed cadence across a longer window.
3. Archive (`先不要想`) is a one-way hide; nothing learns from it. The double will keep suggesting ideas in directions Kevin has already rejected.

## Goals

- Every AI call (reflection, boost, deliberation) speaks with Kevin's voice — same priorities, same dislikes, same report shape as in `PERSONA.md`.
- Deliberation uses four fixed cast members (工程師 / 設計師 / 風險 / 休假 Kevin) instead of dynamically-picked personas, so Kevin recognises consistent voices across runs.
- The double carries a `mood` state computed from recent observation signals; mood influences prompt tone (cast volume in deliberation; speaking energy in reflection / boost).
- The double avoids directions Kevin has archived, derived automatically from the frozen vault.
- All four pieces compose into a single `system instruction` prefix produced by one module (`src/persona.ts`) and reused by the three AI entry points.

## Non-goals

- No edit to `PERSONA.md` content. It lives in `homelab-docs` and is the source of truth.
- No multi-user persona scoping; this is Kevin's machine.
- No personality memory beyond what `archive` + observation history already imply. No long-form emotional state, no episodic memory.
- No model fine-tuning. Pure prompt engineering.
- No real-time mood re-computation per request. Mood is cached per cycle.
- No automatic preference override. Kevin can always ask the double to consider a direction it has been avoiding — the preference summary is advisory in the prompt, not a hard filter.

## Architecture

```
                 PERSONA.md  (build-time copy into image at /app/persona/PERSONA.md)
                     │
                     ▼
src/persona.ts ── loadPersonaPrefix()
       ▲              │
       │              ├─ readMoodState(config)        ← src/mood.ts ← observation history + backlog + idea-graph
       │              └─ readPreferences(config)      ← src/preferences.ts ← idea-graph archived nodes
       │
   ┌───┴────────────────────────────────┐
   │                                     │
reflection.ts    boost.ts      deliberation.ts
(single Kevin)  (single Kevin) (4-cast deliberation)
```

- **`src/persona.ts`** owns prompt-prefix composition. Two public functions:
  - `buildPersonaPrefix(mode: 'reflection' | 'boost', config): Promise<string>` — single-voice prefix
  - `buildCastPrefix(castId: CastId, config): Promise<string>` — per-cast prefix for deliberation
- **`src/mood.ts`** computes mood label + signals from existing sources. Cached at `data/mood-state.json`. Recomputed at end of every observation cycle. Reads only.
- **`src/preferences.ts`** computes preferences from archived nodes. Cached at `data/preference-cache.json`. Recomputed asynchronously after each archive operation, with a 24h throttle on the AI-abstraction code path.

PERSONA.md is copied into the image at build time:
- `homelab-docs/kevin-ai-persona/PERSONA.md` → mirrored into this repo's `persona/PERSONA.md`
- Dockerfile `COPY persona/PERSONA.md /app/persona/PERSONA.md`
- An out-of-band sync script (not in this change) keeps the two in step. For v0.17.0 the initial copy is committed manually.

## The 4-Cast Deliberation

Each cast member is a fixed identity. Their `name` and `perspective` never change across runs. Each cast member's `system instruction` carries the full `PERSONA.md` plus a "your slice" preamble that names which sections of `PERSONA.md` shape their lens.

| Cast | Lens (slice of PERSONA.md) | Characteristic challenges |
|---|---|---|
| 🔧 工程師 Kevin | Engineering Style; Default Pattern §4 (smallest runnable prototype); Autonomy "may proceed without asking" | "still not runnable — stop arguing architecture"; "over-abstracted" |
| 🎨 設計師 Kevin | Core Priority 1 (UX); Default Pattern §5 (user reacts to real artifact); Things Kevin Dislikes §5 (breaking existing behavior); Autonomy "must ask first" §1 (changing user flows) | "this breaks an existing user habit"; "the flow is interrupted" |
| ⚠️ 風險 Kevin | Core Priority 2 + 3 (stability, verifiability); Autonomy "must ask first" §2/§3/§5/§6 (data, deploy, secrets, cost, API contract); Debugging Order; Boundary | "no verification yet"; "this touches deploy/secrets"; "API contract break" |
| 🛋 休假 Kevin | Default Pattern §1/§2 (real pain, actual workflow); all of Things Kevin Dislikes; Example Decision Pattern §4 (living world, not shell) | "will Kevin actually keep using this?"; "is this a symptom of overengineering?"; "does the pain even exist?" |

Deliberation flow change:
- `runDeliberation` no longer calls `pickRoles` by default. It uses the four fixed cast as `personas`.
- `pickRoles` is retained as a fallback when persona loading fails (PERSONA.md missing, parse error). On fallback, deliberation logs a warning and continues with the legacy dynamic-pick behavior.
- The four cast all run round 0 → round 1 → round 2 → synthesis as before.
- `DeliberationRecord.personas` becomes the four-cast names instead of the dynamically-picked ones; this is a small persisted-shape change but the schema is unchanged.
- The deliberation's enriched anchor (from v0.16.0 boost step 0) is still threaded into each cast's prompt.

## Mood

### Labels
- `excited` — system has produced things worth accelerating on
- `flow` — steady recent progress, nothing urgent
- `tense` — backlog or recent archive pressure; tone down ambition
- `idle` — no recent activity

### Signal sources (24h window)
Pulled from existing persistence, no new telemetry:

| Signal | Source | Description |
|---|---|---|
| `score_avg_24h` | `ObservationLoopState.lastExcitementScore` across recent cycles | average excitement score |
| `backlog_active_count` | `backlog.ts` listBacklog status=active | open backlog items |
| `backlog_added_24h` | backlog table `created_at` within 24h | new backlog this day |
| `archive_added_24h` | idea-graph nodes with `archivedAt` within 24h | recent freezes |
| `seeds_injected_24h` | `data/deliberations/*.json` synthesis.seedsInjected sum | recent deliberation output |
| `nodes_added_24h` | idea-graph nodes with `createdAt` within 24h | newly-grown thoughts |

### Decision rule (deterministic, no AI)
First match wins:

```ts
if (backlog_active_count >= 15 || backlog_added_24h >= 8) return 'tense'
if (seeds_injected_24h >= 3 || score_avg_24h >= 5)        return 'excited'
if (nodes_added_24h === 0 && backlog_added_24h === 0)     return 'idle'
return 'flow'
```

Initial thresholds are guesses. A follow-up change tunes them after ~1 week of real data.

### Prompt phrasing
Each mood maps to one line that goes into the system instruction:

- `excited`: 「最近系統有不少進展（新節點、新 seed），可以比較大膽提案。」
- `flow`: 「穩定推進中。維持平常標準。」
- `tense`: 「背景 backlog 累積較多，請優先建議壓力釋放方向，避免追加複雜度。」
- `idle`: 「最近沒新動靜。可以提案，但別硬推。」

In deliberation, the line additionally suggests which cast "speaks louder", e.g. `tense` → "讓 ⚠️ 風險 Kevin 的觀點佔比重一點"; `excited` → "讓 🔧 工程師 Kevin 比較主導"; `idle` → "讓 🛋 休假 Kevin 多發言"; `flow` → equal weight.

### Persistence and timing
- `data/mood-state.json`: `{ mood, computedAt, signals }`
- Recomputed at end of every observation cycle (5 min cadence by default)
- Boost and deliberation read the cached file; they do not recompute

## Preferences (Archive-derived)

Two-stage strategy by archived count:

### Stage A: `< 10` archived nodes — keyword frequency
```ts
const allKeywords = archivedNodes.flatMap(n => n.keywords)
const counts = countBy(allKeywords)
const top = top10ByCount(counts)
preferences = {
  mode: 'keywords',
  avoid: top.map(([kw]) => kw),
  summary: `Kevin 最近冷凍的方向包含：${top.slice(0,5).map(([k,c]) => `${k}(${c})`).join(', ')}`,
}
```
No Gemini call. Sub-50ms.

### Stage B: `>= 10` archived nodes — AI theme abstraction
```ts
const themes = await callGemini(
  '把以下被使用者冷凍的想法總結成 3-5 個主題（不是關鍵字，而是抽象方向）。' +
  '只輸出 minified JSON，不要 Markdown，不要說明文字。',
  JSON.stringify(archivedNodes.map(n => ({ title: n.title, summary: n.summary, keywords: n.keywords })))
)
preferences = {
  mode: 'themes',
  avoid: themes,
  summary: `Kevin 不喜歡的方向：${themes.join('、')}`,
}
```
Throttled to once per 24h regardless of archive frequency, so archiving 5 nodes in a row triggers at most one re-derive.

### Trigger and cache
- After every successful `POST /api/idea/:id/archive`, fire-and-forget recompute (respecting throttle)
- After every successful `POST /api/idea/:id/unarchive`, fire-and-forget recompute (the unarchived node's keywords no longer count)
- On startup, read cached `data/preference-cache.json`; if missing, compute synchronously once at boot

### Prompt phrasing
All three entry points get one line inside the persona prefix:

```
最近你（Kevin）冷凍的方向：{preferences.summary}
產生新 idea / seed / thinking 時，避開這些方向；如果非提不可，明說「這次跟之前不同的理由是 X」。
```

### Persistence
`data/preference-cache.json`:
```json
{
  "mode": "keywords",
  "avoid": ["auto-deploy", "chrome-extension", "kubernetes"],
  "summary": "Kevin 最近冷凍的方向包含：auto-deploy(3), chrome-extension(2), kubernetes(2)",
  "computedAt": "2026-05-15T12:34:56Z",
  "archivedCount": 7
}
```

## System Instruction Composition

`buildPersonaPrefix(mode, config)` returns a string of this shape:

```
你是 Kevin 的 AI 分身。以下是 Kevin 的工作風格與決策原則：
<PERSONA.md full content>

目前狀態：mood = {label}（{one_line_description}）
最近你避開的方向：{preferences.summary}

—— 下面是這次任務 ——
```

`buildCastPrefix(castId, config)` is similar but inserts the cast's identity preamble before PERSONA.md and the cast-specific lens lines after, and uses the deliberation mood line instead of the general one:

```
你是「{cast.displayName}」——Kevin 的內在 {cast.faction} 面向。
你的視角來自 Kevin 工作風格的這些章節：{cast.lensSections.join(', ')}
你會挑戰：{cast.characteristicChallenges.join(' / ')}

下面是 Kevin 的完整工作風格（你和其他三位分身共享同一份原版）：
<PERSONA.md full content>

目前狀態：mood = {label}（{deliberation_mood_line}）
最近你避開的方向：{preferences.summary}

—— 下面是這次任務 ——
```

The original task-specific system instruction (e.g. "你是辯論協調員…" from `pickRoles`) is concatenated after this prefix.

## Token cost

PERSONA.md ≈ 5 KB ≈ 1500 tokens. Every AI call pays this once. With Gemini 2.5's 1M+ context window and ~$0.002/MTok input pricing, persona injection adds <$0.003 per cycle. Acceptable.

## Failure modes

| Failure | Behavior |
|---|---|
| `persona/PERSONA.md` missing at startup | Log error; `buildPersonaPrefix` returns minimal stub `"你是 Kevin 的分身。"`; deliberation falls back to dynamic `pickRoles` |
| `data/mood-state.json` missing | Treat mood as `flow` (default) |
| `data/preference-cache.json` missing | Compute synchronously at first call; if archived count is 0, return empty preferences |
| Mood compute throws | Catch and return `flow`; log warning |
| Preferences AI call fails (stage B) | Fall back to stage A keyword frequency for this cycle; do not block the consuming AI call |

## Version

Bump `src/version.ts`, `package.json`, `package-lock.json`, `.github/workflows/deploy-dev.yml` `EXPECTED_APP_VERSION` to `0.17.0`. README + AGENTS get v0.17.0 entry.

## Rollout

OpenSpec change `add-persona-injection` will be created from this design. Implementation follows `openspec-apply-change`. After deploy-dev green at `kevin.sisihome.org/health=0.17.0`, manual verification:

1. Open `/分身` tab, observe a refreshed node's thinking section — does it read like Kevin, not like a generic AI?
2. Trigger 🧠 深度辯論 on a non-center node — verify the four cast names appear in the deliberation record, in order.
3. Inspect `data/mood-state.json` after a cycle completes — mood label and signals present.
4. Archive a node, wait ~30 s, inspect `data/preference-cache.json` — preferences updated.

## Risks

- **PERSONA.md drift between homelab-docs and repo**. The Dockerfile copies from the repo's `persona/PERSONA.md` because the build runner does not have the homelab-docs path. Mitigation: a sync script (out of scope here, tracked as a follow-up backlog item) keeps them aligned; the README documents the manual sync step for v0.17.0.
- **Cast voice collapse**. Gemini may flatten all four cast voices into one tone, defeating the point. Mitigation: each cast's preamble is distinct and the synthesis prompt explicitly lists each cast's expected challenge stance; if voices still collapse, a follow-up change tightens the cast prompts.
- **Mood thresholds wrong**. Initial numbers are guesses. Mitigation: thresholds are in one module (`src/mood.ts`) and tunable; a follow-up tunes them after a week of real data.
- **Preference shadow-banning real ideas**. The double might refuse to surface useful directions because they share keywords with archived ones. Mitigation: prompt explicitly allows "if you must propose this, say why this time is different" — preferences are advisory, not a filter.
- **Token cost growth**. Every AI call adds ~1500 tokens. Acceptable now; if PERSONA.md grows past ~10KB or Gemini pricing changes, revisit.

## Dependencies

- v0.16.0 archive infrastructure (`archivedAt`, `listArchivedNodes`) ships first. This change targets v0.17.0 and depends on v0.16.0 being archived in OpenSpec.
