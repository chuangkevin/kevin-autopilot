# Cyberpunk Neural UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current dashboard with a mobile-first cyberpunk UI: bottom tab bar (分身 / Backlog / 圖 / 想法), cyberpunk design system (black + cyan + magenta), and a neural brain SVG graph with glowing nodes and typed edges.

**Architecture:** All changes live in `src/web.ts`. Add four `renderXxxTab` functions, a new CSS design system string, and client-side JS tab switching. The existing API response shapes, graph SVG logic, and settings page are untouched. Desktop gets a sidebar layout via a `@media (min-width: 768px)` rule.

**Prerequisite:** Complete the `2026-05-14-adaptive-timer.md` plan first so `ObservationLoopState` has `excitementMode` and `currentIntervalMs`.

**Tech Stack:** TypeScript, template-literal HTML generation (existing pattern in `src/web.ts`), SVG, vanilla JS embedded in HTML

---

### Task 1: Define the cyberpunk CSS design system

**Files:**
- Modify: `src/web.ts` — replace the `<style>` block inside `renderPage`

- [ ] **Step 1.1: Write the failing test**

Add to `src/web.test.ts`:

```ts
test('dashboard HTML uses cyberpunk CSS variables', async () => {
  const html = await getDashboardHtml()
  assert.ok(html.includes('--accent: #00ffff'), 'missing --accent CSS var')
  assert.ok(html.includes('--pink: #ff00ff'), 'missing --pink CSS var')
  assert.ok(html.includes('font-family: \'Courier New\''), 'missing monospace font')
})
```

Where `getDashboardHtml()` is the existing test helper that renders the dashboard. Check `src/web.test.ts` for how it's currently called and follow the same pattern.

- [ ] **Step 1.2: Run test to confirm it fails**

```bash
npm test -- --test-name-pattern "cyberpunk CSS"
```
Expected: FAIL — the CSS vars don't exist yet.

- [ ] **Step 1.3: Replace the CSS block in `renderPage`**

In `src/web.ts`, find `renderPage` and replace everything between the opening `<style>` and closing `</style>` tags with:

