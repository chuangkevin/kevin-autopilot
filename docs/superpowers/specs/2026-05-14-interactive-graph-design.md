# Interactive Graph Design

**Goal:** Replace the static SVG neural map in the 圖 tab with a fully interactive Cytoscape.js graph — draggable nodes, zoom/pan, organic force-directed initial layout, and positions persisted to the backend so every device sees the same layout.

**Architecture:** Cytoscape.js loaded from CDN renders all graph elements client-side. The server embeds graph data as JSON in the page and adds two new API routes for position persistence. A new `src/graph-positions.ts` module handles file I/O for `data/graph-positions.json`.

**Tech Stack:** Cytoscape.js (CDN, `unpkg.com`), vanilla JS inline `<script>`, Node.js file-based position storage (JSON), existing SQLite DB untouched.

---

## Architecture

### Server-side changes (`src/web.ts`)

- `renderGraphTab()` stops generating SVG elements. It now outputs:
  - `<div id="cy">` container (full height, dark background)
  - `<script id="graph-data">` embedding the `IdeaGraph` JSON (already exists)
  - A new `<script>` block that initialises Cytoscape after loading from CDN
- Cytoscape CDN tag added to the dashboard `<head>`: `unpkg.com/cytoscape/dist/cytoscape.min.js`
- `createGraphLayout()` is retained as a TypeScript function but no longer called from `renderGraphTab`; it is still used by `renderNeuralCockpit` (the legacy desktop hub-spoke sidebar at `#neural-stage`) so it must not be deleted
- `refreshGraphInPlace(focusedNodeId)` is replaced by `refreshCyGraph(focusedNodeId)`: calls `GET /api/graph` (existing) to fetch updated graph JSON, then calls `cy.json({ elements })` to hot-reload nodes and edges without destroying the DOM or losing zoom state

### New module: `src/graph-positions.ts`

Exports:
- `loadGraphPositions(config): Promise<GraphPositions>` — reads `data/graph-positions.json`, returns `{}` if missing
- `saveGraphPositions(config, positions): Promise<void>` — atomically writes the file

Type:
```ts
type GraphPositions = Record<string, { x: number; y: number }>
```

### New API routes

| Method | Path | Auth | Body / Response |
|--------|------|------|-----------------|
| `GET` | `/api/graph/positions` | none (read-only) | `{ positions: GraphPositions }` |
| `PUT` | `/api/graph/positions` | none (Autopilot-owned data only) | body: `{ positions: GraphPositions }` → 200 `{ ok: true }` |

No trusted-settings guard needed — positions contain no secrets and are Autopilot-owned layout data only.

---

## Client-side Cytoscape Initialisation

```
1. Load graph-data JSON from <script id="graph-data">
2. Fetch GET /api/graph/positions
3. Convert IdeaGraph nodes + edges → Cytoscape elements array
4. If saved positions exist for all nodes → init with those positions, layout: preset
5. Else → init with layout: cose (force-directed, organic spread)
6. After layout stop → PUT /api/graph/positions with final positions
7. On node dragfree → debounce 800 ms → PUT /api/graph/positions
```

### Cytoscape style (cyberpunk)

```
node (default)     : black fill, cyan border 1.5px, cyan label, Courier New 10px
node (interesting) : magenta border, magenta label, drop-shadow magenta
node (center)      : size 50, cyan glow, pulse animation via CSS
node (stop-exploring): opacity 0.35, grey border
edge (weak)        : cyan dashed, opacity 0.18, width 0.8
edge (strong)      : cyan solid, opacity 0.5, width 1.2
selected node      : yellow border rgba(251,191,36,0.85)
```

### Node tap behaviour (same as current)

- `cy.on('tap', 'node', ...)` → fetch `/api/graph/nodes/:id` → `renderNodeDrawer(data)`
- Tap on background → clear selection, hide drawer
- Escape keydown → clear selection

### Zoom / Pan

Built-in Cytoscape behaviour. Config:
- `minZoom: 0.3`, `maxZoom: 3`
- `wheelSensitivity: 0.3` (prevent over-sensitive scroll)
- `panningEnabled: true`, `userZoomingEnabled: true`

### refreshCyGraph (replaces refreshGraphInPlace)

- Fetches current graph JSON from `/api/graph` (or uses embedded data if no change)
- Calls `cy.json({ elements: toElements(graph) })` — Cytoscape merges/adds/removes nodes gracefully
- Re-applies style to preserve cyberpunk look
- Does NOT reset zoom or pan

---

## Data Flow

```
Page load
  → embed IdeaGraph JSON in <script id="graph-data">
  → Cytoscape init reads JSON + GET /api/graph/positions
  → render with saved positions (preset layout) OR cose layout
  → layout stop → save positions

User drags node
  → cy dragfree event
  → debounce 800ms → PUT /api/graph/positions (full positions snapshot)

User taps node
  → cy tap event → GET /api/graph/nodes/:id → renderNodeDrawer()

Graph refresh (background loop cycle completes)
  → refreshCyGraph() → cy.json update → keep zoom/pan state
```

---

## Files to Create / Modify

| File | Action |
|------|--------|
| `src/graph-positions.ts` | Create — load/save `data/graph-positions.json` |
| `src/graph-positions.test.ts` | Create — load returns `{}` when missing; save round-trips |
| `src/web.ts` | Modify — add CDN tag, rewrite `renderGraphTab`, add 2 API routes, replace `refreshGraphInPlace` with `refreshCyGraph` |
| `src/web.test.ts` | Modify — add tests for GET/PUT `/api/graph/positions` routes |

**Not changing:** `src/types.ts`, `src/idea-graph.ts`, `src/observation-loop.ts`, SQLite schema, `data/autopilot.db`.

---

## Testing

- `graph-positions.test.ts`: load missing file → `{}`; save then load → round-trips; save overwrites
- `web.test.ts`: `GET /api/graph/positions` returns `{ positions: {} }` before any save; `PUT` with valid body → 200; after PUT, `GET` returns saved positions; graph tab HTML contains `<div id="cy">`; Cytoscape CDN script tag present in `<head>`

---

## Constraints

- Read-only safety intact: position data is Autopilot-owned layout metadata, not target-repo data
- No new npm dependency (CDN only)
- `createGraphLayout` stays in `src/web.ts` — it is still used by `renderNeuralCockpit` (legacy desktop hub-spoke sidebar)
- Cytoscape loaded only when the page renders (not on `/settings`, `/health`, etc.)
- If CDN fails (offline), `<div id="cy">` shows a fallback text "圖形載入失敗，請檢查網路"
