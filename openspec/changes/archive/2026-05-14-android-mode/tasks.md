## AT: Adaptive Timer

- [x] AT-1: Add `excitementMode`, `currentIntervalMs` fields to `ObservationLoopState`
- [x] AT-2: Add cross-cycle private state (`_isExcited`, `_isCooling`) to `ObservationLoop`
- [x] AT-3: Change `runReflectionSafely` return type to include excitement signals
- [x] AT-4: Add `computeExcitementScore` and wire into `executeRun`
- [x] AT-5: Update `scheduleNextRun` with adaptive interval logic and 60 s floor
- [x] AT-6: Write adaptive timer tests (excited mode, cooling, normal, floor)
- [x] AT-7: Verify adaptive fields on `/api/observation-loop`

## UI: Cyberpunk Neural Tab UI

- [x] UI-1: Cyberpunk CSS design system (`:root` variables, scanlines, cyan/magenta palette)
- [x] UI-2: Tab bar structure and `switchTab` JS (4 tabs: 圖/分身/Backlog/想法)
- [x] UI-3: `renderBrainTab` (分身 tab — loop status, excited mode indicator)
- [x] UI-4: `renderBacklogTab` (Backlog tab — backlog items with severity classes)
- [x] UI-5: `renderGraphTab` (圖 tab — SVG neural map with `<text>` labels per node)
- [x] UI-6: `renderIdeaTab` (想法 tab — textarea and transmit button)
- [x] UI-7: Desktop sidebar layout (`@media (min-width: 768px)` 3-column grid)
- [x] UI-8: Full test suite + version bump to 0.13.0

## Fix

- [x] FIX-1: JS syntax error — `\'` → `\\'` in `cpLoadBacklogTab` onclick handlers
- [x] FIX-2: SVG node text labels — `<text>` element per node with truncated title