```css
:root {
  --bg: #050505;
  --bg-card: #0a0a0a;
  --bg-card2: rgba(255,255,255,0.03);
  --accent: #00ffff;
  --accent-dim: rgba(0,255,255,0.12);
  --accent-border: rgba(0,255,255,0.25);
  --pink: #ff00ff;
  --pink-dim: rgba(255,0,255,0.12);
  --pink-border: rgba(255,0,255,0.3);
  --warn: #ef4444;
  --amber: #f59e0b;
  --muted: rgba(255,255,255,0.25);
  --muted2: rgba(255,255,255,0.08);
  color-scheme: dark;
  font-family: 'Courier New', monospace;
  background: var(--bg);
  color: #e0e0e0;
}
* { box-sizing: border-box; }
html, body { width: 100%; max-width: 100%; overflow-x: hidden; margin: 0; padding: 0; }
body { background: var(--bg); }

/* Scanline overlay on main */
main::before {
  content: '';
  position: fixed;
  inset: 0;
  background: repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,255,255,0.012) 3px, rgba(0,255,255,0.012) 4px);
  pointer-events: none;
  z-index: 100;
}

main { position: relative; width: 100%; max-width: 480px; margin: 0 auto; min-height: 100dvh; display: flex; flex-direction: column; }

/* Header */
.cp-header {
  padding: 14px 16px 10px;
  border-bottom: 1px solid var(--accent-border);
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: rgba(0,0,0,0.9);
  position: sticky;
  top: 0;
  z-index: 50;
}
.cp-title { font-size: 13px; font-weight: bold; color: var(--accent); text-shadow: 0 0 8px rgba(0,255,255,0.5); letter-spacing: 0.1em; text-transform: uppercase; margin: 0; }
.cp-settings-link { font-size: 10px; color: rgba(0,255,255,0.5); border: 1px solid var(--accent-border); padding: 3px 8px; border-radius: 4px; text-decoration: none; letter-spacing: 0.05em; }
.cp-settings-link:hover { color: var(--accent); border-color: var(--accent); }

/* Tab content panels */
.tab-panels { flex: 1; overflow-y: auto; padding: 12px; padding-bottom: 80px; }
.tab-panel[hidden] { display: none; }

/* Bottom tab bar */
.tab-bar {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr 1fr;
  border-top: 1px solid var(--accent-border);
  background: rgba(0,0,0,0.95);
  position: fixed;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 100%;
  max-width: 480px;
  z-index: 50;
}
.tab-btn {
  padding: 8px 4px;
  text-align: center;
  font-size: 8px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted);
  background: transparent;
  border: none;
  cursor: pointer;
  font-family: 'Courier New', monospace;
  transition: color 120ms ease;
}
.tab-btn:hover { color: rgba(0,255,255,0.6); }
.tab-btn.active { color: var(--accent); text-shadow: 0 0 8px rgba(0,255,255,0.5); }
.tab-btn .tab-icon { font-size: 15px; display: block; margin-bottom: 2px; }

/* Cards */
.cp-card {
  background: var(--bg-card);
  border: 1px solid var(--accent-border);
  border-radius: 12px;
  padding: 14px;
  margin-bottom: 10px;
}
.cp-card.pink { border-color: var(--pink-border); }
.cp-card.dim { border-color: rgba(255,255,255,0.08); }

/* Labels */
.sys-label { font-size: 9px; color: rgba(0,255,255,0.4); letter-spacing: 0.18em; text-transform: uppercase; margin-bottom: 6px; }
.sys-label.pink { color: rgba(255,0,255,0.4); }

/* Brain state */
.brain-mode { font-size: 22px; font-weight: bold; color: var(--accent); text-shadow: 0 0 12px var(--accent), 0 0 24px rgba(0,255,255,0.3); letter-spacing: 0.05em; }
.brain-mode.dim { color: #334155; text-shadow: none; }
.brain-sub { font-size: 10px; color: var(--pink); text-shadow: 0 0 6px var(--pink); margin-top: 2px; margin-bottom: 10px; }
.brain-sub.dim { color: #475569; text-shadow: none; }

/* Stats row */
.stats-row { display: flex; gap: 8px; margin-bottom: 10px; }
.stat-box { flex: 1; background: var(--accent-dim); border: 1px solid var(--accent-border); border-radius: 6px; padding: 6px; text-align: center; }
.stat-label { font-size: 8px; color: rgba(0,255,255,0.4); letter-spacing: 0.1em; text-transform: uppercase; }
.stat-val { font-size: 16px; font-weight: bold; color: var(--accent); text-shadow: 0 0 8px rgba(0,255,255,0.4); }
.stat-val.dim { color: #334155; text-shadow: none; }

/* Seeds */
.seeds-box { background: var(--bg-card2); border: 1px solid rgba(0,255,255,0.1); border-radius: 8px; padding: 10px; }
.seed-bullet { color: var(--pink); text-shadow: 0 0 4px var(--pink); margin-right: 6px; }

/* Signal list */
.signal-list { display: flex; flex-direction: column; gap: 5px; margin-top: 4px; }
.signal-item { background: var(--bg-card2); border: 1px solid rgba(255,255,255,0.07); border-radius: 6px; padding: 7px 10px; display: flex; align-items: center; gap: 8px; font-size: 10px; }
.signal-text { flex: 1; color: #94a3b8; }
.signal-time { color: var(--muted); font-size: 9px; }

/* Backlog */
.filter-pills { display: flex; gap: 6px; margin-bottom: 10px; }
.filter-pill { background: var(--muted2); border: 1px solid rgba(255,255,255,0.1); border-radius: 20px; padding: 3px 10px; font-size: 10px; color: var(--muted); cursor: pointer; font-family: 'Courier New', monospace; }
.filter-pill.active { background: var(--accent-dim); border-color: var(--accent-border); color: var(--accent); }
.bl-item { border-radius: 8px; padding: 10px; margin-bottom: 6px; font-size: 11px; }
.bl-item.high { background: rgba(239,68,68,0.06); border-left: 2px solid var(--warn); box-shadow: -2px 0 8px rgba(239,68,68,0.15); }
.bl-item.med { background: rgba(245,158,11,0.05); border-left: 2px solid var(--amber); box-shadow: -2px 0 8px rgba(245,158,11,0.12); }
.bl-item.low { background: var(--bg-card2); border-left: 2px solid #334155; }
.bl-title { color: #e2e8f0; }
.bl-meta { color: var(--muted); font-size: 9px; margin-top: 2px; }
.bl-actions { display: flex; gap: 4px; margin-top: 6px; }
.bl-btn { font-size: 9px; padding: 3px 8px; border-radius: 4px; border: 1px solid var(--accent-border); background: transparent; color: rgba(0,255,255,0.5); cursor: pointer; font-family: 'Courier New', monospace; }
.bl-btn:hover { border-color: var(--accent); color: var(--accent); }

/* Neural graph */
.graph-wrap { position: relative; background: #020202; border: 1px solid var(--accent-border); border-radius: 12px; overflow: hidden; height: calc(100dvh - 200px); min-height: 300px; }
.graph-svg { width: 100%; height: 100%; }
.node-drawer { background: rgba(0,0,0,0.95); border-top: 1px solid var(--accent-border); padding: 10px 14px; }

/* Idea input */
.idea-textarea {
  width: 100%; background: var(--bg-card2); border: 1px solid var(--accent-border); border-radius: 8px; padding: 10px; color: #c0e8ff; font-size: 12px; font-family: 'Courier New', monospace; resize: none; min-height: 90px; margin-bottom: 8px;
}
.idea-textarea::placeholder { color: rgba(0,255,255,0.2); }
.idea-textarea:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 10px rgba(0,255,255,0.1); }
.transmit-btn { width: 100%; padding: 11px; background: transparent; border: 1px solid rgba(0,255,255,0.5); border-radius: 8px; color: var(--accent); font-weight: bold; font-size: 12px; font-family: 'Courier New', monospace; letter-spacing: 0.1em; text-shadow: 0 0 8px rgba(0,255,255,0.4); box-shadow: 0 0 15px rgba(0,255,255,0.08); cursor: pointer; }
.transmit-btn:hover { background: var(--accent-dim); }
.idea-item { background: var(--bg-card2); border: 1px solid rgba(255,255,255,0.06); border-radius: 6px; padding: 7px 9px; margin-bottom: 5px; display: flex; justify-content: space-between; align-items: center; }
.idea-name { font-size: 11px; color: #94a3b8; }
.idea-status { font-size: 9px; color: rgba(0,255,255,0.4); }

/* Desktop sidebar layout */
@media (min-width: 768px) {
  main { max-width: 1100px; flex-direction: column; }
  .tab-bar { display: none; }
  .tab-panels { padding-bottom: 12px; }
  .desktop-layout { display: grid; grid-template-columns: 280px 1fr 280px; gap: 16px; align-items: start; padding: 16px; }
  .tab-panel[hidden] { display: block !important; }
  .tab-panel { display: block !important; }
}

/* Muted / utilities */
.muted { color: var(--muted); font-size: 11px; }
a, a:visited { color: var(--accent); }
button, a.button { cursor: pointer; }
```

