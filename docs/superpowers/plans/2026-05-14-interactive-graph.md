# Interactive Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static SVG neural map in the 圖 tab with a Cytoscape.js graph that supports drag, zoom/pan, organic force layout, and backend-persisted positions.

**Architecture:** A new `src/graph-positions.ts` module handles file I/O for `data/graph-positions.json`. Two new API routes (`GET/PUT /api/graph/positions`) serve and save positions. `renderGraphTab` outputs `<div class="cy-container">` + Cytoscape init `<script>` instead of SVG. Cytoscape is loaded from CDN. The init script marks each container with `data-cy-init` to avoid double-initialization (the template is embedded twice — mobile + desktop panels). All Cytoscape instances are tracked in `window._cyInstances` so `refreshCyGraph` can update all of them after graph actions.

**Tech Stack:** Cytoscape.js 3.30.4 (CDN `unpkg.com`), Node.js `fs/promises` for position file, vanilla JS inline `<script>`, TypeScript, Node.js built-in test runner.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/graph-positions.ts` | Create | `loadGraphPositions` / `saveGraphPositions` file I/O |
| `src/graph-positions.test.ts` | Create | Unit tests for the positions module |
| `src/web.ts` | Modify | Add CDN tag, rewrite `renderGraphTab`, add 2 API routes, add `refreshCyGraph` to inline JS, wire into action handlers |
| `src/web.test.ts` | Modify | Update "graph tab" test, add positions API tests |

**Do not change:** `src/types.ts`, `src/idea-graph.ts`, `src/observation-loop.ts`, SQLite schema, `createGraphLayout` (dead code but harmless — don't touch it).

---

## Background: critical codebase facts

- `src/web.ts` is one large file rendering everything server-side as inline HTML/CSS/JS.
- The dashboard page has **two** layouts: mobile (`#mobile-panels`) and desktop (`#desktop-panels`, shown ≥768 px via CSS media query). Both call `renderGraphTab(graph, loopState)`, so the Cytoscape init `<script>` is embedded twice per page load.
- `renderGraphTab` currently returns HTML with `<div class="graph-wrap"><svg class="graph-svg"...>` and server-rendered SVG circles. **This entire SVG block is removed and replaced by `<div class="cy-container">` + Cytoscape init.**
- `renderBrainTab` and the brain tab's hub-spoke sidebar (`#neural-stage`, `refreshGraphInPlace`) are **not changed** — they are separate from the Cytoscape graph.
- The existing `refreshGraphInPlace` function updates `#neural-stage` (brain tab). We add a **new** `refreshCyGraph` function that updates Cytoscape. Action handlers (extend, find-relationships, etc.) call **both**.
- Run build: `npm run build` (TypeScript to `dist/`). Run tests: `npm test`.

---

### Task 1: `src/graph-positions.ts` — positions persistence module

**Files:**
- Create: `src/graph-positions.ts`
- Create: `src/graph-positions.test.ts`

- [ ] **Step 1: Write the failing tests in `src/graph-positions.test.ts`**

```typescript
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadGraphPositions, saveGraphPositions } from './graph-positions.js'
import type { AutopilotConfig } from './types.js'

function makeConfig(dataDir: string): AutopilotConfig {
  return { environment: 'test', dataDir, ruleSources: [], repositories: [], services: [] }
}

test('loadGraphPositions returns {} when file is missing', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'gpos-'))
  try {
    assert.deepEqual(await loadGraphPositions(makeConfig(dataDir)), {})
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('saveGraphPositions then loadGraphPositions round-trips', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'gpos-'))
  try {
    const config = makeConfig(dataDir)
    const positions = { 'node-abc': { x: 120, y: 240 }, 'node-xyz': { x: 300, y: 100 } }
    await saveGraphPositions(config, positions)
    assert.deepEqual(await loadGraphPositions(config), positions)
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('loadGraphPositions returns {} when file contains invalid JSON', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'gpos-'))
  try {
    const config = makeConfig(dataDir)
    await mkdir(dataDir, { recursive: true })
    await writeFile(join(dataDir, 'graph-positions.json'), 'not-json', 'utf8')
    assert.deepEqual(await loadGraphPositions(config), {})
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('loadGraphPositions skips entries with non-numeric x/y', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'gpos-'))
  try {
    const config = makeConfig(dataDir)
    await mkdir(dataDir, { recursive: true })
    await writeFile(join(dataDir, 'graph-positions.json'), JSON.stringify({ 'good': { x: 1, y: 2 }, 'bad': { x: 'oops', y: 2 } }), 'utf8')
    assert.deepEqual(await loadGraphPositions(config), { 'good': { x: 1, y: 2 } })
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run tests to verify they fail**

```
npm run build && npm test 2>&1 | grep -E "graph-positions|FAIL|pass|fail"
```
Expected: 4 tests fail with "Cannot find module './graph-positions.js'"

- [ ] **Step 3: Create `src/graph-positions.ts`**

```typescript
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AutopilotConfig } from './types.js'

