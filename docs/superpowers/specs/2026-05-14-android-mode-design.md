# 仿生人模式 — Adaptive Timer + Cyberpunk Neural UI

**Date:** 2026-05-14
**Target version:** 0.13.0
**OpenSpec change:** `android-mode`

---

## Goal

Make Kevin Autopilot feel like a living digital twin — self-directing its own thinking rhythm and presenting its neural state through a cyberpunk UI that makes connections between ideas visible like a real brain.

Two coordinated changes ship together as v0.13.0:
1. **Adaptive Timer** — the system shortens its own reflection interval when it detects interesting signals, then gradually anneals back to normal
2. **Cyberpunk Neural UI** — full mobile-first redesign with bottom tab bar, neural graph as a first-class brain visualization, and a cyberpunk aesthetic

---

## Part 1: Adaptive Timer

### Excitement Signals

After each observation cycle, the loop scores three signal types:

| Signal | How detected |
|--------|-------------|
| `newSeedCount` | Count of new AI idea seeds emitted by `reflect()` this cycle |
| `newInterestingNodes` | Count of graph nodes whose `interesting` flag is newly `true` vs. last cycle snapshot |
| `backlogSpikes` | Count of backlog items whose `seen_count` increased by ≥ 3 since last cycle snapshot |

`excitementScore = newSeedCount + newInterestingNodes + backlogSpikes`

### Interval Scheduling

```
MIN_INTERVAL_MS = 60_000          // 1 minute
baseIntervalMs  = config.backgroundObservation.intervalMs ?? 300_000

After each cycle:
  if excitementScore > 0:
    currentIntervalMs = MIN_INTERVAL_MS
  else:
    currentIntervalMs = min(currentIntervalMs × 2, baseIntervalMs)

setTimeout(runOnce, currentIntervalMs)
```

Annealing example with base = 5 min:
- Cycle with score=2 → next in **1 min**
- Cycle with score=0 → next in **2 min**
- Cycle with score=0 → next in **4 min**
- Cycle with score=0 → next in **5 min** (normal)

### Cross-Cycle State (in-memory only, no file writes)

- `currentIntervalMs: number` — starts at `baseIntervalMs`
- `lastInterestingNodeIds: Set<string>` — snapshot after each cycle
- `lastBacklogSeenCounts: Map<string, number>` — snapshot after each cycle

### ObservationLoopState New Fields

```ts
currentIntervalMs: number      // current adaptive interval
baseIntervalMs: number         // from config
lastExcitementScore: number    // last cycle score
excitementMode: 'excited' | 'cooling' | 'normal'
```

- `excited`: `currentIntervalMs === MIN_INTERVAL_MS`
- `cooling`: `MIN_INTERVAL_MS < currentIntervalMs < baseIntervalMs`
- `normal`: `currentIntervalMs === baseIntervalMs`

### Files Changed

- `src/observation-loop.ts` — cross-cycle state, score computation, adaptive `scheduleNextRun`
- `src/types.ts` — new fields on `ObservationLoopState`
- `src/observation-loop.test.ts` — excited/cooling/normal scheduling tests

---

## Part 2: Cyberpunk Neural UI

### Design Language

- **Background:** near-black `#050505` with subtle scanline overlay (`repeating-linear-gradient`)
- **Primary accent:** `#00ffff` (cyan) — active nodes, selected state, titles
- **Secondary accent:** `#ff00ff` (magenta) — high-importance / core concept nodes, interesting flag
- **Warning:** `#ef4444` (red glow) — bug_watch backlog items
- **Dim accent:** `#f59e0b` (amber) — improvement candidates
- **Typography:** `'Courier New', monospace` throughout — terminal aesthetic
- **Glow effects:** SVG `filter` with `feGaussianBlur` for node halos; CSS `text-shadow` for labels

### Navigation: Bottom Tab Bar

Fixed 4-tab bottom bar. No page scrolling between sections — each tab is a full viewport view.

| Tab | Icon | Content |
|-----|------|---------|
| 分身 | 🧠 | Brain state card (excited/cooling/normal), last reflection output, recent signals |
| Backlog | 📋 | Active backlog items sorted by seen_count, snooze/dismiss actions |
| 圖 | 🕸 | Neural Cockpit graph (full viewport), selected-node drawer at bottom |
| 想法 | ✏️ | Large idea input textarea, submit button, recent ideas list |

Active tab: cyan glow text. Inactive: `rgba(255,255,255,0.2)`.