- [ ] **Step 1.4: Run test to confirm it passes**

```bash
npm test -- --test-name-pattern "cyberpunk CSS"
```
Expected: PASS.

- [ ] **Step 1.5: Build check**

```bash
npm run build
```
Expected: zero errors.

- [ ] **Step 1.6: Commit**

```bash
git add src/web.ts src/web.test.ts
git commit -m "feat: cyberpunk CSS design system in renderPage"
```

---

### Task 2: Add client-side tab switching JS and bottom tab bar

**Files:**
- Modify: `src/web.ts` — `renderPage` function body (the HTML return value)

- [ ] **Step 2.1: Write the failing test**

Add to `src/web.test.ts`:

```ts
test('dashboard HTML includes tab bar with four tabs', async () => {
  const html = await getDashboardHtml()
  assert.ok(html.includes('data-tab="brain"'), 'missing brain tab button')
  assert.ok(html.includes('data-tab="backlog"'), 'missing backlog tab button')
  assert.ok(html.includes('data-tab="graph"'), 'missing graph tab button')
  assert.ok(html.includes('data-tab="idea"'), 'missing idea tab button')
  assert.ok(html.includes('id="tab-brain"'), 'missing brain panel')
  assert.ok(html.includes('switchTab'), 'missing switchTab JS')
})
```

- [ ] **Step 2.2: Run test to confirm it fails**

```bash
npm test -- --test-name-pattern "tab bar"
```
Expected: FAIL.

- [ ] **Step 2.3: Replace the `<body>` structure in `renderPage`**

In `renderPage`, replace everything from `<body>` to `</body>` with:

```html
<body>
<main>
  <header class="cp-header">
    <h1 class="cp-title">Kevin Autopilot</h1>
    <a class="cp-settings-link" href="/settings">SYS ⚙</a>
  </header>

  <div class="tab-panels" id="tab-panels">
    <div class="tab-panel" id="tab-brain">
      ${renderBrainTab(loopState)}
    </div>
    <div class="tab-panel" id="tab-backlog" hidden>
      ${renderBacklogTab(backlog)}
    </div>
    <div class="tab-panel" id="tab-graph" hidden>
      ${renderGraphTab(graph, loopState)}
    </div>
    <div class="tab-panel" id="tab-idea" hidden>
      ${renderIdeaTab(ideas)}
    </div>
  </div>

  <nav class="tab-bar">
    <button class="tab-btn active" data-tab="brain" onclick="switchTab('brain')">
      <span class="tab-icon">🧠</span>分身
    </button>
    <button class="tab-btn" data-tab="backlog" onclick="switchTab('backlog')">
      <span class="tab-icon">📋</span>Backlog
    </button>
    <button class="tab-btn" data-tab="graph" onclick="switchTab('graph')">
      <span class="tab-icon">🕸</span>圖
    </button>
    <button class="tab-btn" data-tab="idea" onclick="switchTab('idea')">
      <span class="tab-icon">✏️</span>想法
    </button>
  </nav>
</main>

<script>
function switchTab(name) {
  document.querySelectorAll('.tab-panel').forEach(function(el) { el.hidden = true; });
  document.querySelectorAll('.tab-btn').forEach(function(el) { el.classList.remove('active'); });
  var panel = document.getElementById('tab-' + name);
  if (panel) panel.hidden = false;
  var btn = document.querySelector('[data-tab="' + name + '"]');
  if (btn) btn.classList.add('active');
  history.replaceState(null, '', '#' + name);
}
(function() {
  var hash = location.hash.slice(1);
  if (['brain','backlog','graph','idea'].indexOf(hash) !== -1) switchTab(hash);
})();
</script>
</body>
```