export type GraphPositions = Record<string, { x: number; y: number }>

const POSITIONS_FILE = 'graph-positions.json'

export async function loadGraphPositions(config: AutopilotConfig): Promise<GraphPositions> {
  try {
    const raw = await readFile(join(config.dataDir, POSITIONS_FILE), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const result: GraphPositions = {}
    for (const [id, pos] of Object.entries(parsed as Record<string, unknown>)) {
      if (
        pos !== null &&
        typeof pos === 'object' &&
        !Array.isArray(pos) &&
        'x' in pos &&
        'y' in pos &&
        typeof (pos as { x: unknown }).x === 'number' &&
        typeof (pos as { y: unknown }).y === 'number'
      ) {
        result[id] = { x: (pos as { x: number }).x, y: (pos as { y: number }).y }
      }
    }
    return result
  } catch {
    return {}
  }
}

export async function saveGraphPositions(config: AutopilotConfig, positions: GraphPositions): Promise<void> {
  await mkdir(config.dataDir, { recursive: true })
  await writeFile(join(config.dataDir, POSITIONS_FILE), `${JSON.stringify(positions, null, 2)}\n`, 'utf8')
}
```

- [ ] **Step 4: Run build and tests to verify they pass**

```
npm run build && npm test 2>&1 | grep -E "graph-positions|pass|fail"
```
Expected: 4 tests pass. Total test count increases by 4.

- [ ] **Step 5: Commit**

```
git add src/graph-positions.ts src/graph-positions.test.ts
git commit -m "feat: add graph-positions module for persisting node layout"
```

---

### Task 2: `GET /api/graph/positions` and `PUT /api/graph/positions` routes

**Files:**
- Modify: `src/web.ts` (add import + 2 route handlers)
- Modify: `src/web.test.ts` (add 4 assertions inside the existing large server test)

- [ ] **Step 1: Add failing assertions to `src/web.test.ts`**

Find the existing test `'web server exposes health and idea intake'`. Inside its try block, after the `keyImport` assertion block (around line 425 before the `} finally` close), add:

```typescript
    const posGet = await fetch(`${baseUrl}/api/graph/positions`)
    assert.equal(posGet.status, 200)
    const posGetBody = await posGet.json()
    assert.deepEqual(posGetBody.positions, {})

    const posPut = await fetch(`${baseUrl}/api/graph/positions`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ positions: { 'node-abc': { x: 120, y: 240 } } }),
    })
    assert.equal(posPut.status, 200)
    assert.equal((await posPut.json()).ok, true)

    const posGetAfter = await fetch(`${baseUrl}/api/graph/positions`)
    assert.deepEqual((await posGetAfter.json()).positions, { 'node-abc': { x: 120, y: 240 } })

    const posPutBad = await fetch(`${baseUrl}/api/graph/positions`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ positions: 'not-an-object' }),
    })
    assert.equal(posPutBad.status, 400)
```

- [ ] **Step 2: Build and run tests — verify they fail**

```
npm run build && npm test 2>&1 | grep -E "web server exposes|FAIL|fail"
```
Expected: the `'web server exposes health and idea intake'` test fails with 404 on `/api/graph/positions`.

- [ ] **Step 3: Add import and route handlers to `src/web.ts`**

At the top of `src/web.ts`, add the import after the existing imports:

```typescript
import { loadGraphPositions, saveGraphPositions, type GraphPositions } from './graph-positions.js'
```

In `handleRequest`, add the two routes **before** the `/` route handler (before line `if (url.pathname === '/')`):

```typescript
  if (url.pathname === '/api/graph/positions' && request.method === 'GET') {
    const positions = await loadGraphPositions(config)
    writeJson(response, { positions })
    return
  }

  if (url.pathname === '/api/graph/positions' && request.method === 'PUT') {
    let body: { positions?: unknown }
    try {
      const rawBody = await readBody(request)
      body = rawBody.trim() ? (JSON.parse(rawBody) as { positions?: unknown }) : {}
    } catch {
      writeText(response, 'positions request body must be JSON', 400)
      return
    }
    if (!body.positions || typeof body.positions !== 'object' || Array.isArray(body.positions)) {
      writeText(response, 'positions must be an object mapping nodeId to {x, y}', 400)
      return
    }
    const positions: GraphPositions = {}
    for (const [id, pos] of Object.entries(body.positions as Record<string, unknown>)) {
      if (
        pos !== null &&
        typeof pos === 'object' &&
        !Array.isArray(pos) &&
        'x' in pos &&
        'y' in pos &&
        typeof (pos as { x: unknown }).x === 'number' &&
        typeof (pos as { y: unknown }).y === 'number'
      ) {
        positions[id] = { x: (pos as { x: number }).x, y: (pos as { y: number }).y }
      }
    }
    await saveGraphPositions(config, positions)
    writeJson(response, { ok: true })
    return
  }