### 分身 Tab

**Excited state card:**
- `sys-label`: `/// Neural Status` (cyan, small caps)
- `mode-text`: `⚡ EXCITED` (large, cyan glow)
- `mode-sub`: `next cycle: MM:SS` (magenta glow countdown)
- Stats row: INTERVAL / SCORE / RUNS in bordered boxes
- Seeds box: `/// Last Output` with idea seed lines prefixed by `›` (magenta)
- Signals list: recent events (⭐ interesting marked, 📈 backlog spike) with timestamps

**Normal state:** same layout but dims to `#334155` with no glow. Shows "no new signals" placeholder.

### Backlog Tab

- Filter pills: 活躍 / 暫緩 / 已解決 (cyan active state)
- Each item: left colored border (red=bug_watch, amber=improvement, dim=low), title, meta line (`出現 N 次 · kind`), inline snooze/dismiss buttons in monospace style
- No table layout — card list, full width

### 圖 Tab (Neural Brain View)

**Graph canvas:** full-height SVG with:
- Subtle background grid (`rgba(0,255,255,0.04)`)
- Scanline overlay (inherited from phone wrapper)
- Node types:
  - **Core/interesting:** magenta stroke + glow, larger radius (r=14)
  - **Active idea:** cyan stroke + glow, medium radius (r=11–12)
  - **Weak/dim:** `rgba(255,255,255,0.2)` stroke, small radius (r=8–10)
  - **Bug:** `rgba(239,68,68,0.3)` stroke, warning icon
- Edge types:
  - **Strong link** (AI-inferred): solid cyan line, `filter: glow-cyan`
  - **Weak link** (keyword similarity): dashed `stroke-dasharray="4,3"`, low opacity
- Selected node: animated pulsing ring (`animate` on radius + opacity), cyan halo

**Selected-node drawer** (bottom of tab, above tab bar):
- Node title in cyan
- Connection summary line
- Action buttons: `⭐ interesting` (magenta), `複製 prompt`, `延伸思考`

### 想法 Tab

- Large `<textarea>` with cyan border focus glow, monospace font, placeholder in dim cyan
- Submit button: outlined cyan style, text `[ TRANSMIT ]`, glow on hover
- Recent ideas list below: name + status in small monospace

### Desktop Layout

On viewport width ≥ 768px: remove bottom tab bar. Show a sidebar layout:
- Left column (260px): 分身 state card + recent signals
- Center column (flex): Neural Cockpit graph (full height)
- Right panel (280px, collapsible): Backlog + Idea input stacked

The bottom tab bar is mobile-only (`@media (max-width: 767px)`).

### Files Changed

- `src/web.ts` — full rewrite of `renderDashboard`, new `renderBrainTab`, `renderBacklogTab`, `renderGraphTab`, `renderIdeaTab`; new CSS design system (variables for colors/glows); bottom tab bar JS for tab switching; existing graph renderer refactored into `renderGraphTab`
- `src/web.test.ts` — update HTML assertions for new structure

---

## What Does NOT Change

- All existing API endpoints and their response shapes
- `src/observation-loop.ts` observation logic (only scheduling changes)
- `src/reflection.ts` — untouched
- Docker, CI/CD, config files
- Settings page (`/settings`) — keeps existing layout for now

---

## Version Bump

- `src/version.ts`, `package.json`, `package-lock.json` → `0.13.0`
- `.github/workflows/deploy-dev.yml` `EXPECTED_APP_VERSION` → `0.13.0`
- `README.md`, `AGENTS.md` — v0.13.0 entry

---

## Testing

1. Adaptive Timer:
   - Unit: score=0 doubles interval up to base; score>0 resets to MIN
   - Unit: `excitementMode` reflects correct state
   - Integration: reflection producing seeds causes next schedule < base

2. UI:
   - Visual: open on mobile viewport, confirm bottom tab bar is visible and switching works
   - Visual: 圖 tab shows SVG graph with glowing nodes and edges
   - Visual: 分身 tab shows excited state card when `excitementMode === 'excited'`
   - Regression: existing API endpoints return same shape

---

## Spec Constraints

- `currentIntervalMs` must never go below `MIN_INTERVAL_MS` (60s) regardless of runtime overrides
- Excitement score is computed only from cycle outputs, never from external HTTP calls or file reads outside the normal cycle path
- The UI tab switching is client-side JS only — no new API endpoints for tab state
- Graph SVG layout algorithm stays the same (existing force-directed or fixed); only visual style changes