You'll also need to add the four new render function calls (`renderBrainTab`, `renderBacklogTab`, `renderGraphTab`, `renderIdeaTab`) — you will implement them in Tasks 3–6 below. For now, add stub implementations that return a placeholder string, so the file compiles:

```ts
function renderBrainTab(loopState: ObservationLoopState): string {
  return `<div class="sys-label">/// 分身 — coming in Task 3</div>`
}
function renderBacklogTab(backlog: BacklogPanelData): string {
  return `<div class="sys-label">/// Backlog — coming in Task 4</div>`
}
function renderGraphTab(graph: IdeaGraph, loopState: ObservationLoopState): string {
  return `<div class="sys-label">/// 圖 — coming in Task 5</div>`
}
function renderIdeaTab(ideas: IdeaRecord[]): string {
  return `<div class="sys-label">/// 想法 — coming in Task 6</div>`
}
```

- [ ] **Step 2.4: Build and run test**

```bash
npm run build && npm test -- --test-name-pattern "tab bar"
```
Expected: PASS.

- [ ] **Step 2.5: Commit**

```bash
git add src/web.ts src/web.test.ts
git commit -m "feat: bottom tab bar with switchTab JS"
```

---

### Task 3: Implement `renderBrainTab`

**Files:**
- Modify: `src/web.ts` — replace the `renderBrainTab` stub

- [ ] **Step 3.1: Write the failing test**

Add to `src/web.test.ts`:

```ts
test('brain tab renders excited mode when excitementMode is excited', async () => {
  const html = await getDashboardHtml({ excitementMode: 'excited', currentIntervalMs: 60_000, lastExcitementScore: 2 })
  assert.ok(html.includes('EXCITED'), 'missing EXCITED text')
  assert.ok(html.includes('brain-mode'), 'missing brain-mode class')
})

test('brain tab renders normal mode when excitementMode is normal', async () => {
  const html = await getDashboardHtml({ excitementMode: 'normal', currentIntervalMs: 300_000, lastExcitementScore: 0 })
  assert.ok(html.includes('STANDBY'), 'missing STANDBY text')
})
```

Check `src/web.test.ts` to understand how to pass a custom `loopState` to the render function. If `getDashboardHtml` doesn't accept overrides, add a direct call to `renderBrainTab` in the test instead:

```ts
import { renderBrainTabForTest } from './web.js'  // export the function for testing
```

or call the HTML generation directly with a stub config.

- [ ] **Step 3.2: Run test to confirm it fails**

```bash
npm test -- --test-name-pattern "brain tab"
```
Expected: FAIL.

- [ ] **Step 3.3: Replace the `renderBrainTab` stub with the real implementation**

```ts
function renderBrainTab(loopState: ObservationLoopState): string {
  const isExcited = loopState.excitementMode === 'excited'
  const isCooling = loopState.excitementMode === 'cooling'
  const isDim = !isExcited && !isCooling

  const modeText = isExcited ? '⚡ EXCITED' : isCooling ? '🌡 COOLING' : '😴 STANDBY'
  const intervalSec = Math.round((loopState.currentIntervalMs ?? loopState.intervalMs) / 1000)
  const intervalLabel = intervalSec >= 60 ? `${Math.round(intervalSec / 60)}m` : `${intervalSec}s`
  const nextLabel = loopState.nextRunAt
    ? `next cycle: ${formatCountdown(loopState.nextRunAt)}`
    : `every ${intervalLabel}`

  const score = loopState.lastExcitementScore ?? 0
  const runCount = loopState.runCount

  return `
<div class="cp-card${isDim ? ' dim' : ''}">
  <div class="sys-label">/// Neural Status</div>
  <div class="brain-mode${isDim ? ' dim' : ''}">${escapeHtml(modeText)}</div>
  <div class="brain-sub${isDim ? ' dim' : ''}">${escapeHtml(nextLabel)}</div>
  <div class="stats-row">
    <div class="stat-box">
      <div class="stat-label">INTERVAL</div>
      <div class="stat-val${isDim ? ' dim' : ''}">${escapeHtml(intervalLabel)}</div>
    </div>
    <div class="stat-box">
      <div class="stat-label">SCORE</div>
      <div class="stat-val${isDim ? ' dim' : ''}">+${score}</div>
    </div>
    <div class="stat-box">
      <div class="stat-label">RUNS</div>
      <div class="stat-val${isDim ? ' dim' : ''}">${runCount}</div>
    </div>
  </div>
  ${renderBrainSeedsBox(loopState)}
</div>
${renderBrainSignals(loopState)}`
}