```

- [ ] **Step 4: Build and run all tests — verify they pass**

```
npm run build && npm test 2>&1 | tail -20
```
Expected: all previously passing tests still pass, new assertions pass too. Total pass count goes up by 4.

- [ ] **Step 5: Commit**

```
git add src/web.ts src/web.test.ts
git commit -m "feat: add GET/PUT /api/graph/positions API routes"
```

---

### Task 3: Replace `renderGraphTab` SVG with Cytoscape container + update tests

**Files:**
- Modify: `src/web.ts` — CSS, `<head>` CDN tag, `renderGraphTab` body, inline JS
- Modify: `src/web.test.ts` — update "graph tab" test, add `refreshCyGraph` assertion

- [ ] **Step 1: Update the "graph tab" test in `src/web.test.ts`**

Find the test at line ~613:
```typescript
test('graph tab renders SVG neural map', async () => {
  const html = await getDashboardHtml()
  assert.ok(html.includes('id="tab-graph"'), 'missing graph panel')
  assert.ok(html.includes('class="graph-wrap"'), 'missing graph-wrap')
  assert.ok(html.includes('<svg'), 'missing SVG element')
})
```

Replace with:
```typescript
test('graph tab renders Cytoscape container', async () => {
  const html = await getDashboardHtml()
  assert.ok(html.includes('id="tab-graph"'), 'missing graph panel')
  assert.ok(html.includes('class="cy-container"'), 'missing cy-container div')
  assert.ok(html.includes('cytoscape.min.js'), 'missing cytoscape CDN script')
  assert.ok(html.includes('refreshCyGraph'), 'missing refreshCyGraph function')
})
```

- [ ] **Step 2: Build and run the updated test — verify it fails**

```
npm run build && npm test 2>&1 | grep -E "graph tab|FAIL"
```
Expected: `graph tab renders Cytoscape container` FAIL.

- [ ] **Step 3: Add Cytoscape CDN `<script>` to the `<head>` in `renderPage`**

In `src/web.ts`, find the `<head>` section inside `renderPage` (the function starting at line ~514). It ends with `</style>\n</head>`. Add the CDN script tag immediately before `</head>`:

```html
  <script src="https://unpkg.com/cytoscape@3.30.4/dist/cytoscape.min.js"></script>
</head>
```

- [ ] **Step 4: Replace `.graph-wrap` CSS with `#cy-container` / `.cy-container` CSS**

Find the CSS line:
```css
.graph-wrap { position: relative; background: #020202; border: 1px solid var(--accent-border); border-radius: 12px; overflow: hidden; height: calc(100dvh - 200px); min-height: 300px; }
.graph-svg { width: 100%; height: 100%; }
```

Replace with:
```css
.cy-container { background: #020202; border: 1px solid var(--accent-border); border-radius: 12px; height: calc(100dvh - 200px); min-height: 300px; }
```

- [ ] **Step 5: Rewrite `renderGraphTab` to output Cytoscape container + init script**

Find `function renderGraphTab(graph: IdeaGraph, loopState: ObservationLoopState): string {` and replace the entire function body with:

```typescript
function renderGraphTab(graph: IdeaGraph, loopState: ObservationLoopState): string {
  const firstNode = graph.nodes.find((node) => node.id === graph.centerNodeId) ?? graph.nodes[0]
  return `
