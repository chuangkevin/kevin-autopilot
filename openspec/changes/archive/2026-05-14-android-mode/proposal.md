## Why

The Kevin Autopilot dashboard was desktop-only in feel: a `max-width: 480px` main layout, no RWD optimization, graph nodes with no visible text (only SVG `<title>` tooltip invisible on touch), and all bottom tabs broken by a JS syntax error (`\'` in template literals). Kevin uses it on Android and the mobile experience was unusable.

Kevin asked for an "Android mode" — a mobile-first cyberpunk neural cockpit where the graph loads by default, nodes show readable labels, the bottom tabs actually work, and desktop gets a proper wide layout.

The adaptive observation timer was added alongside to make the double feel alive: it accelerates when it finds interesting signals (excited mode) and cools off when signals drop, with a 60 s floor so it never spins uncontrollably.

## What Changes

- **Adaptive observation timer**: `ObservationLoopState` gains `excitementMode` (`excited | cooling | normal`) and `currentIntervalMs`. `executeRun` computes an excitement score from cycle outputs; `scheduleNextRun` picks `excitedIntervalMs`, `coolingIntervalMs`, or `intervalMs` accordingly, clamped at 60 000 ms.
- **Cyberpunk Android tab UI**: 4-tab bottom nav (圖 | 分身 | Backlog | 想法), SVG neural map with `<text>` labels per node (cyan/magenta, truncated), scanline overlay, cyan/magenta CSS palette, cyberpunk variables in `:root`.
- **Mobile default**: 圖 (graph) tab is shown first without `hidden`; desktop switches to 3-column grid via `@media (min-width: 768px)`.
- **JS syntax fix**: `\'` → `\\'` in `cpLoadBacklogTab` onclick handlers inside TypeScript template literals to prevent JS parse errors.
- **SVG node text labels**: `<text>` element added per node in `renderGraphTab`, centered on the circle, font-size 3.2 (center) or 2.6 (peripheral).

## Capabilities

### Modified Capabilities

- `neural-cockpit`: cyberpunk 4-tab UI, mobile-first graph default, 3-column desktop layout, labeled SVG nodes, runtime-overrides section on settings page, cockpit status reflects effective config.
- `double-research-loop`: adaptive timer (excited/cooling/normal modes, 60 s floor), reads effective config per cycle.

## Impact

- Affects `src/web.ts` (tab UI, SVG labels, JS fix) and `src/observation-loop.ts` (adaptive timer).
- Bumps `src/version.ts`, `package.json`, `.github/workflows/deploy-dev.yml` `EXPECTED_APP_VERSION` to `0.13.0`.
- Updates `README.md` and `AGENTS.md` with the v0.13.0 entry.
- No new dependency, no schema migration, no Docker image change beyond the rebuilt JS bundle.
- Read-only safety boundary unchanged.