function renderBrainSeedsBox(loopState: ObservationLoopState): string {
  const lastAt = loopState.lastReflectionAt
    ? formatTaipeiTime(loopState.lastReflectionAt)
    : '—'
  return `
<div class="seeds-box">
  <div class="sys-label" style="margin-bottom:4px">/// Last Reflection · ${escapeHtml(lastAt)}</div>
  <div id="brain-seeds-placeholder" class="muted" style="font-size:11px">
    ${loopState.lastReflectionAt ? '反思已完成，查看圖 Tab 看最新 ideas' : '尚未執行反思'}
  </div>
</div>`
}

function renderBrainSignals(loopState: ObservationLoopState): string {
  const lastRun = loopState.lastFinishedAt
  if (!lastRun) return `<div class="muted" style="margin-top:8px;font-size:11px">尚未執行任何 cycle</div>`
  return `
<div>
  <div class="sys-label" style="margin: 10px 0 6px">/// System</div>
  <div class="signal-list">
    <div class="signal-item">
      <span>🔄</span>
      <span class="signal-text">上次完成</span>
      <span class="signal-time">${escapeHtml(formatTaipeiTime(lastRun))}</span>
    </div>
    ${loopState.lastSuccess === false && loopState.lastError ? `
    <div class="signal-item" style="border-color:rgba(239,68,68,0.3)">
      <span>⚠</span>
      <span class="signal-text" style="color:#ef4444">${escapeHtml(loopState.lastError.slice(0, 60))}</span>
    </div>` : ''}
  </div>
</div>`
}
```

Also add `formatCountdown` helper near `formatTaipeiTime`:

```ts
function formatCountdown(isoString: string): string {
  const diff = new Date(isoString).getTime() - Date.now()
  if (diff <= 0) return 'now'
  const sec = Math.round(diff / 1000)
  if (sec < 60) return `${sec}s`
  return `${Math.round(sec / 60)}m`
}
```

- [ ] **Step 3.4: Build and run tests**

```bash
npm run build && npm test -- --test-name-pattern "brain tab"
```
Expected: PASS.

- [ ] **Step 3.5: Commit**

```bash
git add src/web.ts src/web.test.ts
git commit -m "feat: renderBrainTab with excited/cooling/standby states"
```

---

### Task 4: Implement `renderBacklogTab`

**Files:**
- Modify: `src/web.ts` — replace `renderBacklogTab` stub

- [ ] **Step 4.1: Write the failing test**

```ts
test('backlog tab renders items with severity classes', async () => {
  const html = await getDashboardHtml()
  assert.ok(html.includes('id="tab-backlog"'), 'missing backlog panel')
  assert.ok(html.includes('bl-item'), 'missing bl-item class')
  assert.ok(html.includes('filter-pill'), 'missing filter pills')
})
```

- [ ] **Step 4.2: Run test to confirm it fails**

```bash
npm test -- --test-name-pattern "backlog tab"
```

- [ ] **Step 4.3: Replace the `renderBacklogTab` stub**

```ts
function renderBacklogTab(backlog: BacklogPanelData): string {
  const active = backlog.items.filter((item) => !item.status || item.status === 'active')
  const snoozed = backlog.items.filter((item) => item.status === 'snoozed')
  const resolved = backlog.items.filter((item) => item.status === 'resolved' || item.status === 'dismissed')
  return `
<div>
  <div class="filter-pills">
    <button class="filter-pill active" onclick="filterBacklog('active',this)">● 活躍 ${active.length}</button>
    <button class="filter-pill" onclick="filterBacklog('snoozed',this)">暫緩 ${snoozed.length}</button>
    <button class="filter-pill" onclick="filterBacklog('resolved',this)">完成 ${resolved.length}</button>
  </div>
  <div id="bl-active">${active.map((item) => renderCpBacklogItem(item)).join('')}</div>
  <div id="bl-snoozed" hidden>${snoozed.map((item) => renderCpBacklogItem(item)).join('')}</div>
  <div id="bl-resolved" hidden>${resolved.map((item) => renderCpBacklogItem(item)).join('')}</div>
  ${active.length === 0 ? '<div class="muted" style="text-align:center;padding:24px">無活躍項目</div>' : ''}
</div>
<script>
function filterBacklog(key, btn) {
  ['active','snoozed','resolved'].forEach(function(k) {
    var el = document.getElementById('bl-' + k);
    if (el) el.hidden = k !== key;
  });
  document.querySelectorAll('.filter-pill').forEach(function(p) { p.classList.remove('active'); });
  btn.classList.add('active');
}
</script>`
}