<div class="cy-container" data-center-node="${escapeHtml(graph.centerNodeId ?? '')}"></div>
<div class="node-drawer" id="node-drawer" style="display:${firstNode ? 'block' : 'none'}">
  <div class="sys-label">/// SELECTED NODE</div>
  <div id="node-drawer-content">
    ${firstNode ? `<div style="color:var(--accent);font-weight:bold;margin-bottom:4px">${escapeHtml(firstNode.title)}</div><div class="muted" style="font-size:10px">${graph.edges.filter((e) => e.from === firstNode.id || e.to === firstNode.id).length} 個關聯</div>` : ''}
  </div>
</div>
<script id="graph-data" type="application/json">${jsonForScript(graph)}</script>
<script id="loop-data" type="application/json">${jsonForScript({ lastGraphAt: loopState.lastGraphAt ?? '', lastReportAt: loopState.lastReportAt ?? '' })}</script>
<script>
(function() {
  if (typeof cytoscape === 'undefined') {
    document.querySelectorAll('.cy-container:not([data-cy-init])').forEach(function(c) { c.textContent = '圖形載入失敗，請檢查網路'; });
    return;
  }
  var graphDataEl = document.getElementById('graph-data');
  if (!graphDataEl) return;
  var graph;
  try { graph = JSON.parse(graphDataEl.textContent || '{}'); } catch { return; }
  if (!graph || !Array.isArray(graph.nodes)) return;

  function truncateLabel(str, max) {
    return str && str.length > max ? str.slice(0, max - 1) + '\\u2026' : (str || '');
  }

  function toElements(g) {
    var els = [];
    var cid = g.centerNodeId;
    (g.nodes || []).forEach(function(node) {
      els.push({ data: {
        id: node.id,
        label: truncateLabel(node.title, node.id === cid ? 12 : 8),
        interesting: node.interesting ? true : undefined,
        ignored: (node.ignored || node.archived) ? true : undefined,
        isCenter: node.id === cid ? true : undefined,
      }});
    });
    (g.edges || []).forEach(function(edge) {
      els.push({ data: {
        id: edge.from + '--' + edge.to,
        source: edge.from,
        target: edge.to,
        confidence: edge.confidence,
        rationale: edge.rationale || '',
      }});
    });
    return els;
  }

  function getCyStyle() {
    return [
      { selector: 'node', style: {
        'background-color': 'rgba(5,5,5,0.9)', 'border-color': 'rgba(0,255,255,0.5)',
        'border-width': 1.5, 'color': 'rgba(0,255,255,0.8)', 'label': 'data(label)',
        'font-family': 'Courier New, monospace', 'font-size': 10,
        'text-valign': 'center', 'text-halign': 'center',
        'width': 40, 'height': 40, 'text-wrap': 'wrap', 'text-max-width': 36, 'shape': 'ellipse',
      }},
      { selector: 'node[?interesting]', style: {
        'border-color': 'rgba(255,0,255,0.7)', 'color': 'rgba(255,0,255,0.95)', 'border-width': 2.5,
      }},
      { selector: 'node[?isCenter]', style: {
        'width': 56, 'height': 56, 'border-color': 'rgba(0,255,255,0.9)',
        'color': 'rgba(0,255,255,1)', 'font-size': 12, 'font-weight': 'bold', 'border-width': 2.5,
      }},
      { selector: 'node[?ignored]', style: {
        'opacity': 0.35, 'border-color': 'rgba(100,100,100,0.4)', 'color': 'rgba(150,150,150,0.6)',
      }},
      { selector: 'node.cy-selected', style: { 'border-color': 'rgba(251,191,36,0.85)', 'border-width': 2.5 }},
      { selector: 'edge', style: {
        'line-color': 'rgba(0,255,255,0.18)', 'width': 0.8, 'curve-style': 'bezier',
        'line-style': 'dashed', 'line-dash-pattern': [4, 3], 'target-arrow-shape': 'none',
      }},
      { selector: 'edge[confidence = "strong"]', style: {
        'line-color': 'rgba(0,255,255,0.5)', 'width': 1.2, 'line-style': 'solid',
      }},
    ];
  }

  function debounce(fn, delay) {
    var timer;
    return function() { clearTimeout(timer); timer = setTimeout(fn, delay); };
  }

  window._cyInstances = window._cyInstances || [];
  window._cyToElements = toElements;
  window._cyGetStyle = getCyStyle;

  function initContainer(container, savedPositions) {
    container.setAttribute('data-cy-init', '1');
    var hasSaved = Object.keys(savedPositions).length > 0 &&
      (graph.nodes || []).every(function(n) { return savedPositions[n.id]; });
    var layoutConfig = hasSaved
      ? { name: 'preset', positions: function(node) { return savedPositions[node.id()]; } }
      : { name: 'cose', animate: false, randomize: false,
          nodeRepulsion: function() { return 8000; },
          idealEdgeLength: function() { return 120; },
          gravity: 0.4, numIter: 1000 };

    var cy = cytoscape({
      container: container,
      elements: toElements(graph),
      style: getCyStyle(),
      layout: layoutConfig,
      minZoom: 0.15, maxZoom: 4, wheelSensitivity: 0.3, boxSelectionEnabled: false,
    });
    window._cyInstances.push(cy);

    var savePositions = debounce(function() {
      var positions = {};
      cy.nodes().forEach(function(node) { positions[node.id()] = node.position(); });
      fetch('/api/graph/positions', { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ positions: positions }) });
    }, 800);

    cy.on('layoutstop', savePositions);
    cy.on('dragfree', 'node', savePositions);

    cy.on('tap', 'node', function(event) {
      var nodeId = event.target.id();
      window._cyInstances.forEach(function(inst) { inst.nodes().removeClass('cy-selected'); });
      event.target.addClass('cy-selected');
      var drawer = document.getElementById('node-drawer');
      var drawerContent = document.getElementById('node-drawer-content');
      if (drawer) drawer.style.display = 'block';
      if (drawerContent) drawerContent.textContent = '載入中…';
      fetch('/api/graph/nodes/' + encodeURIComponent(nodeId))
        .then(function(r) { return r.json(); })
        .then(function(data) { renderNodeDrawer(data); })
        .catch(function() { if (drawerContent) drawerContent.textContent = '載入失敗'; });
    });

    cy.on('tap', function(event) {
      if (event.target === cy) {
        window._cyInstances.forEach(function(inst) { inst.nodes().removeClass('cy-selected'); });
        var drawer = document.getElementById('node-drawer');
        if (drawer) drawer.style.display = 'none';
      }
    });
  }

  function initAllContainers(savedPositions) {
    document.querySelectorAll('.cy-container:not([data-cy-init])').forEach(function(container) {
      initContainer(container, savedPositions);
    });
  }

  fetch('/api/graph/positions')
    .then(function(r) { return r.json(); })
    .then(function(data) { initAllContainers((data && data.positions) ? data.positions : {}); })
    .catch(function() { initAllContainers({}); });
})();