function renderCpBacklogItem(item: BacklogItem): string {
  const severity = item.seenCount >= 8 || item.kind === 'bug_watch' || item.kind === 'bug_fix_candidate' ? 'high'
    : item.seenCount >= 4 ? 'med' : 'low'
  return `
<div class="bl-item ${severity}">
  <div class="bl-title">${escapeHtml(item.title)}</div>
  <div class="bl-meta">出現 ${item.seenCount} 次 · ${escapeHtml(item.kind)}</div>
  <div class="bl-actions">
    <button class="bl-btn" onclick="snoozeItem('${escapeHtml(item.id)}', this)">暫緩 7d</button>
    <button class="bl-btn" onclick="dismissItem('${escapeHtml(item.id)}', this)">略過</button>
  </div>
</div>`
}
```

Also add inline JS for snooze/dismiss (reuse existing API calls from the old dashboard):

```html
<script>
function snoozeItem(id, btn) {
  fetch('/api/backlog/' + id + '/snooze', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ days: 7 }) })
    .then(function() { btn.closest('.bl-item').style.opacity = '0.3'; btn.disabled = true; });
}
function dismissItem(id, btn) {
  fetch('/api/backlog/' + id + '/dismiss', { method: 'POST' })
    .then(function() { btn.closest('.bl-item').style.opacity = '0.3'; btn.disabled = true; });
}
</script>
```

Add this `<script>` block to the returned HTML string in `renderBacklogTab`.

- [ ] **Step 4.4: Build and run tests**

```bash
npm run build && npm test -- --test-name-pattern "backlog tab"
```
Expected: PASS.

- [ ] **Step 4.5: Commit**

```bash
git add src/web.ts src/web.test.ts
git commit -m "feat: renderBacklogTab with severity classes and filter pills"
```

---

### Task 5: Implement `renderGraphTab` (cyberpunk Neural Cockpit)

**Files:**
- Modify: `src/web.ts` — replace `renderGraphTab` stub; keep existing SVG layout logic from `renderNeuralCockpit`

- [ ] **Step 5.1: Write the failing test**

```ts
test('graph tab renders SVG neural map', async () => {
  const html = await getDashboardHtml()
  assert.ok(html.includes('id="tab-graph"'), 'missing graph panel')
  assert.ok(html.includes('class="graph-wrap"'), 'missing graph-wrap')
  assert.ok(html.includes('<svg'), 'missing SVG element')
})
```

- [ ] **Step 5.2: Run test to confirm it fails**

```bash
npm test -- --test-name-pattern "graph tab"
```

- [ ] **Step 5.3: Replace the `renderGraphTab` stub**

```ts
function renderGraphTab(graph: IdeaGraph, loopState: ObservationLoopState): string {
  return `
<div class="graph-wrap" id="neural-graph-wrap">
  ${renderCpNeuralMap(graph)}
</div>
<div class="node-drawer" id="node-drawer" hidden>
  <div class="sys-label">/// Selected Node</div>
  <div id="node-drawer-content"></div>
</div>`
}
```

Then add `renderCpNeuralMap` which re-uses the existing SVG node-layout logic from `renderNeuralCockpit` but applies the new cyberpunk node and edge styles:

Find the existing `renderNeuralCockpit` function and locate the SVG generation code inside it (the `layoutResult` / `renderGraphStage` client-side JS). The SVG rendering is done client-side in the existing code. For `renderCpNeuralMap`, keep the same client-side JS structure but change the node appearance CSS classes to cyberpunk equivalents.

Copy the existing `<div class="neural-stage" ...>` content into `renderCpNeuralMap` but:
1. Replace `neural-stage` container with `<svg class="graph-svg" id="neural-map">` wrapping approach used in the client JS
2. Keep all the existing `renderGraphStage`, `renderBacklog`, `renderBrowserNodeAction`, `renderNodeDrawer` client-side JS functions — just re-expose them inside the new function with updated CSS class names matching the cyberpunk design

Specifically, update node rendering colors in the client-side JS to use CSS variables:
- Node border: `rgba(0,255,255,0.4)` for idea nodes, `rgba(255,0,255,0.5)` for interesting nodes
- Edge color: `rgba(0,255,255,0.5)` for strong, dashed `rgba(0,255,255,0.2)` for weak
- Selected node: pulse ring using `rgba(0,255,255,0.3)` gradient

- [ ] **Step 5.4: Build and run tests**

```bash
npm run build && npm test -- --test-name-pattern "graph tab"
```
Expected: PASS.

- [ ] **Step 5.5: Commit**

```bash
git add src/web.ts src/web.test.ts
git commit -m "feat: renderGraphTab — cyberpunk Neural Cockpit"
```

---

### Task 6: Implement `renderIdeaTab`

**Files:**
- Modify: `src/web.ts` — replace `renderIdeaTab` stub

- [ ] **Step 6.1: Write the failing test**

```ts
test('idea tab renders textarea and transmit button', async () => {
  const html = await getDashboardHtml()
  assert.ok(html.includes('id="tab-idea"'), 'missing idea panel')
  assert.ok(html.includes('class="idea-textarea"'), 'missing textarea')
  assert.ok(html.includes('TRANSMIT'), 'missing transmit button text')
})
```

- [ ] **Step 6.2: Run test to confirm it fails**

```bash
npm test -- --test-name-pattern "idea tab"
```

- [ ] **Step 6.3: Replace the `renderIdeaTab` stub**

```ts
function renderIdeaTab(ideas: IdeaRecord[]): string {
  const recent = ideas.slice(0, 8)
  return `
<div>
  <div class="sys-label" style="margin-bottom:8px">/// Input to Neural</div>
  <textarea class="idea-textarea" id="idea-input" placeholder="輸入想法，分身會整理…" rows="5"></textarea>
  <button class="transmit-btn" id="idea-submit">[ TRANSMIT ]</button>
  <div id="idea-result" class="muted" style="margin-top:6px;font-size:11px"></div>

  <div class="sys-label" style="margin:12px 0 6px">/// Recent Ideas</div>
  ${recent.length === 0 ? '<div class="muted" style="font-size:11px">尚無想法</div>' : recent.map(renderCpIdeaItem).join('')}
</div>

<script>
document.getElementById('idea-submit').addEventListener('click', function() {
  var text = document.getElementById('idea-input').value.trim();
  if (!text) return;
  var btn = this;
  btn.disabled = true;
  btn.textContent = '[ TRANSMITTING... ]';
  fetch('/api/ideas', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ rawText: text }) })
    .then(function(r) { return r.json(); })
    .then(function() {
      document.getElementById('idea-result').textContent = '✓ 已送出';
      document.getElementById('idea-input').value = '';
      btn.textContent = '[ TRANSMIT ]';
      btn.disabled = false;
    })
    .catch(function() {
      document.getElementById('idea-result').textContent = '✗ 送出失敗';
      btn.textContent = '[ TRANSMIT ]';
      btn.disabled = false;
    });
});
</script>`
}

function renderCpIdeaItem(idea: IdeaRecord): string {
  return `
<div class="idea-item">
  <span class="idea-name">${escapeHtml(idea.title ?? idea.rawText.slice(0, 40))}</span>
  <span class="idea-status">${escapeHtml(idea.status ?? 'pending')}</span>
</div>`
}
```

Check `src/types.ts` for the exact shape of `IdeaRecord` (fields: `title`, `rawText`, `status`) and adjust if the field names differ.

- [ ] **Step 6.4: Build and run tests**

```bash
npm run build && npm test -- --test-name-pattern "idea tab"
```
Expected: PASS.

- [ ] **Step 6.5: Commit**

```bash
git add src/web.ts src/web.test.ts
git commit -m "feat: renderIdeaTab with transmit button and recent ideas"
```

---

### Task 7: Desktop sidebar layout

**Files:**
- Modify: `src/web.ts` — wrap tab panels in `.desktop-layout` for ≥768px

- [ ] **Step 7.1: Add desktop wrapper to `renderPage` body**

On desktop (≥768px) the CSS already shows all panels via `.tab-panel[hidden] { display: block !important; }`. To get the three-column layout, wrap the tab-panels div in a `desktop-layout` container:

```html
<div class="tab-panels" id="tab-panels">
  <div class="desktop-layout">
    <div class="tab-panel" id="tab-brain">...</div>
    <div class="tab-panel" id="tab-graph" hidden>...</div>
    <div class="tab-panel" id="tab-backlog" hidden style="display:flex;flex-direction:column;gap:10px">
      ${renderBacklogTab(backlog)}
      ${renderIdeaTab(ideas)}
    </div>
  </div>
  <!-- idea tab hidden on desktop (combined with backlog column) -->
  <div class="tab-panel" id="tab-idea" hidden style="display:none"></div>