function refreshCyGraph() {
  fetch('/api/graph', { cache: 'no-store' })
    .then(function(r) { return r.json(); })
    .then(function(graph) {
      var graphDataEl = document.getElementById('graph-data');
      if (graphDataEl) graphDataEl.textContent = JSON.stringify(graph).replaceAll('<', '\\u003c').replaceAll('&', '\\u0026');
      var toEls = window._cyToElements;
      var getStyle = window._cyGetStyle;
      if (!toEls || !getStyle) return;
      (window._cyInstances || []).forEach(function(cy) {
        cy.json({ elements: toEls(graph) });
        cy.style(getStyle());
      });
    })
    .catch(function() {});
}
</script>`
}
```

- [ ] **Step 6: Add Escape keydown handler to the main page `<script>` block for Cytoscape**

In `renderPage`, find the existing Escape handler:
```javascript
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') resetFocusToCenter();
  });
```

Add Cytoscape dismiss after the existing `resetFocusToCenter()` call:
```javascript
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      resetFocusToCenter();
      (window._cyInstances || []).forEach(function(cy) { cy.nodes().removeClass('cy-selected'); });
      var drawer = document.getElementById('node-drawer');
      if (drawer) drawer.style.display = 'none';
    }
  });
```

- [ ] **Step 7: Wire `refreshCyGraph` into the existing graph action handlers**

In `renderPage`'s inline `<script>`, find the action handler block around:
```javascript
      renderNodeDrawer(detail);
      focusedNodeId = detail.node.id;
      await refreshGraphInPlace(focusedNodeId);
      return;
```

Add `refreshCyGraph()` call after `refreshGraphInPlace`:
```javascript
      renderNodeDrawer(detail);
      focusedNodeId = detail.node.id;
      await refreshGraphInPlace(focusedNodeId);
      refreshCyGraph();
      return;
```

- [ ] **Step 8: Build and run all tests**

```
npm run build && npm test 2>&1 | tail -30
```
Expected: `graph tab renders Cytoscape container` now PASSES. All other tests still pass. Zero failures.