</div>
```

Wait — this approach conflicts with mobile tab switching. Instead, keep the tab panels separate but add a second desktop-only rendering:

Replace the tab-panels div in `renderPage` with:

```html
<!-- Mobile: individual tab panels -->
<div id="mobile-panels" class="tab-panels">
  <div class="tab-panel" id="tab-brain">${renderBrainTab(loopState)}</div>
  <div class="tab-panel" id="tab-backlog" hidden>${renderBacklogTab(backlog)}</div>
  <div class="tab-panel" id="tab-graph" hidden>${renderGraphTab(graph, loopState)}</div>
  <div class="tab-panel" id="tab-idea" hidden>${renderIdeaTab(ideas)}</div>
</div>
<!-- Desktop: always-visible three-column layout -->
<div id="desktop-panels" class="desktop-layout" style="display:none">
  <div>${renderBrainTab(loopState)}</div>
  <div>${renderGraphTab(graph, loopState)}</div>
  <div>
    ${renderBacklogTab(backlog)}
    <div style="margin-top:10px">${renderIdeaTab(ideas)}</div>
  </div>
</div>
```

Add to the `<style>` block:

```css
@media (min-width: 768px) {
  #mobile-panels { display: none; }
  #desktop-panels { display: grid !important; }
  .tab-bar { display: none; }
}
```

- [ ] **Step 7.2: Build**

```bash
npm run build
```
Expected: zero errors.

- [ ] **Step 7.3: Commit**

```bash
git add src/web.ts
git commit -m "feat: desktop three-column layout alongside mobile tab bar"
```

---

### Task 8: Run full test suite and version bump

**Files:**
- Modify: `src/version.ts`, `package.json`, `package-lock.json`, `.github/workflows/deploy-dev.yml`, `README.md`, `AGENTS.md`

- [ ] **Step 8.1: Run all tests**

```bash
npm test
```
Expected: all tests pass, 0 failures. Fix any regressions before continuing.

- [ ] **Step 8.2: Bump version to 0.13.0**

Update `src/version.ts`:
```ts
export const VERSION = '0.13.0'
```

Update `package.json`: `"version": "0.13.0"`

Run `npm install` to update `package-lock.json`.

Update `.github/workflows/deploy-dev.yml`: change `EXPECTED_APP_VERSION` to `0.13.0`.

- [ ] **Step 8.3: Add v0.13.0 to README.md**

Add after the v0.12.0 entry:

```
Version 0.13.0 introduces android mode: an adaptive reflection timer that shortens its own cycle interval when it detects exciting signals (new idea seeds, newly-interesting graph nodes, or backlog spikes), then gradually anneals back to the base interval over quiet cycles. The dashboard is replaced with a mobile-first cyberpunk Neural UI: bottom tab bar (分身 / Backlog / 圖 / 想法), near-black background with cyan/magenta glow accents, monospace typography, and the Neural Cockpit graph restyled as a dark brain visualization with typed glow edges.
```

- [ ] **Step 8.4: Add v0.13.0 to AGENTS.md**

Add the same entry under the version changelog section in `AGENTS.md`.

- [ ] **Step 8.5: Run build and tests one more time**

```bash
npm run build && npm test
```
Expected: 0 build errors, 0 test failures.

- [ ] **Step 8.6: Commit and push**

```bash
git add src/version.ts package.json package-lock.json .github/workflows/deploy-dev.yml README.md AGENTS.md
git commit -m "feat: android mode — adaptive timer + cyberpunk neural UI (v0.13.0)"
git push
```

---

### Self-Review

**Spec coverage:**
- ✓ Bottom tab bar: 分身 / Backlog / 圖 / 想法 (Tasks 2–6)
- ✓ Cyberpunk CSS: black bg, cyan/magenta, monospace, scanlines (Task 1)
- ✓ 分身 tab shows excited/cooling/standby states (Task 3)
- ✓ 分身 tab shows excitementScore, currentIntervalMs, lastReflectionAt (Task 3)
- ✓ Backlog tab with severity-colored items and filter pills (Task 4)
- ✓ 圖 tab wraps existing Neural Cockpit SVG (Task 5)
- ✓ 想法 tab with transmit button and recent ideas (Task 6)
- ✓ Desktop three-column sidebar layout (Task 7)
- ✓ Version bump to 0.13.0, README/AGENTS docs (Task 8)

**Type consistency:** `IdeaRecord.title`, `IdeaRecord.rawText`, `IdeaRecord.status` used in Task 6 — verify exact field names in `src/types.ts` before implementing.

**No new API endpoints added** — confirmed throughout.