- [ ] **Step 9: Commit**

```
git add src/web.ts src/web.test.ts
git commit -m "feat: replace static SVG graph with interactive Cytoscape.js neural map"
```

---

### Task 4: Version bump, docs, push

**Files:**
- Modify: `src/version.ts`
- Modify: `package.json`
- Modify: `.github/workflows/deploy-dev.yml`
- Modify: `README.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Bump version to `0.14.0`**

`src/version.ts` — change:
```typescript
export const APP_VERSION = '0.13.0'
```
to:
```typescript
export const APP_VERSION = '0.14.0'
```

`package.json` — change `"version": "0.13.0"` → `"version": "0.14.0"`.

`.github/workflows/deploy-dev.yml` — change `EXPECTED_APP_VERSION: "0.13.0"` → `EXPECTED_APP_VERSION: "0.14.0"`.

- [ ] **Step 2: Update `README.md`**

Add a v0.14.0 entry near the top of the changelog/features section:

```markdown
## v0.14.0 — Interactive Graph (Cytoscape.js)

Neural Cockpit graph tab replaced with a fully interactive Cytoscape.js graph:
- Drag nodes freely — positions persist to `data/graph-positions.json` via `PUT /api/graph/positions`
- Force-directed initial layout (`cose`) — no more uniform circle; nodes spread organically
- Zoom (scroll wheel / pinch) and pan (drag background)
- Tap node → loads node detail and actions in the drawer (same behaviour as before)
- Cyberpunk styling preserved: cyan nodes, magenta for interesting, dimmed for stop-exploring
```

- [ ] **Step 3: Update `AGENTS.md`**

Find the approved-versions line ending in `v0.13.0 Android Mode...` and append:
`, and v0.14.0 interactive Cytoscape.js neural graph with drag, zoom/pan, force-directed layout, and backend-persisted node positions`

- [ ] **Step 4: Final build + full test run**

```
npm run build && npm test
```
Expected: all tests pass, 0 failures. Total count >= 119 (115 existing + 4 graph-positions).

- [ ] **Step 5: Commit and push**

```
git add src/version.ts package.json .github/workflows/deploy-dev.yml README.md AGENTS.md
git commit -m "chore: bump version to 0.14.0 — interactive Cytoscape graph"
git push
```

---

## Self-Review

### Spec coverage

| Spec requirement | Covered by |
|-----------------|-----------|
| Cytoscape.js from CDN | Task 3 Step 3 |
| `<div class="cy-container">` replaces SVG | Task 3 Step 5 |
| `cose` force-directed layout when no saved positions | Task 3 Step 5 (`hasSaved` branch) |
| `preset` layout when saved positions exist | Task 3 Step 5 (`hasSaved` branch) |
| Drag node → debounce 800ms → `PUT /api/graph/positions` | Task 3 Step 5 (`dragfree` handler) |
| Layout stop → save positions | Task 3 Step 5 (`layoutstop` handler) |
| `GET /api/graph/positions` | Task 2 |
| `PUT /api/graph/positions` | Task 2 |
| `src/graph-positions.ts` load/save | Task 1 |
| Zoom / pan built-in | Task 3 Step 5 (Cytoscape config) |
| Tap node → load drawer via API | Task 3 Step 5 (`tap node` handler) |
| Tap background → clear selection | Task 3 Step 5 (`tap` on cy handler) |
| Escape → clear selection | Task 3 Step 6 |
| `refreshCyGraph` updates all instances after actions | Task 3 Step 7 |
| Cyberpunk styling | Task 3 Step 5 (`getCyStyle`) |
| CDN offline fallback text | Task 3 Step 5 (`typeof cytoscape === 'undefined'` check) |
| Version bump to 0.14.0 | Task 4 |
| Tests for positions module | Task 1 |
| Tests for API routes | Task 2 |
| Test for Cytoscape container in page | Task 3 Step 1 |

### Placeholder scan

No placeholders found. All code blocks are complete and self-contained.

### Type consistency

- `GraphPositions` defined in `src/graph-positions.ts`, imported in `src/web.ts` as `GraphPositions` — consistent.
- `loadGraphPositions` / `saveGraphPositions` — same names in test file and implementation.
- `window._cyInstances` — used consistently in init, `refreshCyGraph`, and Escape handler.
- `window._cyToElements` / `window._cyGetStyle` — set once in init, used in `refreshCyGraph`.
